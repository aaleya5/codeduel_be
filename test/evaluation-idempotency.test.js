const test = require("node:test");
const assert = require("node:assert/strict");

const state = {
  dailyResults: [],
  penalties: [],
  member: null,
  submissionsError: null,
  sessionError: null,
  metadataError: null,
  unknownDifficulty: false,
  submissionFetches: 0,
  ledgerError: false,
  notifications: [],
  events: [],
};

const clone = (value) => structuredClone(value);
const transactionClient = {
  dailyResult: {
    create: async ({ data }) => {
      const duplicate = state.dailyResults.some(
        (result) =>
          result.challengeId === data.challengeId &&
          result.memberId === data.memberId &&
          result.date.getTime() === data.date.getTime()
      );
      if (duplicate) {
        const error = new Error("Unique constraint failed");
        error.code = "P2002";
        throw error;
      }
      const result = { id: "daily-result", ...data };
      state.dailyResults.push(result);
      return clone(result);
    },
  },
  challengeMember: {
    findUnique: async () =>
      state.member ? { ...clone(state.member) } : null,
    update: async ({ data }) => {
      const scalarUpdates = { ...data };
      delete scalarUpdates.totalPenalties;
      Object.assign(state.member, scalarUpdates);
      if (data.totalPenalties?.increment !== undefined) {
        state.member.totalPenalties += data.totalPenalties.increment;
      }
      return clone(state.member);
    },
  },
  penaltyLedger: {
    create: async ({ data }) => {
      if (state.ledgerError) {
        throw new Error("Simulated ledger write failure");
      }
      const penalty = { id: "penalty", ...data };
      state.penalties.push(penalty);
      return clone(penalty);
    },
  },
};

const prisma = {
  dailyResult: {
    findFirst: async () => {
      const sorted = [...state.dailyResults].sort(
        (left, right) => right.date.getTime() - left.date.getTime()
      );
      return sorted[0] ? { date: sorted[0].date } : null;
    },
  },
  $transaction: async (callback) => {
    let release;
    const previous = transactionQueue;
    transactionQueue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    const before = {
      dailyResults: clone(state.dailyResults),
      penalties: clone(state.penalties),
      member: clone(state.member),
    };
    try {
      return await callback(transactionClient);
    } catch (error) {
      state.dailyResults = before.dailyResults;
      state.penalties = before.penalties;
      state.member = before.member;
      throw error;
    } finally {
      release();
    }
  },
};
let transactionQueue = Promise.resolve();

