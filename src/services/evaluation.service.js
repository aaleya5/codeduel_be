const { prisma } = require("../config/prisma");
const leetcodeService = require("./leetcode.service");
const penaltyService = require("./penalty.service");
const notificationService = require("./notification.service");
const { emitToChallenge, emitBroadcast } = require("../config/socket");
const logger = require("../utils/logger");
const {
  CHALLENGE_TIME_ZONE,
  addCalendarDays,
  dateKeyForDatabaseDate,
  dateKeyForInstant,
  databaseDateForKey,
  getDayBoundsInTimeZone,
  getYesterdayDateKey,
  isDateKey,
} = require("../utils/challenge-date");

// Safety cap on how many backlog days we'll evaluate for a single member in
// one run, so a long-dead server or brand-new member with a distant
// challenge start date can't turn one cron tick into a huge synchronous
// backfill. Any remainder catches up on subsequent runs.
const MAX_CATCHUP_DAYS = 14;

/**
 * Evaluate a single challenge by id for a specific (or default "yesterday")
 * date. Used by the owner-triggered manual evaluation endpoint, so unlike
 * runDailyEvaluation this only ever touches one challenge, not every active
 * challenge in the system.
 * @param {string} challengeId
 * @param {Date} [targetDate] - Optional specific date to evaluate instead of "yesterday"
 */
const runEvaluationForChallenge = async (challengeId, targetDate = null) => {
  const dateKey = targetDate
    ? getTargetDateKey(targetDate)
    : getYesterdayDateKey();
  const evaluationDate = databaseDateForKey(dateKey);

  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
    include: {
      members: {
        where: { isActive: true },
        include: {
          user: {
            select: { id: true, username: true, leetcodeUsername: true },
          },
        },
      },
    },
  });

  if (!challenge) {
    throw new Error("Challenge not found");
  }

  logger.info(
    `Manually evaluating challenge ${challenge.name} for date: ${dateKey} (${CHALLENGE_TIME_ZONE})`
  );

  await evaluateChallenge(challenge, evaluationDate);
};

/**
 * Run daily evaluation for all active challenges
 * This is the main function called by the cron job
 *
 * Runs shortly after midnight (see DAILY_EVALUATION_TIME), so by default it
 * evaluates the day that just ENDED, not the day that just started - members
 * need the full day to submit before we judge them. Pass an explicit
 * targetDate (e.g. for a manual re-run or backfill) to override that.
 *
 * Also catches up any member who has a gap in their DailyResult history up
 * to that point (e.g. the server was down and a previous cron run never
 * fired) - see getMissingEvaluationDates / evaluateChallenge.
 *
 * Not exposed directly to users - see runEvaluationForChallenge for the
 * owner-scoped manual-trigger endpoint.
 *
 * @param {Date} [targetDate] - Optional specific date to evaluate instead of "yesterday"
 */
const runDailyEvaluation = async (targetDate = null) => {
  const dateKey = targetDate
    ? getTargetDateKey(targetDate)
    : getYesterdayDateKey();
  const evaluationDate = databaseDateForKey(dateKey);
  const { start: dayStart, end: dayEnd } = getDayBoundsInTimeZone(
    dateKey,
    CHALLENGE_TIME_ZONE
  );

  logger.info(
    `Starting daily evaluation for date: ${dateKey} (${CHALLENGE_TIME_ZONE})`
  );

  try {
    // Get all challenges that were active on the evaluation date
    const activeChallenges = await prisma.challenge.findMany({
      where: {
        status: "ACTIVE",
        startDate: { lt: dayEnd },
        endDate: { gte: dayStart },
      },
      include: {
        members: {
          where: { isActive: true },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                leetcodeUsername: true,
              },
            },
          },
        },
      },
    });

    logger.info(
      `Found ${activeChallenges.length} active challenges to evaluate`
    );

    // Evaluate each challenge
    for (const challenge of activeChallenges) {
      try {
        await evaluateChallenge(challenge, evaluationDate);
      } catch (error) {
        logger.error(`Failed to evaluate challenge ${challenge.id}:`, error);
        // Continue with other challenges even if one fails
      }
    }

    logger.info("Daily evaluation completed successfully");
  } catch (error) {
    logger.error("Daily evaluation failed:", error);
    throw error;
  }
};

/**
 * Evaluate a single challenge, catching up any member whose evaluation
 * history has a gap (e.g. the server was down and a cron run was missed)
 * in addition to the requested date.
 * @param {Object} challenge - Challenge object with members
 * @param {Date} uptoDate - Latest date to evaluate (inclusive)
 */
