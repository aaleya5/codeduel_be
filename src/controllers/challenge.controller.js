const challengeService = require("../services/challenge.service");
const penaltyService = require("../services/penalty.service");
const { asyncHandler } = require("../middlewares/error.middleware");
const { body, validationResult } = require("express-validator");

/**
 * Validation middleware for creating challenge
 */
const validateCreateChallenge = [
  body("name")
    .isLength({ min: 3, max: 100 })
    .withMessage("Challenge name must be 3-100 characters"),
  body("description")
    .optional()
    .isLength({ max: 500 })
    .withMessage("Description must not exceed 500 characters"),
  body("minSubmissionsPerDay")
    .optional()
    .isInt({ min: 1, max: 10 })
    .withMessage("Min submissions per day must be between 1 and 10"),
  body("difficultyFilter")
    .isArray()
    .withMessage("Difficulty filter must be an array")
    .custom((value) => {
      const valid = ["Easy", "Medium", "Hard"];
      return value.every((d) => valid.includes(d));
    })
    .withMessage("Difficulty filter must contain only Easy, Medium, or Hard"),
  body("uniqueProblemConstraint")
    .optional()
    .isBoolean()
    .withMessage("Unique problem constraint must be a boolean"),
  body("penaltyAmount")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("Penalty amount must be a non-negative number"),
  body("startDate")
    .isISO8601()
    .withMessage("Start date must be a valid ISO 8601 date"),
  body("endDate")
    .isISO8601()
    .withMessage("End date must be a valid ISO 8601 date"),
];

/**
 * Create a new challenge
 * POST /api/challenges
 */
const createChallenge = asyncHandler(async (req, res) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: errors.array(),
    });
  }

  const challenge = await challengeService.createChallenge(
    req.user.id,
    req.body
  );

  res.status(201).json({
    success: true,
    message: "Challenge created successfully",
    data: challenge,
  });
});

/**
 * Get challenge by ID
 * GET /api/challenges/:id
 */
const getChallengeById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const challenge = await challengeService.getChallengeById(id, req.user.id);

  res.status(200).json({
    success: true,
    data: challenge,
  });
});

/**
 * Join a challenge
 * POST /api/challenges/:id/join
 */
const joinChallenge = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const joinRequest = await challengeService.joinChallenge(req.user.id, id);

  res.status(202).json({
    success: true,
    message: "Join request submitted",
    data: joinRequest,
  });
});

const getInviteDetails = asyncHandler(async (req, res) => {
  const challenge = await challengeService.getInviteDetails(
    req.user.id,
    req.params.inviteCode
  );

  res.status(200).json({
    success: true,
    data: challenge,
  });
});

const requestToJoinByInvite = asyncHandler(async (req, res) => {
  const joinRequest = await challengeService.requestToJoinByInvite(
    req.user.id,
    req.params.inviteCode
  );

  res.status(202).json({
    success: true,
    message: "Join request submitted",
    data: joinRequest,
  });
});

const getJoinRequests = asyncHandler(async (req, res) => {
  const joinRequests = await challengeService.getJoinRequests(
    req.user.id,
    req.params.id
  );

  res.status(200).json({
    success: true,
    data: joinRequests,
  });
});

const resolveJoinRequest = asyncHandler(async (req, res) => {
  const joinRequest = await challengeService.resolveJoinRequest(
    req.user.id,
    req.params.id,
    req.params.requestId,
    req.body.decision
  );

  res.status(200).json({
    success: true,
    message: `Join request ${req.body.decision.toLowerCase()}`,
    data: joinRequest,
  });
});

/**
 * Get all challenges for current user
 * GET /api/challenges
 */
const getUserChallenges = asyncHandler(async (req, res) => {
  const { status, owned } = req.query;

  const challenges = await challengeService.getUserChallenges(req.user.id, {
    status,
    owned,
  });

  res.status(200).json({
    success: true,
    data: challenges,
  });
});

/**
 * Update challenge status
 * PATCH /api/challenges/:id/status
 */
const updateChallengeStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({
      success: false,
      message: "Status is required",
    });
  }

  const challenge = await challengeService.updateChallengeStatus(
    id,
    req.user.id,
    status
  );

  res.status(200).json({
    success: true,
    message: "Challenge status updated successfully",
    data: challenge,
  });
});

/**
 * Update challenge rules (owner only)
 * PATCH /api/challenges/:id
 */
const updateChallengeRules = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const challenge = await challengeService.updateChallengeRules(
    id,
    req.user.id,
    req.body
  );

  res.status(200).json({
    success: true,
    message: "Challenge updated successfully",
    data: challenge,
  });
});

/**
 * Remove a member from a challenge (owner only)
 * DELETE /api/challenges/:id/members/:memberId
 */
const removeMember = asyncHandler(async (req, res) => {
  const { id, memberId } = req.params;

  await challengeService.removeMember(id, req.user.id, memberId);

  res.status(200).json({
    success: true,
    message: "Member removed successfully",
  });
});

/**
 * Adjust a member's penalty balance (owner only)
 * POST /api/challenges/:id/members/:memberId/penalty-adjustment
 */
const adjustMemberPenalty = asyncHandler(async (req, res) => {
  const { id, memberId } = req.params;
  const { amount, reason } = req.body;

  const penalty = await challengeService.adjustMemberPenalty(
    id,
    req.user.id,
    memberId,
    amount,
    reason
  );

  res.status(200).json({
    success: true,
    message: "Penalty adjusted successfully",
    data: penalty,
  });
});

/**
 * Dispute one of your own penalties
 * POST /api/challenges/:id/penalties/:penaltyId/dispute
 * Body: { reason }
 */
const disputePenalty = asyncHandler(async (req, res) => {
  const { penaltyId } = req.params;
  const { reason } = req.body;

  const penalty = await penaltyService.disputePenalty(req.user.id, penaltyId, reason);

  res.status(200).json({
    success: true,
    message: "Dispute submitted",
    data: penalty,
  });
});

/**
 * List a challenge's pending disputes (owner only)
 * GET /api/challenges/:id/disputes
 */
const getDisputes = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const disputes = await penaltyService.getDisputesForChallenge(req.user.id, id);

  res.status(200).json({
    success: true,
    data: disputes,
  });
});

/**
 * Resolve a pending dispute (owner only)
 * POST /api/challenges/:id/penalties/:penaltyId/resolve
 * Body: { action: "UPHOLD" | "WAIVE", note }
 */
const resolveDispute = asyncHandler(async (req, res) => {
  const { penaltyId } = req.params;
  const { action, note } = req.body;

  const resolved = await penaltyService.resolveDispute(
    req.user.id,
    penaltyId,
    action,
    note
  );

  res.status(200).json({
    success: true,
    message: "Dispute resolved",
    data: resolved,
  });
});

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
  disputePenalty,
  getDisputes,
  resolveDispute,
  validateCreateChallenge,
};