const prismaPath = require.resolve("../src/config/prisma");
const leetcodePath = require.resolve("../src/services/leetcode.service");
const notificationPath = require.resolve("../src/services/notification.service");
const socketPath = require.resolve("../src/config/socket");
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: { prisma },
};
require.cache[leetcodePath] = {
  id: leetcodePath,
  filename: leetcodePath,
  loaded: true,
  exports: {
    getUserSession: async () => {
      if (state.sessionError) throw state.sessionError;
      return null;
    },
    fetchSubmissionsForDate: async () => {
      state.submissionFetches += 1;
      if (state.submissionsError) throw state.submissionsError;
      return [{ title: "Two Sum", titleSlug: "two-sum", timestamp: "1" }];
    },
    enrichSubmissionsWithMetadata: async (submissions) => {
      if (state.metadataError) throw state.metadataError;
      return submissions.map((submission) => ({
        ...submission,
        difficulty: state.unknownDifficulty ? "Unknown" : "Easy",
        language: "javascript",
      }));
    },
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
require.cache[socketPath] = {
  id: socketPath,
  filename: socketPath,
  loaded: true,
  exports: {
    emitToChallenge: (...args) => state.events.push(args),
    emitBroadcast: (...args) => state.events.push(args),
  },
};

const {
  evaluateChallenge,
  evaluateMember,
} = require("../src/services/evaluation.service");

const challenge = {
  id: "challenge-1",
  name: "Daily",
  penaltyAmount: 10,
  minSubmissionsPerDay: 2,
  difficultyFilter: [],
  uniqueProblemConstraint: true,
};
const member = {
  id: "member-1",
  user: {
    id: "user-1",
    username: "member",
    leetcodeUsername: "leetcode-member",
  },
};
const evaluationDate = new Date("2026-10-22T00:00:00.000Z");

test.beforeEach(() => {
  state.dailyResults = [];
  state.penalties = [];
  state.member = {
    id: member.id,
    currentStreak: 4,
    longestStreak: 9,
    totalPenalties: 20,
  };
  state.submissionsError = null;
  state.sessionError = null;
  state.metadataError = null;
  state.unknownDifficulty = false;
  state.submissionFetches = 0;
  state.ledgerError = false;
  transactionQueue = Promise.resolve();
  state.notifications = [];
  state.events = [];
});

test("stores result, streak reset, and penalty in one transaction", async () => {
  const result = await evaluateMember(challenge, member, evaluationDate);

  assert.equal(result.evaluated, true);
  assert.equal(state.dailyResults.length, 1);
  assert.equal(state.dailyResults[0].completed, false);
  assert.equal(state.member.currentStreak, 0);
  assert.equal(state.member.longestStreak, 9);
  assert.equal(state.member.totalPenalties, 30);
  assert.equal(state.penalties.length, 1);
  assert.equal(state.penalties[0].amount, 10);
  assert.equal(state.notifications.length, 2);
});

test("a duplicate evaluation does not duplicate penalties or streak updates", async () => {
  const results = await Promise.all([
    evaluateMember(challenge, member, evaluationDate),
    evaluateMember(challenge, member, evaluationDate),
  ]);

  assert.equal(results.filter((result) => result.evaluated).length, 1);
  assert.equal(results.filter((result) => result.duplicate).length, 1);
  assert.equal(state.dailyResults.length, 1);
  assert.equal(state.penalties.length, 1);
  assert.equal(state.member.totalPenalties, 30);
  assert.equal(state.notifications.length, 2);
});

test("rolls back the daily result and member totals if ledger persistence fails", async () => {
  state.ledgerError = true;

  await assert.rejects(
    evaluateMember(challenge, member, evaluationDate),
    /Simulated ledger write failure/
  );

  assert.equal(state.dailyResults.length, 0);
  assert.equal(state.penalties.length, 0);
  assert.equal(state.member.currentStreak, 4);
  assert.equal(state.member.totalPenalties, 20);
  assert.equal(state.notifications.length, 0);
});

test("a LeetCode fetch failure remains unevaluated for a later retry", async () => {
  state.submissionsError = new Error("LeetCode unavailable");

  const failed = await evaluateMember(challenge, member, evaluationDate);

  assert.equal(failed.retryable, true);
  assert.equal(state.dailyResults.length, 0);
  assert.equal(state.penalties.length, 0);

  state.submissionsError = null;
  const retried = await evaluateMember(challenge, member, evaluationDate);

  assert.equal(retried.evaluated, true);
  assert.equal(state.dailyResults.length, 1);
  assert.equal(state.penalties.length, 1);
});

test("session retrieval failures are retryable and never assessed as a miss", async () => {
  state.sessionError = new Error("Session database unavailable");

  const result = await evaluateMember(challenge, member, evaluationDate);

  assert.equal(result.retryable, true);
  assert.equal(state.dailyResults.length, 0);
  assert.equal(state.penalties.length, 0);
  assert.equal(state.member.totalPenalties, 20);
});

test("metadata enrichment failures are retryable and never assessed as a miss", async () => {
  state.metadataError = new Error("Metadata request failed");

  const result = await evaluateMember(challenge, member, evaluationDate);

  assert.equal(result.retryable, true);
  assert.equal(state.dailyResults.length, 0);
  assert.equal(state.penalties.length, 0);
  assert.equal(state.member.totalPenalties, 20);
});

test("unknown difficulty metadata prevents filtered-day penalties", async () => {
  state.unknownDifficulty = true;
  const filteredChallenge = { ...challenge, difficultyFilter: ["Easy"] };

  const result = await evaluateMember(
    filteredChallenge,
    member,
    evaluationDate
  );

  assert.equal(result.retryable, true);
  assert.equal(state.dailyResults.length, 0);
  assert.equal(state.penalties.length, 0);
  assert.equal(state.member.totalPenalties, 20);
});

test("a failed older date blocks later dates so catch-up can retry in order", async () => {
  state.submissionsError = new Error("LeetCode unavailable");
  const catchupChallenge = {
    ...challenge,
    startDate: new Date("2026-10-21T00:00:00.000Z"),
    members: [{ ...member, joinedAt: new Date("2026-10-21T00:00:00.000Z") }],
  };

  await evaluateChallenge(catchupChallenge, new Date("2026-10-22T00:00:00.000Z"));

  assert.equal(state.submissionFetches, 1);
  assert.equal(state.dailyResults.length, 0);

  state.submissionsError = null;
  state.submissionFetches = 0;
  await evaluateChallenge(catchupChallenge, new Date("2026-10-22T00:00:00.000Z"));

  assert.equal(state.submissionFetches, 2);
  assert.deepEqual(
    state.dailyResults.map((result) => result.date.toISOString().slice(0, 10)),
    ["2026-10-21", "2026-10-22"]
  );
});
