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
 * subtracting what they've already paid. Pending Razorpay orders reserve
 * part of this balance until they are verified.
 */
const getOutstandingBalance = (member) =>
  Math.max(0, member.totalPenalties - member.totalPaid);

const getUnreservedBalance = (member) =>
  Math.max(
    0,
    member.totalPenalties - member.totalPaid - (member.reservedPayments || 0)
  );

const floorToPaisa = (amount) =>
  Math.floor(
    amount * 100 + Number.EPSILON * Math.max(1, Math.abs(amount)) * 100
  ) / 100;

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

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new AppError("A positive amount is required", 400);
  }

  const unreservedBalance = getUnreservedBalance(member);
  if (unreservedBalance <= 0) {
    throw new AppError("This membership has no outstanding balance", 400);
  }

  const requestedAmount = Math.round(amount * 100) / 100;
  const chargeable = Math.min(
    requestedAmount,
    floorToPaisa(unreservedBalance)
  );
  if (chargeable <= 0) {
    throw new AppError("The available balance is less than one paisa", 400);
  }

  const client = getClient();
  const order = await client.orders.create({
    amount: Math.round(chargeable * 100), // Razorpay wants paise, an integer
    currency: "INR",
    receipt: `member_${memberId}_${Date.now()}`,
    notes: { memberId, challengeId: member.challengeId },
  });

  await prisma.$transaction(async (transaction) => {
    const reservation = await transaction.challengeMember.updateMany({
      where: {
        id: memberId,
        totalPenalties: member.totalPenalties,
        totalPaid: member.totalPaid,
        reservedPayments: {
          lte:
            member.totalPenalties -
            member.totalPaid -
            chargeable,
        },
      },
      data: { reservedPayments: { increment: chargeable } },
    });

    if (reservation.count !== 1) {
      throw new AppError(
        "The available balance changed. Refresh the balance and try again.",
        409
      );
    }

    await transaction.payment.create({
      data: {
        memberId,
        amount: chargeable,
        currency: "INR",
        status: "PENDING",
        razorpayOrderId: order.id,
      },
    });
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
    logger.warn(`Payment signature mismatch for order ${razorpay_order_id}`);
    throw new AppError("Payment verification failed", 400);
  }

  return creditPendingPayment(payment, razorpay_payment_id, razorpay_signature);
};

const creditPendingPayment = async (payment, paymentId, signature = null) => {
  const result = await prisma.$transaction(async (transaction) => {
    const claimed = await transaction.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: {
        status: "PAID",
        razorpayPaymentId: paymentId,
        ...(signature ? { razorpaySignature: signature } : {}),
      },
    });

    if (claimed.count !== 1) {
      const currentPayment = await transaction.payment.findUnique({
        where: { id: payment.id },
      });
      if (currentPayment?.status === "PAID") {
        return { payment: currentPayment, credited: false };
      }
      throw new AppError("This payment is no longer payable", 409);
    }

    await transaction.challengeMember.update({
      where: { id: payment.memberId },
      data: {
        totalPaid: { increment: payment.amount },
        reservedPayments: { decrement: payment.amount },
      },
    });

    return {
      payment: await transaction.payment.findUnique({
        where: { id: payment.id },
      }),
      credited: true,
    };
  });

  if (!result.credited) {
    return result.payment;
  }

  const updatedPayment = result.payment;

  try {
    await notificationService.createNotification(
      payment.member.userId,
      "PAYMENT_RECEIVED",
      "Payment received",
      `Your payment of Rs. ${payment.amount} was received and credited to your balance.`,
      payment.member.challengeId
    );
    emitToUser(payment.member.userId, "payment:confirmed", {
      memberId: payment.memberId,
      amount: payment.amount,
    });
  } catch (error) {
    logger.error(
      `Payment ${paymentId} was credited but confirmation notification failed:`,
      error
    );
  }

  logger.info(
    `Payment ${paymentId} verified for member ${payment.memberId} (${payment.amount} INR)`
  );

  return updatedPayment;
};

