const { prisma } = require("../config/prisma");
const logger = require("../utils/logger");
const {
  addCalendarDays,
  dateKeyForDatabaseDate,
  databaseDateForKey,
  getTodayDateKey,
  calculateStreaksFromResults,
} = require("../utils/challenge-date");

const toLocalDateKey = (value) => {
  return dateKeyForDatabaseDate(value);
};

/**
 * Calculate user's current and longest streak
 */
const calculateUserStreak = async (userId) => {
  try {
    const results = await prisma.dailyResult.findMany({
      where: {
        member: {
          userId: userId,
        },
      },
      orderBy: {
        date: "asc",
      },
      select: {
        date: true,
        completed: true,
      },
    });

    return calculateStreaksFromResults(results);
  } catch (error) {
    logger.error("Error calculating streak:", error);
    return { currentStreak: 0, longestStreak: 0 };
  }
};

/**
 * Get user's activity heatmap data (contribution graph)
 * Returns activity for the last 365 days
 */
const getUserActivityHeatmap = async (userId) => {
  try {
    const startDateKey = addCalendarDays(getTodayDateKey(), -364);
    const oneYearAgo = databaseDateForKey(startDateKey);

    // Get all daily results for the user in the last year
    const results = await prisma.dailyResult.findMany({
      where: {
        member: {
          userId: userId,
        },
        date: {
          gte: oneYearAgo,
        },
      },
      orderBy: {
        date: "asc",
      },
      select: {
        date: true,
        submissionsCount: true,
        completed: true,
      },
    });

    // Group by date and sum submissions
    const activityMap = {};

    results.forEach((result) => {
      const dateKey = toLocalDateKey(result.date);
      if (!activityMap[dateKey]) {
        activityMap[dateKey] = 0;
      }
      activityMap[dateKey] += result.submissionsCount || 0;
    });

    // Convert to array format for frontend
    const activityData = Object.entries(activityMap).map(([date, count]) => ({
      date,
      count,
    }));

    return activityData;
  } catch (error) {
    logger.error("Error fetching activity heatmap:", error);
    return [];
  }
};

/**
 * Get user's submission chart data (last 30 days)
 */
