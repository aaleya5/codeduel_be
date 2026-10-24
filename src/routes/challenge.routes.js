const express = require("express");
const router = express.Router();
const challengeController = require("../controllers/challenge.controller");
const { authenticate } = require("../middlewares/auth.middleware");

/**
 * @route   POST /api/challenges
 * @desc    Create a new challenge
 * @access  Private
 */
router.post(
  "/",
  authenticate,
  challengeController.validateCreateChallenge,
  challengeController.createChallenge
);

/**
 * @route   GET /api/challenges
 * @desc    Get all challenges for current user
 * @access  Private
 */
router.get("/", authenticate, challengeController.getUserChallenges);

/**
 * @route   GET /api/challenges/invite/:inviteCode
 * @desc    Get challenge details for an invitation
 * @access  Private
 */
router.get(
  "/invite/:inviteCode",
  authenticate,
  challengeController.getInviteDetails
);

/**
 * @route   POST /api/challenges/invite/:inviteCode/request
 * @desc    Request to join from an invitation
 * @access  Private
 */
router.post(
  "/invite/:inviteCode/request",
  authenticate,
  challengeController.requestToJoinByInvite
);

/**
 * @route   GET /api/challenges/:id
 * @desc    Get challenge by ID
 * @access  Private
 */
router.get("/:id", authenticate, challengeController.getChallengeById);

/**
 * @route   POST /api/challenges/:id/join
 * @desc    Join a challenge
 * @access  Private
 */
router.post("/:id/join", authenticate, challengeController.joinChallenge);

/**
 * @route   GET /api/challenges/:id/join-requests
 * @desc    List pending join requests (owner only)
 * @access  Private
 */
router.get(
  "/:id/join-requests",
  authenticate,
  challengeController.getJoinRequests
);

/**
 * @route   PATCH /api/challenges/:id/join-requests/:requestId
 * @desc    Approve or reject a join request (owner only)
 * @access  Private
 */
router.patch(
  "/:id/join-requests/:requestId",
  authenticate,
  challengeController.resolveJoinRequest
);

/**
 * @route   PATCH /api/challenges/:id/status
 * @desc    Update challenge status (owner only)
 * @access  Private
 */
router.patch(
  "/:id/status",
  authenticate,
  challengeController.updateChallengeStatus
);

/**
 * @route   PATCH /api/challenges/:id
 * @desc    Update challenge rules - name, description, min submissions,
 *          difficulty filter, unique-problem constraint, penalty amount,
 *          end date (owner only)
 * @access  Private
 */
router.patch("/:id", authenticate, challengeController.updateChallengeRules);

/**
 * @route   DELETE /api/challenges/:id/members/:memberId
 * @desc    Remove a member from a challenge (owner only)
 * @access  Private
 */
router.delete(
  "/:id/members/:memberId",
  authenticate,
  challengeController.removeMember
);

/**
 * @route   POST /api/challenges/:id/members/:memberId/penalty-adjustment
 * @desc    Manually adjust a member's penalty balance (owner only)
 * @access  Private
 */
router.post(
  "/:id/members/:memberId/penalty-adjustment",
  authenticate,
  challengeController.adjustMemberPenalty
);

/**
 * @route   GET /api/challenges/:id/disputes
 * @desc    List a challenge's pending penalty disputes (owner only)
 * @access  Private
 */
router.get("/:id/disputes", authenticate, challengeController.getDisputes);

/**
 * @route   POST /api/challenges/:id/penalties/:penaltyId/dispute
 * @desc    Dispute one of your own penalties
 * @access  Private
 */
router.post(
  "/:id/penalties/:penaltyId/dispute",
  authenticate,
  challengeController.disputePenalty
);

/**
 * @route   POST /api/challenges/:id/penalties/:penaltyId/resolve
 * @desc    Resolve a pending dispute (owner only). Body: { action, note }
 * @access  Private
 */
router.post(
  "/:id/penalties/:penaltyId/resolve",
  authenticate,
  challengeController.resolveDispute
);

module.exports = router;
