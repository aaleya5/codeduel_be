const test = require("node:test");
const assert = require("node:assert/strict");

const paymentServicePath = require.resolve("../src/services/payment.service");
let received;
require.cache[paymentServicePath] = {
  id: paymentServicePath,
  filename: paymentServicePath,
  loaded: true,
  exports: {
    processRazorpayWebhook: async (rawBody, signature) => {
      received = { rawBody, signature };
      return { processed: true, duplicate: false };
    },
  },
};

const createApp = require("../src/app");

test("payment webhook route preserves raw body and signature header", async (t) => {
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

  const rawBody = '{"event":"payment.captured"}';
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/payments/webhook`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": "test-signature",
      },
      body: rawBody,
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    processed: true,
    duplicate: false,
  });
  assert.ok(Buffer.isBuffer(received.rawBody));
  assert.equal(received.rawBody.toString("utf8"), rawBody);
  assert.equal(received.signature, "test-signature");
});
