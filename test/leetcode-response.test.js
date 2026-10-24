const test = require("node:test");
const assert = require("node:assert/strict");

const state = { response: null, error: null };
const axios = {
  post: async () => {
    if (state.error) throw state.error;
    return { data: state.response };
  },
};

const axiosPath = require.resolve("axios");
const prismaPath = require.resolve("../src/config/prisma");
const encryptionPath = require.resolve("../src/utils/encryption");
require.cache[axiosPath] = {
  id: axiosPath,
  filename: axiosPath,
  loaded: true,
  exports: axios,
};
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: { prisma: {} },
};
require.cache[encryptionPath] = {
  id: encryptionPath,
  filename: encryptionPath,
  loaded: true,
  exports: { encrypt: (value) => value, decrypt: (value) => value },
};

const { fetchUserSubmissions } = require("../src/services/leetcode.service");

test.beforeEach(() => {
  state.response = {
    data: {
      recentAcSubmissionList: [
        {
          title: "Two Sum",
          titleSlug: "two-sum",
          timestamp: "1792860000",
          statusDisplay: "Accepted",
        },
      ],
    },
  };
  state.error = null;
});

test("accepts a well-formed accepted-submission response", async () => {
  const submissions = await fetchUserSubmissions("user", null, 100);
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].titleSlug, "two-sum");
});

test("preserves a valid empty submissions list", async () => {
  state.response.data.recentAcSubmissionList = [];

  const submissions = await fetchUserSubmissions("user", null, 100);
  assert.deepEqual(submissions, []);
});

test("rejects missing or malformed API result data instead of treating it as zero", async () => {
  state.response = { data: null };
  await assert.rejects(fetchUserSubmissions("user"), /Failed to fetch/);

  state.response = { data: { recentAcSubmissionList: null } };
  await assert.rejects(fetchUserSubmissions("user"), /Failed to fetch/);

  state.response = {
    errors: [{ message: "Rate limited" }],
    data: { recentAcSubmissionList: [] },
  };
  await assert.rejects(fetchUserSubmissions("user"), /Failed to fetch/);
});

test("rejects malformed or non-accepted entries in the accepted list", async () => {
  state.response.data.recentAcSubmissionList[0].timestamp = "not-a-timestamp";
  await assert.rejects(fetchUserSubmissions("user"), /Failed to fetch/);

  state.response.data.recentAcSubmissionList[0].timestamp = "1792860000";
  state.response.data.recentAcSubmissionList[0].statusDisplay = "Wrong Answer";
  await assert.rejects(fetchUserSubmissions("user"), /Failed to fetch/);
});

test("treats provider/network errors as failures for callers to retry", async () => {
  state.error = new Error("network unavailable");

  await assert.rejects(fetchUserSubmissions("user"), /Failed to fetch/);
});
