const { prisma } = require("../config/prisma");
const { AppError } = require("../middlewares/error.middleware");
const logger = require("../utils/logger");
const penaltyService = require("./penalty.service");
const notificationService = require("./notification.service");
const { emitToChallenge } = require("../config/socket");
const {
  dateKeyForDatabaseDate,
  databaseDateForKey,
  getTodayDateKey,
} = require("../utils/challenge-date");

/**
 * Create a new challenge
 * @param {string} userId - Owner user ID
 * @param {Object} challengeData - Challenge details
 * @returns {Object} Created challenge
 */
const createChallenge = async (userId, challengeData) => {
  const {
    name,
    description,
    minSubmissionsPerDay,
    difficultyFilter,
    uniqueProblemConstraint,
    penaltyAmount,
    startDate,
    endDate,
  } = challengeData;

  // Validate dates
  const startDateKey = dateKeyForDatabaseDate(new Date(startDate));
  const endDateKey = dateKeyForDatabaseDate(new Date(endDate));

  if (startDateKey <= getTodayDateKey()) {
    throw new AppError("Start date must be in the future", 400);
  }

  if (endDateKey <= startDateKey) {
    throw new AppError("End date must be after start date", 400);
  }
  const start = databaseDateForKey(startDateKey);
  const end = databaseDateForKey(endDateKey);

  // Validate difficulty filter
  const validDifficulties = ["Easy", "Medium", "Hard"];
  const invalidDifficulties = difficultyFilter.filter(
    (d) => !validDifficulties.includes(d)
  );

  if (invalidDifficulties.length > 0) {
    throw new AppError(
      `Invalid difficulty levels: ${invalidDifficulties.join(", ")}`,
      400
    );
  }

  // Create challenge
  const challenge = await prisma.challenge.create({
    data: {
      name,
      description: description || null,
      ownerId: userId,
      minSubmissionsPerDay: minSubmissionsPerDay || 1,
      difficultyFilter,
      uniqueProblemConstraint: uniqueProblemConstraint !== false,
      penaltyAmount: penaltyAmount || 0,
      startDate: start,
      endDate: end,
      status: "PENDING",
    },
    include: {
      owner: {
        select: {
          id: true,
          username: true,
          email: true,
        },
      },
    },
  });

  // Automatically add creator as a member
  await prisma.challengeMember.create({
    data: {
      challengeId: challenge.id,
      userId,
    },
  });

  logger.info(
    `Challenge created: ${challenge.name} by ${challenge.owner.username}`
  );

  return challenge;
};

/**
 * Get challenge by ID
 * @param {string} challengeId - Challenge ID
 * @param {string} userId - Requesting user ID (optional)
 * @returns {Object} Challenge details
 */
const getChallengeById = async (challengeId, userId = null) => {
  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
    include: {
      owner: {
        select: {
          id: true,
          username: true,
          email: true,
        },
      },
      members: {
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
      joinRequests: userId
        ? {
            where: { userId },
            select: { status: true },
          }
        : false,
      _count: {
        select: {
          members: true,
          dailyResults: true,
        },
      },
    },
  });

  if (!challenge) {
    throw new AppError("Challenge not found", 404);
  }

  return challenge;
};

/**
 * Join a challenge
 * @param {string} userId - User ID
 * @param {string} challengeId - Challenge ID
 * @returns {Object} Challenge membership
 */
const joinChallenge = async (userId, challengeId) => {
  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
  });

  if (!challenge) {
    throw new AppError("Challenge not found", 404);
  }

  // Check if challenge has started
  if (challenge.status === "COMPLETED" || challenge.status === "CANCELLED") {
    throw new AppError("Cannot join a completed or cancelled challenge", 400);
  }

  return createJoinRequest(userId, challenge);
};

const getInviteDetails = async (userId, inviteCode) => {
  const challenge = await prisma.challenge.findUnique({
    where: {
      inviteCode,
    },
    select: {
      id: true,
      inviteCode: true,
      name: true,
      description: true,
      startDate: true,
      endDate: true,
      status: true,
      minSubmissionsPerDay: true,
      difficultyFilter: true,
      penaltyAmount: true,
      owner: { select: { username: true } },
      members: {
        where: { userId, isActive: true },
        select: { id: true },
      },
      joinRequests: {
        where: { userId },
        select: { status: true },
      },
    },
  });

  if (!challenge) {
    throw new AppError("Invitation link is invalid or expired", 404);
  }

  return {
    ...challenge,
    isMember: challenge.members.length > 0,
    joinRequestStatus: challenge.joinRequests[0]?.status ?? null,
    members: undefined,
    joinRequests: undefined,
  };
};

