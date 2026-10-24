const crypto = require("crypto");
const Razorpay = require("razorpay");
const { prisma } = require("../config/prisma");
const { config, validateRazorpayConfig } = require("../config/env");
const { AppError } = require("../middlewares/error.middleware");
const { emitToUser } = require("../config/socket");
const notificationService = require("./notification.service");
const logger = require("../utils/logger");

let razorpayClient = null;
const getClient = () => {
  if (!razorpayClient) {
    validateRazorpayConfig();
    razorpayClient = new Razorpay({
      key_id: config.razorpayKeyId,
      key_secret: config.razorpayKeySecret,
    });
  }
  return razorpayClient;
};

/**
 * A member's outstanding penalty balance - what they still owe after
 * subtracting what they've already paid. Never negative (a member can't
 * have "negative debt" from overpaying; extra payments simply aren't
 * possible since createOrder caps the order amount at this value).
 */
const getOutstandingBalance = (member) =>
  Math.max(0, member.totalPenalties - member.totalPaid);

/**
 * Create a Razorpay order for a member to pay down their outstanding
 * penalty balance. The caller must be the member themselves - a challenge
 * owner cannot pay on someone else's behalf through this endpoint.
 * @param {string} userId - Authenticated user making the payment
 * @param {string} memberId - ChallengeMember whose balance is being paid
 * @param {number} amount - Amount in rupees (not paise)
 */
const createOrder = async (userId, memberId, amount) => {
  const member = await prisma.challengeMember.findUnique({
    where: { id: memberId },
    include: { challenge: { select: { id: true, name: true } } },
  });

  if (!member) {
    throw new AppError("Membership not found", 404);
  }

  if (member.userId !== userId) {
    throw new AppError("You can only pay down your own penalty balance", 403);
  }

  if (typeof amount !== "number" || isNaN(amount) || amount <= 0) {
    throw new AppError("A positive amount is required", 400);
  }

  const outstanding = getOutstandingBalance(member);
  if (outstanding <= 0) {
    throw new AppError("This membership has no outstanding balance", 400);
  }

  // Cap the order at what's actually owed - a client-supplied amount is
  // never trusted past this point, so overpaying (accidentally or not)
  // isn't possible.
  const chargeable = Math.min(amount, outstanding);

  const client = getClient();
  const order = await client.orders.create({
    amount: Math.round(chargeable * 100), // Razorpay wants paise, an integer
    currency: "INR",
    receipt: `member_${memberId}_${Date.now()}`,
    notes: { memberId, challengeId: member.challengeId },
  });

  await prisma.payment.create({
    data: {
      memberId,
      amount: chargeable,
      currency: "INR",
      status: "PENDING",
      razorpayOrderId: order.id,
    },
  });

  logger.info(
    `Razorpay order ${order.id} created for member ${memberId} (${chargeable} INR)`
  );

  return {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: config.razorpayKeyId,
    challengeName: member.challenge.name,
  };
};

/**
 * Verify a completed Razorpay checkout and, if the signature is genuine,
 * mark the payment paid and credit it against the member's balance.
 * @param {string} userId
 * @param {{razorpay_order_id: string, razorpay_payment_id: string, razorpay_signature: string}} payload
 */
const verifyPayment = async (userId, payload) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = payload;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw new AppError("Missing payment verification fields", 400);
  }

  const payment = await prisma.payment.findUnique({
    where: { razorpayOrderId: razorpay_order_id },
    include: { member: true },
  });

  if (!payment) {
    throw new AppError("Payment order not found", 404);
  }

  if (payment.member.userId !== userId) {
    throw new AppError("This payment does not belong to you", 403);
  }

  if (payment.status === "PAID") {
    // Already verified (e.g. a duplicate client callback) - just return
    // the existing record rather than double-crediting the balance.
    return payment;
  }

  // Razorpay's documented verification scheme: HMAC-SHA256 of
  // "<order_id>|<payment_id>" using the account's key secret must equal
  // the signature the client received from Checkout.
  const expectedSignature = crypto
    .createHmac("sha256", config.razorpayKeySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  const isValid = expectedSignature === razorpay_signature;

  if (!isValid) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED", razorpayPaymentId: razorpay_payment_id },
    });
    logger.warn(`Payment signature mismatch for order ${razorpay_order_id}`);
    throw new AppError("Payment verification failed", 400);
  }

  const [updatedPayment] = await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "PAID",
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
      },
    }),
    prisma.challengeMember.update({
      where: { id: payment.memberId },
      data: { totalPaid: { increment: payment.amount } },
    }),
  ]);

  await notificationService.createNotification(
    userId,
    "PAYMENT_RECEIVED",
    "Payment received",
    `Your payment of Rs. ${payment.amount} was received and credited to your balance.`,
    payment.member.challengeId
  );

  emitToUser(userId, "payment:confirmed", {
    memberId: payment.memberId,
    amount: payment.amount,
  });

  logger.info(
    `Payment ${razorpay_payment_id} verified for member ${payment.memberId} (${payment.amount} INR)`
  );

  return updatedPayment;
};

