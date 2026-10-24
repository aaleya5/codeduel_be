const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { config } = require("../src/config/env");

config.razorpayKeySecret = "checkout-secret";
config.razorpayWebhookSecret = "webhook-secret";

const state = {
  payment: null,
  totalPaid: 0,
  reservedPayments: 0,
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
      state.reservedPayments -= data.reservedPayments.decrement;
    },
  },
};

const prisma = {
  payment: {
    findUnique: async () => ({
      ...clone(state.payment),
      member: {
        userId: "user-1",
        challengeId: "challenge-1",
        totalPaid: 0,
        reservedPayments: 25,
      },
    }),
  },
  $transaction: async (callback) => callback(transactionClient),
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

const { processRazorpayWebhook } = require("../src/services/payment.service");

const makeWebhook = (overrides = {}) => {
  const event = {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay-1",
          order_id: "order-1",
          status: "captured",
          amount: 2500,
          currency: "INR",
          ...overrides,
        },
      },
    },
  };
  const rawBody = Buffer.from(JSON.stringify(event));
  const signature = crypto
    .createHmac("sha256", config.razorpayWebhookSecret)
    .update(rawBody)
    .digest("hex");
  return { rawBody, signature };
};

test.beforeEach(() => {
  state.payment = {
    id: "db-payment-1",
    memberId: "member-1",
    amount: 25,
    currency: "INR",
    status: "PENDING",
    method: "RAZORPAY",
    razorpayOrderId: "order-1",
  };
  state.totalPaid = 0;
  state.reservedPayments = 25;
  state.notifications = [];
  state.events = [];
});

test("valid captured event reconciles payment and releases its reservation", async () => {
  const result = await processRazorpayWebhook(...Object.values(makeWebhook()));

  assert.deepEqual(result, { processed: true, duplicate: false });
  assert.equal(state.payment.status, "PAID");
  assert.equal(state.payment.razorpayPaymentId, "pay-1");
  assert.equal(state.totalPaid, 25);
  assert.equal(state.reservedPayments, 0);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.events.length, 1);
});

test("replayed captured event does not credit twice", async () => {
  const webhook = makeWebhook();
  await processRazorpayWebhook(webhook.rawBody, webhook.signature);
  const result = await processRazorpayWebhook(
    webhook.rawBody,
    webhook.signature
  );

  assert.deepEqual(result, { processed: true, duplicate: true });
  assert.equal(state.totalPaid, 25);
  assert.equal(state.reservedPayments, 0);
  assert.equal(state.notifications.length, 1);
});

test("rejects an invalid webhook signature without changing payment state", async () => {
  const { rawBody } = makeWebhook();

  await assert.rejects(
    processRazorpayWebhook(rawBody, "00".repeat(32)),
    { statusCode: 400 }
  );
  assert.equal(state.payment.status, "PENDING");
  assert.equal(state.totalPaid, 0);
  assert.equal(state.reservedPayments, 25);
});

test("does not credit a captured event whose amount or currency differs", async () => {
  const webhook = makeWebhook({ amount: 2400 });

  const result = await processRazorpayWebhook(
    webhook.rawBody,
    webhook.signature
  );

  assert.deepEqual(result, {
    processed: false,
    reason: "payment_mismatch",
  });
  assert.equal(state.payment.status, "PENDING");
  assert.equal(state.totalPaid, 0);
  assert.equal(state.reservedPayments, 25);
});

test("acknowledges unrelated signed event types without crediting", async () => {
  const rawBody = Buffer.from(JSON.stringify({ event: "order.paid" }));
  const signature = crypto
    .createHmac("sha256", config.razorpayWebhookSecret)
    .update(rawBody)
    .digest("hex");

  const result = await processRazorpayWebhook(rawBody, signature);

  assert.deepEqual(result, {
    processed: false,
    reason: "unsupported_event",
  });
  assert.equal(state.payment.status, "PENDING");
  assert.equal(state.totalPaid, 0);
});