const evaluateChallenge = async (challenge, uptoDate) => {
  const uptoDateKey = dateKeyForDatabaseDate(uptoDate);
  logger.info(`Evaluating challenge: ${challenge.name} (${challenge.id})`);

  let anyEvaluated = false;

  for (const member of challenge.members) {
    try {
      const datesToEvaluate = await getMissingEvaluationDates(
        challenge,
        member,
        uptoDateKey
      );

      if (datesToEvaluate.length > 1) {
        logger.warn(
          `Member ${member.user.username} has ${datesToEvaluate.length} unevaluated day(s) for "${challenge.name}" - catching up`
        );
      }

      // Evaluate oldest-first so streak increments/resets build up in the
      // correct chronological order.
      for (const date of datesToEvaluate) {
        await evaluateMember(challenge, member, date);
        anyEvaluated = true;
      }
    } catch (error) {
      logger.error(
        `Failed to evaluate member ${member.user.username} for challenge ${challenge.name}:`,
        error
      );
      // Continue with other members
    }
  }

  if (anyEvaluated) {
    // Let anyone currently viewing this challenge's page know its
    // leaderboard/streaks just changed, so they can refetch instead of
    // waiting for a manual refresh. Also nudge the global leaderboard,
    // since this challenge's results feed into it too.
    emitToChallenge(challenge.id, "challenge:evaluated", {
      challengeId: challenge.id,
    });
    emitBroadcast("leaderboard:global:stale", { challengeId: challenge.id });
  }
};

/**
 * Work out which calendar days (up to and including uptoDate) a member
 * still needs a DailyResult for, so a missed cron run gets caught up
 * instead of silently skipped. Starts the day after their most recent
 * DailyResult, or their join date / the challenge start date (whichever is
 * later) if they have no results yet. Capped at MAX_CATCHUP_DAYS per call.
 */
const getMissingEvaluationDates = async (challenge, member, uptoDate) => {
  const lastResult = await prisma.dailyResult.findFirst({
    where: { memberId: member.id },
    orderBy: { date: "desc" },
    select: { date: true },
  });

  const uptoDateKey =
    typeof uptoDate === "string"
      ? uptoDate
      : dateKeyForDatabaseDate(uptoDate);
  let cursorKey;
  if (lastResult) {
    cursorKey = addCalendarDays(
      dateKeyForDatabaseDate(lastResult.date),
      1
    );
  } else {
    const challengeStart = dateKeyForDatabaseDate(challenge.startDate);
    const memberJoined = dateKeyForInstant(
      member.joinedAt,
      CHALLENGE_TIME_ZONE
    );
    cursorKey = challengeStart > memberJoined ? challengeStart : memberJoined;
  }

  const dates = [];
  while (cursorKey <= uptoDateKey && dates.length < MAX_CATCHUP_DAYS) {
    dates.push(databaseDateForKey(cursorKey));
    cursorKey = addCalendarDays(cursorKey, 1);
  }

  return dates;
};

/**
 * Evaluate a single member for a specific date
 * @param {Object} challenge - Challenge object
 * @param {Object} member - Challenge member object
 * @param {Date} evaluationDate - Date to evaluate
 */
const evaluateMember = async (challenge, member, evaluationDate) => {
  const user = member.user;

  // Check if user has LeetCode username
  if (!user.leetcodeUsername) {
    logger.warn(`User ${user.username} doesn't have a LeetCode username set`);

    // Create a failed result
    await createDailyResult(
      challenge.id,
      member.id,
      evaluationDate,
      false,
      0,
      [],
      {
        reason: "No LeetCode username configured",
      }
    );

    // Apply penalty
    await applyPenaltyForFailure(
      challenge,
      member,
      evaluationDate,
      "No LeetCode username configured"
    );
    return;
  }

  // Fetch LeetCode session (if stored)
  const sessionData = await leetcodeService.getUserSession(user.id);

  // Fetch submissions for the date
  let submissions;
  try {
    submissions = await leetcodeService.fetchSubmissionsForDate(
      user.leetcodeUsername,
      evaluationDate,
      sessionData
    );
  } catch (error) {
    logger.error(
      `Failed to fetch submissions for ${user.leetcodeUsername}:`,
      error
    );

    // Create a failed result due to API error
    await createDailyResult(
      challenge.id,
      member.id,
      evaluationDate,
      false,
      0,
      [],
      {
        reason: "Failed to fetch submissions from LeetCode",
        error: error.message,
      }
    );

    // Don't apply penalty for API errors
    return;
  }

  // Enrich submissions with metadata (difficulty, etc.)
  const enrichedSubmissions =
    await leetcodeService.enrichSubmissionsWithMetadata(
      submissions,
      sessionData
    );

  // Filter by difficulty if specified
  let filteredSubmissions = enrichedSubmissions;
  if (challenge.difficultyFilter && challenge.difficultyFilter.length > 0) {
    filteredSubmissions = enrichedSubmissions.filter((sub) =>
      challenge.difficultyFilter.includes(sub.difficulty)
    );

    logger.debug(
      `Filtered ${enrichedSubmissions.length} submissions to ${
        filteredSubmissions.length
      } matching difficulties: ${challenge.difficultyFilter.join(", ")}`
    );
  }

  // Extract unique problems if constraint is enabled
  const problemsSolved = challenge.uniqueProblemConstraint
    ? [...new Set(filteredSubmissions.map((s) => s.titleSlug))]
    : filteredSubmissions.map((s) => s.titleSlug);

  const submissionsCount = problemsSolved.length;

  // Check if member met the requirement
  const completed = submissionsCount >= challenge.minSubmissionsPerDay;

  // Create daily result
  await createDailyResult(
    challenge.id,
    member.id,
    evaluationDate,
    completed,
    submissionsCount,
    problemsSolved,
    {
      submissions: filteredSubmissions.map((s) => ({
        title: s.title,
        titleSlug: s.titleSlug,
        difficulty: s.difficulty,
        timestamp: s.timestamp,
        language: s.language,
      })),
    }
  );

  // Update streak
  const streakResult = await updateStreak(member.id, completed);

  // Apply penalty if failed
  if (!completed) {
    await applyPenaltyForFailure(
      challenge,
      member,
      evaluationDate,
      `Failed to meet daily requirement: ${submissionsCount}/${challenge.minSubmissionsPerDay} submissions`
    );

    // Notify the member if a real streak just broke (don't bother them for
    // a "streak" that was already 0)
    if (streakResult.previousStreak > 0) {
      await notificationService.createNotification(
        user.id,
        "STREAK_BROKEN",
        "Streak broken",
        `Your ${streakResult.previousStreak}-day streak in "${challenge.name}" ended - only ${submissionsCount}/${challenge.minSubmissionsPerDay} problems solved.`,
        challenge.id
      );
    }
  }

  logger.info(
    `Member ${user.username} evaluation: ${
      completed ? "PASSED" : "FAILED"
    } (${submissionsCount}/${challenge.minSubmissionsPerDay})`
  );
};

