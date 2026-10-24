const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/payment.controller");
const { authenticate } = require("../middlewares/auth.middleware");

/**
 * @route   POST /api/payments/create-order
 * @desc    Create a Razorpay order to pay down your own penalty balance
 * @access  Private
 */
router.post("/create-order", authenticate, paymentController.createOrder);

/**
 * @route   POST /api/payments/verify
 * @desc    Verify a completed Razorpay checkout and credit the balance
 * @access  Private
 */
router.post("/verify", authenticate, paymentController.verifyPayment);

/**
 * @route   GET /api/payments/history/:memberId
 * @desc    Get your own payment history for a membership
 * @access  Private
 */
router.get(
  "/history/:memberId",
  authenticate,
  paymentController.getPaymentHistory
);

/**
 * @route   POST /api/payments/manual
 * @desc    Owner records a payment received outside the app (cash, UPI, etc.)
 * @access  Private (challenge owner only)
 */
router.post("/manual", authenticate, paymentController.recordManualPayment);

/**
 * @route   GET /api/payments/ledger/:memberId
 * @desc    Full penalty + payment history with running balance.
 *          Viewable by the member themselves or the challenge owner.
 * @access  Private
 */
router.get("/ledger/:memberId", authenticate, paymentController.getFullLedger);

module.exports = router;
