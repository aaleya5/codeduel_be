const dotenv = require("dotenv");

// Load environment variables from .env file
dotenv.config();

const nodeEnv = process.env.NODE_ENV || "development";
const defaultCorsOrigins =
  nodeEnv === "production"
    ? ""
    : "http://localhost:8080,http://localhost:5173";
const configuredCorsOrigins =
  process.env.CORS_ORIGINS || process.env.CORS_ORIGIN;
const corsOrigins =
  configuredCorsOrigins === "*" && nodeEnv !== "production"
    ? defaultCorsOrigins
    : configuredCorsOrigins || defaultCorsOrigins;

const config = {
  // Server Configuration
  port: process.env.PORT || 3000,
  nodeEnv,

  // Database Configuration
  databaseUrl: process.env.DATABASE_URL,

  // JWT Configuration
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",

  // Encryption Configuration
  encryptionKey: process.env.ENCRYPTION_KEY,

  // LeetCode API Configuration
  leetcodeGraphqlUrl:
    process.env.LEETCODE_GRAPHQL_URL || "https://leetcode.com/graphql",

  // Cron Configuration
  cronEnabled: process.env.CRON_ENABLED === "true",
  dailyEvaluationTime: process.env.DAILY_EVALUATION_TIME || "0 1 * * *", // 1 AM daily
  challengeTimeZone: process.env.CHALLENGE_TIME_ZONE || "Asia/Kolkata",

  // Razorpay Configuration (penalty payments)
  razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,

  // CORS Configuration
  corsOrigins: corsOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};

const validateCorsConfig = () => {
  if (config.nodeEnv === "production" && config.corsOrigins.length === 0) {
    throw new Error(
      "CORS_ORIGINS must contain the allowed frontend origin(s) in production"
    );
  }

  for (const origin of config.corsOrigins) {
    let parsedOrigin;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new Error(`Invalid CORS origin: ${origin}`);
    }
    if (
      !["http:", "https:"].includes(parsedOrigin.protocol) ||
      parsedOrigin.origin !== origin
    ) {
      throw new Error(
        `Invalid CORS origin: ${origin}. Use an exact http(s) origin without a path.`
      );
    }
  }
};

// Validate critical environment variables
const validateConfig = () => {
  validateCorsConfig();

  const required = ["databaseUrl", "jwtSecret", "encryptionKey"];
  const missing = required.filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: config.challengeTimeZone });
  } catch {
    throw new Error(
      `Invalid CHALLENGE_TIME_ZONE: ${config.challengeTimeZone}`
    );
  }
};

// Separate, narrower check for payment routes only - Razorpay keys aren't
// required for the app to boot (payments are an optional feature), but a
// request that actually needs them should fail with a clear message rather
// than a confusing downstream Razorpay SDK error.
const validateRazorpayConfig = () => {
  if (!config.razorpayKeyId || !config.razorpayKeySecret) {
    throw new Error(
      "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to enable payments."
    );
  }
};

module.exports = {
  config,
  validateConfig,
  validateCorsConfig,
  validateRazorpayConfig,
};