const createJoinRequest = async (userId, challenge) => {
  if (challenge.status === "COMPLETED" || challenge.status === "CANCELLED") {
    throw new AppError("Cannot join a completed or cancelled challenge", 400);
  }

  const existingMembership = await prisma.challengeMember.findUnique({
    where: {
      challengeId_userId: {
        challengeId: challenge.id,
        userId,
      },
    },
  });

  if (existingMembership?.isActive) {
    throw new AppError("You are already a member of this challenge", 400);
  }

  const existingRequest = await prisma.challengeJoinRequest.findUnique({
    where: {
      challengeId_userId: {
        challengeId: challenge.id,
        userId,
      },
    },
  });

  if (existingRequest?.status === "PENDING") {
    return existingRequest;
  }
  if (existingRequest?.status === "APPROVED") {
    throw new AppError("You are already a member of this challenge", 400);
  }

  const joinRequest = await prisma.challengeJoinRequest.upsert({
    where: {
      challengeId_userId: {
        challengeId: challenge.id,
        userId,
      },
    },
    update: { status: "PENDING" },
    create: { challengeId: challenge.id, userId },
    include: {
      user: { select: { username: true } },
      challenge: { select: { id: true, name: true, ownerId: true } },
    },
  });

  await notificationService.createNotification(
    challenge.ownerId,
    "CHALLENGE_JOIN_REQUEST",
    "New challenge join request",
    `${joinRequest.user.username} requested to join "${challenge.name}".`,
    challenge.id
  );
  emitToChallenge(challenge.id, "challenge:join-requested", {
    challengeId: challenge.id,
  });

  logger.info(
    `User ${joinRequest.user.username} requested to join challenge ${challenge.name}`
  );

  return joinRequest;
};

const requestToJoinByInvite = async (userId, inviteCode) => {
  const challenge = await prisma.challenge.findUnique({
    where: { inviteCode },
  });
  if (!challenge) {
    throw new AppError("Invitation link is invalid or expired", 404);
  }
  return createJoinRequest(userId, challenge);
};

const getJoinRequests = async (ownerId, challengeId) => {
  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
    select: { ownerId: true },
  });
  if (!challenge) throw new AppError("Challenge not found", 404);
  if (challenge.ownerId !== ownerId) {
    throw new AppError("Only the challenge owner can review join requests", 403);
  }

  return prisma.challengeJoinRequest.findMany({
    where: { challengeId, status: "PENDING" },
    include: { user: { select: { id: true, username: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
};

const resolveJoinRequest = async (
  ownerId,
  challengeId,
  requestId,
  decision
) => {
  if (!["APPROVED", "REJECTED"].includes(decision)) {
    throw new AppError("Decision must be APPROVED or REJECTED", 400);
  }

  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
    select: { id: true, name: true, ownerId: true },
  });
  if (!challenge) throw new AppError("Challenge not found", 404);
  if (challenge.ownerId !== ownerId) {
    throw new AppError("Only the challenge owner can review join requests", 403);
  }

  const joinRequest = await prisma.challengeJoinRequest.findUnique({
    where: { id: requestId },
    include: { user: { select: { id: true, username: true } } },
  });
  if (!joinRequest || joinRequest.challengeId !== challengeId) {
    throw new AppError("Join request not found", 404);
  }
  if (joinRequest.status !== "PENDING") {
    throw new AppError("This join request has already been reviewed", 400);
  }

  const updatedRequest = await prisma.$transaction(async (transaction) => {
    const updated = await transaction.challengeJoinRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: { status: decision },
    });
    if (updated.count !== 1) {
      throw new AppError("This join request has already been reviewed", 400);
    }

    if (decision === "APPROVED") {
      await transaction.challengeMember.upsert({
        where: {
          challengeId_userId: {
            challengeId,
            userId: joinRequest.userId,
          },
        },
        update: { isActive: true },
        create: { challengeId, userId: joinRequest.userId },
      });
    }

    return transaction.challengeJoinRequest.findUnique({
      where: { id: requestId },
    });
  });

  await notificationService.createNotification(
    joinRequest.userId,
    decision === "APPROVED" ? "CHALLENGE_JOIN_APPROVED" : "CHALLENGE_JOIN_REJECTED",
    decision === "APPROVED" ? "Join request approved" : "Join request declined",
    decision === "APPROVED"
      ? `Your request to join "${challenge.name}" was approved.`
      : `Your request to join "${challenge.name}" was declined.`,
    challengeId
  );
  if (decision === "APPROVED") {
    emitToChallenge(challengeId, "challenge:member-joined", {
      challengeId,
      userId: joinRequest.userId,
    });
  }

  return updatedRequest;
};

