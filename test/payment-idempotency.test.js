const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { config } = require("../src/config/env");

config.razorpayKeySecret = "test-secret";

const state = {
  payment: null,
  totalPaid: 0,
  notifications: [],
  events: [],
};

const clone = (value) => (value ? structuredClone(value) : value);
const transactionClient = {
  payment: {
    updateMany: async ({ where, data }) => {
      if (
        state.payment.id !== where.id ||
        state.payment.status !== where.status
      ) {
        return { count: 0 };
      }
      Object.assign(state.payment, data);
      return { count: 1 };
    },
    findUnique: async () => clone(state.payment),
  },
  challengeMember: {
    update: async ({ data }) => {
      state.totalPaid += data.totalPaid.increment;
    },
  },
};

let transactionQueue = Promise.resolve();
const prisma = {
  payment: {
    findUnique: async () => ({
      ...clone(state.payment),
      member: { userId: "user-1", challengeId: "challenge-1" },
    }),
    update: async ({ data }) => {
      Object.assign(state.payment, data);
      return clone(state.payment);
    },
  },
  $transaction: async (callback) => {
    let release;
    const previous = transactionQueue;
    transactionQueue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await callback(transactionClient);
    } finally {
      release();
    }
  },
};

const prismaPath = require.resolve("../src/config/prisma");
const socketPath = require.resolve("../src/config/socket");
const notificationPath = require.resolve("../src/services/notification.service");
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: { prisma },
};
require.cache[socketPath] = {
  id: socketPath,
  filename: socketPath,
  loaded: true,
  exports: { emitToUser: (...args) => state.events.push(args) },
};
require.cache[notificationPath] = {
  id: notificationPath,
  filename: notificationPath,
  loaded: true,
  exports: {
    createNotification: async (...args) => state.notifications.push(args),
  },
};

const { verifyPayment } = require("../src/services/payment.service");

const paymentPayload = () => {
  const razorpay_order_id = "order-1";
  const razorpay_payment_id = "payment-1";
  const razorpay_signature = crypto
    .createHmac("sha256", config.razorpayKeySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");
  return { razorpay_order_id, razorpay_payment_id, razorpay_signature };
};

test.beforeEach(() => {
  state.payment = {
    id: "db-payment-1",
    memberId: "member-1",
    amount: 25,
    status: "PENDING",
    member: { userId: "user-1", challengeId: "challenge-1" },
  };
  state.totalPaid = 0;
  state.notifications = [];
  state.events = [];
  transactionQueue = Promise.resolve();
});

test("verifies valid payment and credits the member balance once", async () => {
  const result = await verifyPayment("user-1", paymentPayload());

  assert.equal(result.status, "PAID");
  assert.equal(state.payment.razorpayPaymentId, "payment-1");
  assert.equal(state.totalPaid, 25);
  assert.equal(state.notifications.length, 1);
});

test("concurrent payment verification cannot double-credit", async () => {
  const payload = paymentPayload();
  const results = await Promise.all([
    verifyPayment("user-1", payload),
    verifyPayment("user-1", payload),
  ]);

  assert.equal(results.every((result) => result.status === "PAID"), true);
  assert.equal(state.totalPaid, 25);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.events.length, 1);
});

test("rejects payment verification by another user", async () => {
  await assert.rejects(verifyPayment("other-user", paymentPayload()), {
    statusCode: 403,
  });
  assert.equal(state.totalPaid, 0);
  assert.equal(state.payment.status, "PENDING");
});

test("rejects invalid payment signatures without crediting", async () => {
  const payload = paymentPayload();
  payload.razorpay_signature = "invalid";

  await assert.rejects(verifyPayment("user-1", payload), { statusCode: 400 });
  assert.equal(state.totalPaid, 0);
  assert.equal(state.payment.status, "FAILED");
});
