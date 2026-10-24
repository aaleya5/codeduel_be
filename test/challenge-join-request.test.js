const test = require("node:test");
const assert = require("node:assert/strict");

const state = {
  challenge: { id: "challenge-1", name: "Daily", ownerId: "owner-1" },
  request: {
    id: "request-1",
    challengeId: "challenge-1",
    userId: "member-1",
    status: "PENDING",
    user: { id: "member-1", username: "member" },
  },
  membership: null,
  notifications: [],
  events: [],
  upsertCount: 0,
};

const clone = (value) => (value ? structuredClone(value) : value);
const prisma = {
  challenge: {
    findUnique: async () => clone(state.challenge),
  },
  challengeJoinRequest: {
    findUnique: async () => clone(state.request),
    updateMany: async ({ where, data }) => {
      if (state.request.id !== where.id || state.request.status !== where.status) {
        return { count: 0 };
      }
      state.request.status = data.status;
      return { count: 1 };
    },
  },
  challengeMember: {
    upsert: async ({ create, update }) => {
      state.upsertCount += 1;
      state.membership = state.membership
        ? { ...state.membership, ...update }
        : { ...create, isActive: true };
      return clone(state.membership);
    },
  },
  $transaction: async (callback) => callback(prisma),
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
  exports: {
    emitToChallenge: (...args) => state.events.push(args),
  },
};
require.cache[notificationPath] = {
  id: notificationPath,
  filename: notificationPath,
  loaded: true,
  exports: {
    createNotification: async (...args) => state.notifications.push(args),
  },
};

const { resolveJoinRequest } = require("../src/services/challenge.service");

test.beforeEach(() => {
  state.challenge = { id: "challenge-1", name: "Daily", ownerId: "owner-1" };
  state.request = {
    id: "request-1",
    challengeId: "challenge-1",
    userId: "member-1",
    status: "PENDING",
    user: { id: "member-1", username: "member" },
  };
  state.membership = null;
  state.notifications = [];
  state.events = [];
  state.upsertCount = 0;
});

test("approving a request activates one membership", async () => {
  const result = await resolveJoinRequest(
    "owner-1",
    "challenge-1",
    "request-1",
    "APPROVED"
  );

  assert.equal(result.status, "APPROVED");
  assert.deepEqual(state.membership, {
    challengeId: "challenge-1",
    userId: "member-1",
    isActive: true,
  });
  assert.equal(state.upsertCount, 1);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.events.length, 1);
});

test("rejecting a request does not create a membership", async () => {
  const result = await resolveJoinRequest(
    "owner-1",
    "challenge-1",
    "request-1",
    "REJECTED"
  );

  assert.equal(result.status, "REJECTED");
  assert.equal(state.membership, null);
  assert.equal(state.upsertCount, 0);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.events.length, 0);
});

test("a non-owner cannot review a join request", async () => {
  await assert.rejects(
    resolveJoinRequest("member-1", "challenge-1", "request-1", "APPROVED"),
    { statusCode: 403 }
  );
  assert.equal(state.request.status, "PENDING");
  assert.equal(state.upsertCount, 0);
});

test("concurrent approvals only transition and activate once", async () => {
  const decisions = await Promise.allSettled([
    resolveJoinRequest("owner-1", "challenge-1", "request-1", "APPROVED"),
    resolveJoinRequest("owner-1", "challenge-1", "request-1", "APPROVED"),
  ]);

  assert.equal(decisions.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(decisions.filter((result) => result.status === "rejected").length, 1);
  assert.equal(state.request.status, "APPROVED");
  assert.equal(state.upsertCount, 1);
  assert.equal(state.notifications.length, 1);
});
