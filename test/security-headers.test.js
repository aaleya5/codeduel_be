const test = require("node:test");
const assert = require("node:assert/strict");
const createApp = require("../src/app");

test("API responses include Helmet security headers", async (t) => {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  );

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/health`
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.ok(response.headers.get("content-security-policy"));
  assert.ok(response.headers.get("referrer-policy"));
});
