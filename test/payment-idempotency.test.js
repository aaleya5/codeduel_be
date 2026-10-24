const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { config } = require("../src/config/env");

config.razorpayKeyId = "test-key";
config.razorpayKeySecret = "test-secret";

const state = {
  payment: null,
  member: null,
  notifications: [],
  events: [],
};

const clone = (value) => (value ? structuredClone(value) : value);
let orderNumber = 0;
class MockRazorpay {
  constructor() {
    this.orders = {
      create: async ({ amount, currency }) => ({
        id: `order-${++orderNumber}`,
        amount,
        currency,
      }),
    };
  }
}

const razorpayPath = require.resolve("razorpay");
require.cache[razorpayPath] = {
  id: razorpayPath,
  filename: razorpayPath,
  loaded: true,
  exports: MockRazorpay,
};

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
    create: async ({ data }) => {
      state.payment = { id: `db-${Date.now()}`, ...data };
      return clone(state.payment);
    },
  },
  challengeMember: {
    updateMany: async ({ where, data }) => {
      const member = state.member;
      if (
        member.id !== where.id ||
        member.totalPenalties !== where.totalPenalties ||
        member.totalPaid !== where.totalPaid ||
        member.reservedPayments > where.reservedPayments.lte
      ) {
        return { count: 0 };
      }
      if (data.reservedPayments?.increment !== undefined) {
        member.reservedPayments += data.reservedPayments.increment;
      }
      if (data.totalPaid?.increment !== undefined) {
        member.totalPaid += data.totalPaid.increment;
      }
      return { count: 1 };
    },
    update: async ({ data }) => {
      if (data.totalPaid?.increment !== undefined) {
        state.member.totalPaid += data.totalPaid.increment;
      }
      if (data.reservedPayments?.decrement !== undefined) {
        state.member.reservedPayments -= data.reservedPayments.decrement;
      }
    },
  },
};

let transactionQueue = Promise.resolve();
const prisma = {
  challenge: {
    findUnique: async () => ({ ownerId: "owner-1" }),
  },
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
  challengeMember: {
    findUnique: async () => ({
      ...clone(state.member),
      challenge: { id: "challenge-1", name: "Daily" },
    }),
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

const {
  createOrder,
  recordManualPayment,
  verifyPayment,
} = require("../src/services/payment.service");

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
  orderNumber = 0;
  state.member = {
    id: "member-1",
    userId: "user-1",
    challengeId: "challenge-1",
    totalPenalties: 100,
    totalPaid: 0,
    reservedPayments: 25,
  };
  state.payment = {
    id: "db-payment-1",
    memberId: "member-1",
    amount: 25,
    status: "PENDING",
    method: "RAZORPAY",
    razorpayOrderId: "order-1",
    member: { userId: "user-1", challengeId: "challenge-1" },
  };
  state.notifications = [];
  state.events = [];
  transactionQueue = Promise.resolve();
});

test("verifies valid payment and credits the member balance once", async () => {
  const result = await verifyPayment("user-1", paymentPayload());

  assert.equal(result.status, "PAID");
  assert.equal(state.payment.razorpayPaymentId, "payment-1");
  assert.equal(state.member.totalPaid, 25);
  assert.equal(state.member.reservedPayments, 0);
  assert.equal(state.notifications.length, 1);
});

test("concurrent payment verification cannot double-credit", async () => {
  const payload = paymentPayload();
  const results = await Promise.all([
    verifyPayment("user-1", payload),
    verifyPayment("user-1", payload),
  ]);

  assert.equal(results.every((result) => result.status === "PAID"), true);
  assert.equal(state.member.totalPaid, 25);
  assert.equal(state.member.reservedPayments, 0);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.events.length, 1);
});

test("rejects payment verification by another user", async () => {
  await assert.rejects(verifyPayment("other-user", paymentPayload()), {
    statusCode: 403,
  });
  assert.equal(state.member.totalPaid, 0);
  assert.equal(state.payment.status, "PENDING");
});

test("rejects invalid payment signatures without crediting", async () => {
  const payload = paymentPayload();
  payload.razorpay_signature = "invalid";

  await assert.rejects(verifyPayment("user-1", payload), { statusCode: 400 });
  assert.equal(state.member.totalPaid, 0);
  assert.equal(state.member.reservedPayments, 25);
  assert.equal(state.payment.status, "PENDING");
});

test("a payment order reserves its amount from the available balance", async () => {
  state.payment = null;
  state.member.reservedPayments = 0;

  const order = await createOrder("user-1", "member-1", 70);

  assert.equal(order.amount, 7000);
  assert.equal(state.member.reservedPayments, 70);
  assert.equal(state.payment.amount, 70);
  assert.equal(state.payment.status, "PENDING");
});

test("rounds a floating-point balance down to the exact available paise", async () => {
  state.payment = null;
  state.member.totalPenalties = 1.15;
  state.member.reservedPayments = 0;

  const order = await createOrder("user-1", "member-1", 10);

  assert.equal(order.amount, 115);
  assert.equal(state.payment.amount, 1.15);
  assert.equal(state.member.reservedPayments, 1.15);
});

test("concurrent orders cannot reserve more than the outstanding balance", async () => {
  state.payment = null;
  state.member.reservedPayments = 0;

  const results = await Promise.allSettled([
    createOrder("user-1", "member-1", 80),
    createOrder("user-1", "member-1", 80),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(state.member.reservedPayments, 80);
});

test("manual payments cannot consume balance reserved by an open order", async () => {
  state.member.reservedPayments = 60;

  await assert.rejects(
    recordManualPayment("owner-1", "challenge-1", "member-1", 50, "UPI"),
    { statusCode: 400 }
  );
  assert.equal(state.member.totalPaid, 0);
  assert.equal(state.notifications.length, 0);
});

test("manual payments update the ledger and total atomically within remaining balance", async () => {
  state.member.reservedPayments = 60;

  const payment = await recordManualPayment(
    "owner-1",
    "challenge-1",
    "member-1",
    40,
    "UPI"
  );

  assert.equal(payment.amount, 40);
  assert.equal(state.member.totalPaid, 40);
  assert.equal(state.member.reservedPayments, 60);
  assert.equal(state.notifications.length, 1);
});