/**
 * Get all challenges for a user
 * @param {string} userId - User ID
 * @param {Object} filters - Filter options (status, owned)
 * @returns {Array} List of challenges
 */
const getUserChallenges = async (userId, filters = {}) => {
  const { status, owned } = filters;

  const where = {};

  // Filter by status
  if (status) {
    where.status = status;
  }

  // Filter by owned vs joined
  if (owned === "true") {
    where.ownerId = userId;
  } else {
    where.members = {
      some: {
        userId,
      },
    };
  }

  const challenges = await prisma.challenge.findMany({
    where,
    include: {
      owner: {
        select: {
          id: true,
          username: true,
        },
      },
      _count: {
        select: {
          members: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return challenges;
};

/**
 * Update challenge status (owner only)
 * @param {string} challengeId - Challenge ID
 * @param {string} userId - User ID (must be owner)
 * @param {string} newStatus - New status
 * @returns {Object} Updated challenge
 */
const updateChallengeStatus = async (challengeId, userId, newStatus) => {
  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
  });

  if (!challenge) {
    throw new AppError("Challenge not found", 404);
  }

  if (challenge.ownerId !== userId) {
    throw new AppError("Only the challenge owner can update status", 403);
  }

  const validStatuses = ["PENDING", "ACTIVE", "COMPLETED", "CANCELLED"];
  if (!validStatuses.includes(newStatus)) {
    throw new AppError(`Invalid status: ${newStatus}`, 400);
  }

  const updatedChallenge = await prisma.challenge.update({
    where: { id: challengeId },
    data: { status: newStatus },
    include: {
      owner: {
        select: {
          id: true,
          username: true,
        },
      },
    },
  });

  logger.info(`Challenge ${challenge.name} status updated to ${newStatus}`);

  return updatedChallenge;
};

/**
 * Update a challenge's rules (owner only). Only mutable configuration
 * fields are editable here - name/description/rules/end date. The owner,
 * start date, and status are changed through their own dedicated flows.
 * @param {string} challengeId
 * @param {string} userId - Must be the challenge owner
 * @param {Object} updates - Partial fields to update
 * @returns {Object} Updated challenge
 */
const updateChallengeRules = async (challengeId, userId, updates) => {
  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
  });

  if (!challenge) {
    throw new AppError("Challenge not found", 404);
  }

  if (challenge.ownerId !== userId) {
    throw new AppError("Only the challenge owner can edit this challenge", 403);
  }

  const allowedFields = [
    "name",
    "description",
    "minSubmissionsPerDay",
    "difficultyFilter",
    "uniqueProblemConstraint",
    "penaltyAmount",
    "endDate",
  ];

  const data = {};
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      data[field] = updates[field];
    }
  }

  if (Object.keys(data).length === 0) {
    throw new AppError("No editable fields provided", 400);
  }

  if (data.difficultyFilter) {
    const validDifficulties = ["Easy", "Medium", "Hard"];
    const invalid = data.difficultyFilter.filter(
      (d) => !validDifficulties.includes(d)
    );
    if (invalid.length > 0) {
      throw new AppError(`Invalid difficulty levels: ${invalid.join(", ")}`, 400);
    }
  }

  if (data.endDate) {
    const newEndDateKey = dateKeyForDatabaseDate(new Date(data.endDate));
    if (newEndDateKey <= dateKeyForDatabaseDate(challenge.startDate)) {
      throw new AppError("End date must be after the start date", 400);
    }
    data.endDate = databaseDateForKey(newEndDateKey);
  }

  const updatedChallenge = await prisma.challenge.update({
    where: { id: challengeId },
    data,
    include: {
      owner: { select: { id: true, username: true } },
    },
  });

  logger.info(`Challenge ${challenge.name} rules updated by owner`);

  emitToChallenge(challengeId, "challenge:rules-updated", {
    challengeId,
    name: updatedChallenge.name,
  });

  return updatedChallenge;
};

