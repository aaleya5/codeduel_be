const test = require("node:test");
const assert = require("node:assert/strict");

const state = {
  penalty: null,
  updates: [],
  notifications: [],
  events: [],
};

const prisma = {
  penaltyLedger: {
    findUnique: async () => structuredClone(state.penalty),
    update: async ({ data }) => {
      state.updates.push(data);
      Object.assign(state.penalty, data);
      return structuredClone(state.penalty);
    },
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
  exports: { emitToChallenge: (...args) => state.events.push(args) },
};
require.cache[notificationPath] = {
  id: notificationPath,
  filename: notificationPath,
  loaded: true,
  exports: {
    createNotification: async (...args) => state.notifications.push(args),
  },
};

const { disputePenalty, resolveDispute } = require("../src/services/penalty.service");

test.beforeEach(() => {
  state.penalty = {
    id: "penalty-1",
    memberId: "member-1",
    amount: 10,
    reason: "Missed day",
    disputeStatus: "NONE",
    member: {
      userId: "member-user",
      user: { id: "member-user", username: "member" },
      challenge: {
        id: "challenge-1",
        name: "Daily",
        ownerId: "owner-user",
      },
    },
  };
  state.updates = [];
  state.notifications = [];
  state.events = [];
});

test("challenge owner cannot dispute their own penalty", async () => {
  state.penalty.member.userId = "owner-user";
  state.penalty.member.user.id = "owner-user";

  await assert.rejects(
    disputePenalty("owner-user", "penalty-1", "I disagree"),
    { statusCode: 403 }
  );
  assert.equal(state.updates.length, 0);
  assert.equal(state.notifications.length, 0);
});

test("challenge owner cannot resolve their own dispute", async () => {
  state.penalty.member.userId = "owner-user";
  state.penalty.member.user.id = "owner-user";
  state.penalty.disputeStatus = "PENDING";

  await assert.rejects(
    resolveDispute("owner-user", "penalty-1", "WAIVE", "Self-review"),
    { statusCode: 403 }
  );
  assert.equal(state.updates.length, 0);
  assert.equal(state.notifications.length, 0);
});

test("a non-owner member can submit one dispute", async () => {
  const result = await disputePenalty(
    "member-user",
    "penalty-1",
    "The submission was accepted"
  );

  assert.equal(result.disputeStatus, "PENDING");
  assert.equal(result.disputeReason, "The submission was accepted");
  assert.equal(state.notifications.length, 1);
  assert.equal(state.events.length, 1);
});