/**
 * A member's own payment history, most recent first. Scoped to the caller -
 * you can only see your own payments.
 */
const getPaymentHistory = async (userId, memberId) => {
  const member = await prisma.challengeMember.findUnique({
    where: { id: memberId },
  });

  if (!member) {
    throw new AppError("Membership not found", 404);
  }

  if (member.userId !== userId) {
    throw new AppError("You can only view your own payment history", 403);
  }

  return await prisma.payment.findMany({
    where: { memberId },
    orderBy: { createdAt: "desc" },
  });
};

/**
 * Record a payment the owner received outside the app - cash, a direct UPI
 * transfer, etc. - rather than through Razorpay Checkout. Owner-only, and
 * (like adjustMemberPenalty) the owner cannot record a payment against
 * their own membership.
 * @param {string} ownerId - Authenticated user, must own the challenge
 * @param {string} challengeId
 * @param {string} memberId
 * @param {number} amount - Amount in rupees
 * @param {string} note - What/how it was paid, for the record
 */
const recordManualPayment = async (ownerId, challengeId, memberId, amount, note) => {
  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
  });

  if (!challenge) {
    throw new AppError("Challenge not found", 404);
  }

  if (challenge.ownerId !== ownerId) {
    throw new AppError("Only the challenge owner can record a payment", 403);
  }

  const member = await prisma.challengeMember.findUnique({
    where: { id: memberId },
  });

  if (!member || member.challengeId !== challengeId) {
    throw new AppError("Member not found in this challenge", 404);
  }

  if (member.userId === ownerId) {
    throw new AppError("You cannot record a payment against your own membership", 403);
  }

  if (typeof amount !== "number" || isNaN(amount) || amount <= 0) {
    throw new AppError("A positive amount is required", 400);
  }

  const outstanding = getOutstandingBalance(member);
  if (amount > outstanding) {
    throw new AppError(
      `Amount exceeds outstanding balance of ${outstanding}`,
      400
    );
  }

  const [payment] = await prisma.$transaction([
    prisma.payment.create({
      data: {
        memberId,
        amount,
        status: "PAID",
        method: "MANUAL",
        recordedBy: ownerId,
        note: note?.trim() || null,
      },
    }),
    prisma.challengeMember.update({
      where: { id: memberId },
      data: { totalPaid: { increment: amount } },
    }),
  ]);

  await notificationService.createNotification(
    member.userId,
    "PAYMENT_RECEIVED",
    "Payment recorded",
    `The challenge owner recorded a payment of Rs. ${amount} from you${note ? ` (${note.trim()})` : ""}.`,
    challengeId
  );

  emitToUser(member.userId, "payment:confirmed", { memberId, amount });

  logger.info(
    `Manual payment of ${amount} INR recorded for member ${memberId} by owner ${ownerId}`
  );

  return payment;
};

/**
 * A member's full financial history for a challenge - every penalty and
 * every payment, merged and time-ordered, with a running balance. Either
 * the member themselves or the challenge owner can view it.
 */
const getFullLedger = async (userId, memberId) => {
  const member = await prisma.challengeMember.findUnique({
    where: { id: memberId },
    include: { challenge: { select: { ownerId: true, name: true } } },
  });

  if (!member) {
    throw new AppError("Membership not found", 404);
  }

  if (member.userId !== userId && member.challenge.ownerId !== userId) {
    throw new AppError("You are not allowed to view this ledger", 403);
  }

  const [penalties, payments] = await Promise.all([
    prisma.penaltyLedger.findMany({ where: { memberId }, orderBy: { date: "asc" } }),
    prisma.payment.findMany({
      where: { memberId, status: "PAID" },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const events = [
    ...penalties.map((p) => ({
      type: "PENALTY",
      id: p.id,
      amount: p.amount,
      reason: p.reason,
      date: p.date,
      disputed: p.disputed,
      disputeStatus: p.disputeStatus,
      disputeReason: p.disputeReason,
      resolutionNote: p.resolutionNote,
    })),
    ...payments.map((p) => ({
      type: "PAYMENT",
      id: p.id,
      amount: -p.amount, // reduces the balance
      method: p.method,
      note: p.note,
      date: p.createdAt,
    })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  let runningBalance = 0;
  const withBalance = events.map((event) => {
    runningBalance += event.amount;
    return { ...event, runningBalance };
  });

  return {
    challengeName: member.challenge.name,
    totalPenalties: member.totalPenalties,
    totalPaid: member.totalPaid,
    outstanding: getOutstandingBalance(member),
    events: withBalance,
  };
};

module.exports = {
  createOrder,
  verifyPayment,
  getPaymentHistory,
  getOutstandingBalance,
  recordManualPayment,
  getFullLedger,
};
