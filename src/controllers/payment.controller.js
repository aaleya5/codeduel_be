const paymentService = require("../services/payment.service");
const { asyncHandler } = require("../middlewares/error.middleware");

/**
 * Create a Razorpay order to pay down a penalty balance
 * POST /api/payments/create-order
 * Body: { memberId, amount }
 */
const createOrder = asyncHandler(async (req, res) => {
  const { memberId, amount } = req.body;

  if (!memberId) {
    return res.status(400).json({
      success: false,
      message: "memberId is required",
    });
  }

  const order = await paymentService.createOrder(req.user.id, memberId, amount);

  res.status(200).json({
    success: true,
    data: order,
  });
});

/**
 * Verify a completed Razorpay checkout
 * POST /api/payments/verify
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 */
const verifyPayment = asyncHandler(async (req, res) => {
  const payment = await paymentService.verifyPayment(req.user.id, req.body);

  res.status(200).json({
    success: true,
    message: "Payment verified successfully",
    data: payment,
  });
});

/**
 * Reconcile a captured Razorpay payment using the signed raw request body.
 * POST /api/payments/webhook
 */
const razorpayWebhook = asyncHandler(async (req, res) => {
  const result = await paymentService.processRazorpayWebhook(
    req.body,
    req.get("x-razorpay-signature")
  );

  res.status(200).json({
    success: true,
    ...result,
  });
});

/**
 * Get a member's own payment history
 * GET /api/payments/history/:memberId
 */
const getPaymentHistory = asyncHandler(async (req, res) => {
  const { memberId } = req.params;
  const payments = await paymentService.getPaymentHistory(req.user.id, memberId);

  res.status(200).json({
    success: true,
    data: payments,
  });
});

/**
 * Record a payment received outside the app (cash, direct UPI, etc.)
 * POST /api/payments/manual
 * Body: { challengeId, memberId, amount, note }
 */
const recordManualPayment = asyncHandler(async (req, res) => {
  const { challengeId, memberId, amount, note } = req.body;

  if (!challengeId || !memberId) {
    return res.status(400).json({
      success: false,
      message: "challengeId and memberId are required",
    });
  }

  const payment = await paymentService.recordManualPayment(
    req.user.id,
    challengeId,
    memberId,
    amount,
    note
  );

  res.status(200).json({
    success: true,
    message: "Payment recorded successfully",
    data: payment,
  });
});

/**
 * Get a member's full penalty + payment ledger with a running balance
 * GET /api/payments/ledger/:memberId
 */
const getFullLedger = asyncHandler(async (req, res) => {
  const { memberId } = req.params;
  const ledger = await paymentService.getFullLedger(req.user.id, memberId);

  res.status(200).json({
    success: true,
    data: ledger,
  });
});

module.exports = {
  createOrder,
  verifyPayment,
  razorpayWebhook,
  getPaymentHistory,
  recordManualPayment,
  getFullLedger,
};