/**
 * Remove a member from a challenge (owner only). Soft-removes by marking
 * the membership inactive rather than deleting it, so their historical
 * DailyResult/PenaltyLedger rows (and everyone else's daily evaluations)
 * stay intact. The owner cannot remove themselves this way - use status
 * changes or transfer ownership instead (not yet supported).
 * @param {string} challengeId
 * @param {string} userId - Must be the challenge owner
 * @param {string} memberId - ChallengeMember id to remove
 * @returns {Object} Updated membership
 */
const removeMember = async (challengeId, userId, memberId) => {
  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
  });

  if (!challenge) {
    throw new AppError("Challenge not found", 404);
  }

  if (challenge.ownerId !== userId) {
    throw new AppError("Only the challenge owner can remove members", 403);
  }

  const member = await prisma.challengeMember.findUnique({
    where: { id: memberId },
    include: { user: { select: { id: true, username: true } } },
  });

  if (!member || member.challengeId !== challengeId) {
    throw new AppError("Member not found in this challenge", 404);
  }

  if (member.userId === challenge.ownerId) {
    throw new AppError("The challenge owner cannot be removed", 400);
  }

  const updatedMember = await prisma.challengeMember.update({
    where: { id: memberId },
    data: { isActive: false },
  });

  await notificationService.createNotification(
    member.userId,
    "MEMBER_REMOVED",
    "Removed from challenge",
    `You were removed from "${challenge.name}" by the challenge owner.`,
    challengeId
  );

  logger.info(
    `Member ${member.user.username} removed from challenge ${challenge.name} by owner`
  );

  emitToChallenge(challengeId, "challenge:member-removed", {
    challengeId,
    memberId,
  });

  return updatedMember;
};

/**
 * Manually adjust a member's penalty balance (owner only) - e.g. to correct
 * a wrongly-applied penalty. Positive amounts add to their balance,
 * negative amounts reduce it. Recorded as a normal PenaltyLedger entry so
 * it shows up in their history.
 * @param {string} challengeId
 * @param {string} userId - Must be the challenge owner
 * @param {string} memberId - ChallengeMember id to adjust
 * @param {number} amount - Positive to add, negative to reduce
 * @param {string} reason
 */
const adjustMemberPenalty = async (challengeId, userId, memberId, amount, reason) => {
  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
  });

  if (!challenge) {
    throw new AppError("Challenge not found", 404);
  }

  if (challenge.ownerId !== userId) {
    throw new AppError("Only the challenge owner can adjust penalties", 403);
  }

  const member = await prisma.challengeMember.findUnique({
    where: { id: memberId },
  });

  if (!member || member.challengeId !== challengeId) {
    throw new AppError("Member not found in this challenge", 404);
  }

  if (member.userId === userId) {
    throw new AppError(
      "You cannot adjust your own penalty balance - ask another member to flag it, or adjust someone else's",
      403
    );
  }

  if (typeof amount !== "number" || amount === 0 || isNaN(amount)) {
    throw new AppError("A non-zero numeric amount is required", 400);
  }

  if (!reason || !reason.trim()) {
    throw new AppError("A reason is required for penalty adjustments", 400);
  }

  return await penaltyService.applyPenalty(
    memberId,
    amount,
    `Owner adjustment: ${reason.trim()}`,
    databaseDateForKey(getTodayDateKey())
  );
};

module.exports = {
  createChallenge,
  getChallengeById,
  joinChallenge,
  getInviteDetails,
  requestToJoinByInvite,
  getJoinRequests,
  resolveJoinRequest,
  getUserChallenges,
  updateChallengeStatus,
  updateChallengeRules,
  removeMember,
  adjustMemberPenalty,
};