const getUserSubmissionChart = async (userId) => {
  try {
    const thirtyDaysAgoKey = addCalendarDays(getTodayDateKey(), -30);
    const thirtyDaysAgo = databaseDateForKey(thirtyDaysAgoKey);

    // Get all daily results for the last 30 days
    const results = await prisma.dailyResult.findMany({
      where: {
        member: {
          userId: userId,
        },
        date: {
          gte: thirtyDaysAgo,
        },
      },
      orderBy: {
        date: "asc",
      },
      select: {
        date: true,
        submissionsCount: true,
        completed: true,
        member: {
          select: {
            challenge: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    // Group by date
    const chartMap = {};

    results.forEach((result) => {
      const dateKey = toLocalDateKey(result.date);
      if (!chartMap[dateKey]) {
        chartMap[dateKey] = {
          date: dateKey,
          submissions: 0,
          passed: 0,
          failed: 0,
        };
      }
      chartMap[dateKey].submissions += result.submissionsCount || 0;
      if (result.completed) {
        chartMap[dateKey].passed++;
      } else {
        chartMap[dateKey].failed++;
      }
    });

    // Convert to array and fill missing dates
    const chartData = [];
    const todayKey = getTodayDateKey();

    for (
      let dateKey = thirtyDaysAgoKey;
      dateKey <= todayKey;
      dateKey = addCalendarDays(dateKey, 1)
    ) {
      chartData.push(
        chartMap[dateKey] || {
          date: dateKey,
          submissions: 0,
          passed: 0,
          failed: 0,
        }
      );
    }

    return chartData;
  } catch (error) {
    logger.error("Error fetching submission chart:", error);
    return [];
  }
};

/**
 * Get submission chart data for a single challenge, aggregated across all
 * of its members (used for the "Team Progress" chart on the challenge page).
 * Returns the last `days` days, each with total problems solved by the
 * whole team that day vs. the challenge's daily target.
 */
const getChallengeSubmissionChart = async (challengeId, days = 30) => {
  try {
    const todayKey = getTodayDateKey();
    const startDateKey = addCalendarDays(todayKey, -days);
    const startDate = databaseDateForKey(startDateKey);

    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId },
      select: { minSubmissionsPerDay: true },
    });

    const results = await prisma.dailyResult.findMany({
      where: {
        challengeId,
        date: { gte: startDate },
      },
      select: {
        date: true,
        submissionsCount: true,
      },
    });

    // Sum every member's submissions for each calendar day
    const chartMap = {};
    results.forEach((result) => {
      const dateKey = toLocalDateKey(result.date);
      chartMap[dateKey] = (chartMap[dateKey] || 0) + (result.submissionsCount || 0);
    });

    // Fill in every day in the range, including days with no data
    const chartData = [];
    for (
      let dateKey = startDateKey;
      dateKey <= todayKey;
      dateKey = addCalendarDays(dateKey, 1)
    ) {
      chartData.push({
        date: dateKey,
        solved: chartMap[dateKey] || 0,
        target: challenge?.minSubmissionsPerDay || 1,
      });
    }

    return chartData;
  } catch (error) {
    logger.error("Error fetching challenge submission chart:", error);
    return [];
  }
};

/**
 * Get the global leaderboard: every user who has joined at least one
 * challenge, ranked across their entire history (not scoped to a single
 * challenge - see dashboard.controller.getChallengeLeaderboard for that).
 *
 * Ranking priority: total problems solved > current streak > lowest penalties.
 */
const getGlobalLeaderboard = async (limit = 50) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        memberships: { some: {} },
      },
      select: {
        id: true,
        username: true,
      },
    });

    const entries = await Promise.all(
      users.map(async (user) => {
        const [streaks, totalSubmissions, missedDays, totalPenalties] =
          await Promise.all([
            calculateUserStreak(user.id),
            prisma.dailyResult.aggregate({
              where: { member: { userId: user.id } },
              _sum: { submissionsCount: true },
            }),
            prisma.dailyResult.count({
              where: { member: { userId: user.id }, completed: false },
            }),
            prisma.penaltyLedger.aggregate({
              where: { member: { userId: user.id } },
              _sum: { amount: true },
            }),
          ]);

        return {
          userId: user.id,
          userName: user.username,
          totalSolved: totalSubmissions._sum.submissionsCount || 0,
          currentStreak: streaks.currentStreak,
          missedDays,
          penaltyAmount: totalPenalties._sum.amount || 0,
        };
      })
    );

    entries.sort((a, b) => {
      if (b.totalSolved !== a.totalSolved) return b.totalSolved - a.totalSolved;
      if (b.currentStreak !== a.currentStreak)
        return b.currentStreak - a.currentStreak;
      return a.penaltyAmount - b.penaltyAmount;
    });

    return entries.slice(0, limit).map((entry, index) => ({
      rank: index + 1,
      ...entry,
    }));
  } catch (error) {
    logger.error("Error fetching global leaderboard:", error);
    return [];
  }
};

/**
 * Get comprehensive user stats
 */
const getUserStats = async (userId) => {
  try {
    const [streaks, totalResults, totalPenalties, totalSubmissions] =
      await Promise.all([
        calculateUserStreak(userId),
        prisma.dailyResult.count({
          where: {
            member: {
              userId: userId,
            },
          },
        }),
        prisma.penaltyLedger.aggregate({
          where: {
            member: {
              userId: userId,
            },
          },
          _sum: {
            amount: true,
          },
        }),
        prisma.dailyResult.aggregate({
          where: {
            member: {
              userId: userId,
            },
          },
          _sum: {
            submissionsCount: true,
          },
        }),
      ]);

    return {
      currentStreak: streaks.currentStreak,
      longestStreak: streaks.longestStreak,
      totalDays: totalResults,
      totalPenalties: totalPenalties._sum.amount || 0,
      totalSubmissions: totalSubmissions._sum.submissionsCount || 0,
    };
  } catch (error) {
    logger.error("Error fetching user stats:", error);
    throw error;
  }
};

module.exports = {
  calculateUserStreak,
  getUserActivityHeatmap,
  getUserSubmissionChart,
  getChallengeSubmissionChart,
  getUserStats,
  getGlobalLeaderboard,
};
