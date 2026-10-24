const test = require("node:test");
const assert = require("node:assert/strict");

const state = {
  member: null,
  entries: [],
};

const prisma = {
  challengeMember: {
    findUnique: async () => ({
      ...structuredClone(state.member),
      challenge: { id: "challenge-1", name: "Daily" },
      user: { id: "user-1" },
    }),
  },
};

const transaction = {
  challengeMember: {
    updateMany: async ({ where, data }) => {
      const totalFilter = where.totalPenalties;
      if (
        state.member.id !== where.id ||
        state.member.totalPaid !== where.totalPaid ||
        state.member.reservedPayments !== where.reservedPayments ||
        (typeof totalFilter === "number" &&
          state.member.totalPenalties !== totalFilter) ||
        (typeof totalFilter === "object" &&
          (state.member.totalPenalties !== totalFilter.equals ||
            state.member.totalPenalties < totalFilter.gte))
      ) {
        return { count: 0 };
      }
      state.member.totalPenalties += data.totalPenalties.increment;
      return { count: 1 };
    },
  },
  penaltyLedger: {
    create: async ({ data }) => {
      const entry = { id: `penalty-${state.entries.length + 1}`, ...data };
      state.entries.push(entry);
      return structuredClone(entry);
    },
  },
};

const prismaPath = require.resolve("../src/config/prisma");
const notificationPath = require.resolve("../src/services/notification.service");
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: {
    prisma: {
      ...prisma,
      $transaction: async (callback) => callback(transaction),
    },
  },
};
require.cache[notificationPath] = {
  id: notificationPath,
  filename: notificationPath,
  loaded: true,
  exports: { createNotification: async () => {} },
};

const { applyPenalty } = require("../src/services/penalty.service");

test.beforeEach(() => {
  state.member = {
    id: "member-1",
    totalPenalties: 100,
    totalPaid: 20,
    reservedPayments: 30,
  };
  state.entries = [];
});

test("records an adjustment while keeping paid and reserved balances covered", async () => {
  const entry = await applyPenalty(
    "member-1",
    -50,
    "Correction",
    new Date("2026-10-20T00:00:00.000Z")
  );

  assert.equal(entry.amount, -50);
  assert.equal(state.member.totalPenalties, 50);
  assert.equal(state.entries.length, 1);
});

test("rejects an adjustment that would undercut paid or reserved amounts", async () => {
  await assert.rejects(
    applyPenalty("member-1", -51, "Correction"),
    { statusCode: 409 }
  );

  assert.equal(state.member.totalPenalties, 100);
  assert.equal(state.entries.length, 0);
});

test("records positive penalties and updates the aggregate", async () => {
  const entry = await applyPenalty("member-1", 15, "Missed target");

  assert.equal(entry.amount, 15);
  assert.equal(state.member.totalPenalties, 115);
  assert.equal(state.entries.length, 1);
});
