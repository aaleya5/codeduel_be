const test = require("node:test");
const assert = require("node:assert/strict");
const createApp = require("../src/app");
const { config, validateCorsConfig } = require("../src/config/env");

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

test("CORS echoes configured origins and credentials for browser requests", async (t) => {
  const originalOrigins = config.corsOrigins;
  config.corsOrigins = ["http://localhost:8080"];
  t.after(() => {
    config.corsOrigins = originalOrigins;
  });

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { origin: "http://localhost:8080" },
    });

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "http://localhost:8080"
    );
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  });
});

test("CORS omits allow headers for origins outside the configured list", async (t) => {
  const originalOrigins = config.corsOrigins;
  config.corsOrigins = ["http://localhost:8080"];
  t.after(() => {
    config.corsOrigins = originalOrigins;
  });

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { origin: "https://untrusted.example" },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(response.headers.get("access-control-allow-credentials"), null);
  });
});

test("production CORS requires exact explicit HTTP(S) origins", () => {
  const originalNodeEnv = config.nodeEnv;
  const originalOrigins = config.corsOrigins;
  config.nodeEnv = "production";

  try {
    config.corsOrigins = [];
    assert.throws(validateCorsConfig, /CORS_ORIGINS must contain/);

    config.corsOrigins = ["*"];
    assert.throws(validateCorsConfig, /Invalid CORS origin/);

    config.corsOrigins = ["https://app.example.com"];
    assert.doesNotThrow(validateCorsConfig);
  } finally {
    config.nodeEnv = originalNodeEnv;
    config.corsOrigins = originalOrigins;
  }
});