/**
 * Create a daily result record
 */
const createDailyResult = async (
  challengeId,
  memberId,
  date,
  completed,
  submissionsCount,
  problemsSolved,
  metadata = {}
) => {
  return await prisma.dailyResult.create({
    data: {
      challengeId,
      memberId,
      date,
      completed,
      submissionsCount,
      problemsSolved,
      evaluatedAt: new Date(),
      metadata,
    },
  });
};

/**
 * Update member's streak based on completion status
 * @returns {{previousStreak: number, newStreak: number}}
 */
const updateStreak = async (memberId, completed) => {
  const member = await prisma.challengeMember.findUnique({
    where: { id: memberId },
  });

  const previousStreak = member.currentStreak;

  if (completed) {
    // Increment current streak
    const newStreak = member.currentStreak + 1;
    const newLongest = Math.max(newStreak, member.longestStreak);

    await prisma.challengeMember.update({
      where: { id: memberId },
      data: {
        currentStreak: newStreak,
        longestStreak: newLongest,
      },
    });

    return { previousStreak, newStreak };
  }

  // Reset current streak
  await prisma.challengeMember.update({
    where: { id: memberId },
    data: {
      currentStreak: 0,
    },
  });

  return { previousStreak, newStreak: 0 };
};

/**
 * Apply penalty for failing daily requirement
 */
const applyPenaltyForFailure = async (challenge, member, date, reason) => {
  if (challenge.penaltyAmount > 0) {
    await penaltyService.applyPenalty(
      member.id,
      challenge.penaltyAmount,
      reason,
      date
    );
  }
};

/**
 * Get daily results for a member
 * @param {string} memberId - Challenge member ID
 * @param {number} limit - Number of results to fetch
 * @returns {Array} Daily results
 */
const getMemberDailyResults = async (memberId, limit = 30) => {
  return await prisma.dailyResult.findMany({
    where: { memberId },
    orderBy: { date: "desc" },
    take: limit,
  });
};

/**
 * Get today's status for a member
 * @param {string} memberId - Challenge member ID
 * @returns {Object|null} Today's daily result or null
 */
const getTodayStatus = async (memberId) => {
  const today = databaseDateForKey(dateKeyForInstant(new Date()));

  return await prisma.dailyResult.findUnique({
    where: {
      challengeId_memberId_date: {
        challengeId: (
          await prisma.challengeMember.findUnique({ where: { id: memberId } })
        ).challengeId,
        memberId,
        date: today,
      },
    },
  });
};

const getTargetDateKey = (targetDate) => {
  if (typeof targetDate === "string" && isDateKey(targetDate)) {
    return targetDate;
  }
  return dateKeyForInstant(new Date(targetDate), CHALLENGE_TIME_ZONE);
};

module.exports = {
  runDailyEvaluation,
  runEvaluationForChallenge,
  evaluateChallenge,
  evaluateMember,
  getMissingEvaluationDates,
  getMemberDailyResults,
  getTodayStatus,
};
