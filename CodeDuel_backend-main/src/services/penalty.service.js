const { prisma } = require("../config/prisma");
const logger = require("../utils/logger");

/**
 * Apply penalty to a challenge member
 * @param {string} memberId - Challenge member ID
 * @param {number} amount - Penalty amount
 * @param {string} reason - Reason for penalty
 * @param {Date} date - Date of penalty
 * @returns {Object} Created penalty record
 */
const applyPenalty = async (memberId, amount, reason, date) => {
  // Create penalty record
  const penalty = await prisma.penaltyLedger.create({
    data: {
      memberId,
      amount,
      reason,
      date,
    },
  });

  // Update member's total penalties
  const member = await prisma.challengeMember.update({
    where: { id: memberId },
    data: {
      totalPenalties: {
        increment: amount,
      },
    },
    include: {
      user: {
        select: {
          username: true,
        },
      },
      challenge: {
        select: {
          name: true,
        },
      },
    },
  });

  logger.info(
    `Penalty applied: ${amount} to ${member.user.username} for ${member.challenge.name}. Reason: ${reason}`
  );

  return penalty;
};

/**
 * Get penalty history for a member
 * @param {string} memberId - Challenge member ID
 * @returns {Array} Array of penalty records
 */
const getMemberPenalties = async (memberId) => {
  const penalties = await prisma.penaltyLedger.findMany({
    where: { memberId },
    orderBy: {
      date: "desc",
    },
  });

  return penalties;
};

/**
 * Get total penalties for a member
 * @param {string} memberId - Challenge member ID
 * @returns {number} Total penalty amount
 */
const getMemberTotalPenalty = async (memberId) => {
  const result = await prisma.penaltyLedger.aggregate({
    where: { memberId },
    _sum: {
      amount: true,
    },
  });

  return result._sum.amount || 0;
};

/**
 * Get penalty statistics for a challenge
 * @param {string} challengeId - Challenge ID
 * @returns {Object} Penalty statistics
 */
const getChallengePenaltyStats = async (challengeId) => {
  const members = await prisma.challengeMember.findMany({
    where: { challengeId },
    select: {
      id: true,
      totalPenalties: true,
      user: {
        select: {
          username: true,
        },
      },
    },
  });

  const totalPenalties = members.reduce(
    (sum, member) => sum + member.totalPenalties,
    0
  );
  const averagePenalty =
    members.length > 0 ? totalPenalties / members.length : 0;

  const memberStats = members.map((member) => ({
    username: member.user.username,
    totalPenalty: member.totalPenalties,
  }));

  return {
    totalPenalties,
    averagePenalty,
    memberCount: members.length,
    memberStats,
  };
};

/**
 * Remove or adjust a penalty (for corrections)
 * @param {string} penaltyId - Penalty ID
 * @param {number} adjustmentAmount - Amount to adjust (negative to reduce)
 * @returns {Object} Updated member data
 */
const adjustPenalty = async (penaltyId, adjustmentAmount) => {
  const penalty = await prisma.penaltyLedger.findUnique({
    where: { id: penaltyId },
    include: {
      member: true,
    },
  });

  if (!penalty) {
    throw new Error("Penalty not found");
  }

  // Delete the penalty record
  await prisma.penaltyLedger.delete({
    where: { id: penaltyId },
  });

  // Adjust member's total
  const updatedMember = await prisma.challengeMember.update({
    where: { id: penalty.memberId },
    data: {
      totalPenalties: {
        decrement: penalty.amount,
        increment: adjustmentAmount,
      },
    },
  });

  logger.info(
    `Penalty adjusted: ${penaltyId}, adjustment: ${adjustmentAmount}`
  );

  return updatedMember;
};

module.exports = {
  applyPenalty,
  getMemberPenalties,
  getMemberTotalPenalty,
  getChallengePenaltyStats,
  adjustPenalty,
};
