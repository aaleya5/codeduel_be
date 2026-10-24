const test = require("node:test");
const assert = require("node:assert/strict");
const createApp = require("../src/app");

const withServer = async (callback) => {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
};

test("authentication routes return a consistent 429 after the configured limit", async () => {
  await withServer(async (baseUrl) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(response.status, 400);
    }

    const limitedResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(limitedResponse.status, 429);
    assert.deepEqual(await limitedResponse.json(), {
      success: false,
      message: "Too many authentication attempts. Please try again later.",
    });
    assert.equal(limitedResponse.headers.get("ratelimit-limit"), "10");
  });
});

test("payment endpoints return 429 before handling excess requests", async () => {
  await withServer(async (baseUrl) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/payments/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(response.status, 401);
    }

    const limitedResponse = await fetch(`${baseUrl}/api/payments/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(limitedResponse.status, 429);
    assert.deepEqual(await limitedResponse.json(), {
      success: false,
      message: "Too many payment requests. Please try again later.",
    });
  });
});