const processRazorpayWebhook = async (rawBody, signature) => {
  if (!config.razorpayWebhookSecret) {
    throw new AppError("Razorpay webhook is not configured", 503);
  }
  if (!Buffer.isBuffer(rawBody) || !signature) {
    throw new AppError("Missing raw webhook body or signature", 400);
  }

  const expected = crypto
    .createHmac("sha256", config.razorpayWebhookSecret)
    .update(rawBody)
    .digest();
  let received;
  try {
    received = Buffer.from(signature, "hex");
  } catch {
    throw new AppError("Invalid Razorpay webhook signature", 400);
  }
  if (
    received.length !== expected.length ||
    !crypto.timingSafeEqual(expected, received)
  ) {
    throw new AppError("Invalid Razorpay webhook signature", 400);
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new AppError("Invalid Razorpay webhook JSON", 400);
  }

  if (event.event !== "payment.captured") {
    return { processed: false, reason: "unsupported_event" };
  }

  const capturedPayment = event.payload?.payment?.entity;
  if (
    capturedPayment?.status !== "captured" ||
    typeof capturedPayment.id !== "string" ||
    typeof capturedPayment.order_id !== "string" ||
    !Number.isInteger(capturedPayment.amount) ||
    capturedPayment.amount <= 0 ||
    typeof capturedPayment.currency !== "string"
  ) {
    throw new AppError("Malformed Razorpay payment.captured event", 400);
  }

  const payment = await prisma.payment.findUnique({
    where: { razorpayOrderId: capturedPayment.order_id },
    include: { member: true },
  });
  if (!payment) {
    logger.warn(
      `Ignoring captured Razorpay payment for unknown order ${capturedPayment.order_id}`
    );
    return { processed: false, reason: "order_not_found" };
  }

  const expectedAmount = Math.round(payment.amount * 100);
  if (
    capturedPayment.amount !== expectedAmount ||
    capturedPayment.currency !== payment.currency ||
    payment.method !== "RAZORPAY"
  ) {
    logger.error(
      `Ignoring captured Razorpay payment with mismatched order details for ${capturedPayment.order_id}`
    );
    return { processed: false, reason: "payment_mismatch" };
  }

  const result = await creditPendingPayment(
    payment,
    capturedPayment.id
  );
  return {
    processed: result.status === "PAID",
    duplicate: payment.status === "PAID",
  };
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

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new AppError("A positive amount is required", 400);
  }

  const unreservedBalance = getUnreservedBalance(member);
  const normalizedAmount = Math.round(amount * 100) / 100;
  if (normalizedAmount <= 0) {
    throw new AppError("A payment must be at least one paisa", 400);
  }
  if (normalizedAmount > unreservedBalance) {
    throw new AppError(
      `Amount exceeds available balance of ${unreservedBalance}`,
      400
    );
  }

  const payment = await prisma.$transaction(async (transaction) => {
    const balanceUpdate = await transaction.challengeMember.updateMany({
      where: {
        id: memberId,
        totalPenalties: member.totalPenalties,
        totalPaid: member.totalPaid,
        reservedPayments: {
          lte: member.totalPenalties - member.totalPaid - normalizedAmount,
        },
      },
      data: { totalPaid: { increment: normalizedAmount } },
    });
    if (balanceUpdate.count !== 1) {
      throw new AppError(
        "The available balance changed. Refresh the balance and try again.",
        409
      );
    }

    return transaction.payment.create({
      data: {
        memberId,
        amount: normalizedAmount,
        status: "PAID",
        method: "MANUAL",
        recordedBy: ownerId,
        note: note?.trim() || null,
      },
    });
  });

  await notificationService.createNotification(
    member.userId,
    "PAYMENT_RECEIVED",
    "Payment recorded",
    `The challenge owner recorded a payment of Rs. ${normalizedAmount} from you${note ? ` (${note.trim()})` : ""}.`,
    challengeId
  );

  emitToUser(member.userId, "payment:confirmed", {
    memberId,
    amount: normalizedAmount,
  });

  logger.info(
    `Manual payment of ${normalizedAmount} INR recorded for member ${memberId} by owner ${ownerId}`
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
  processRazorpayWebhook,
  getPaymentHistory,
  getOutstandingBalance,
  recordManualPayment,
  getFullLedger,
};
