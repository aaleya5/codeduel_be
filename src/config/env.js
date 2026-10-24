const dotenv = require("dotenv");

// Load environment variables from .env file
dotenv.config();

const config = {
  // Server Configuration
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || "development",

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

  // Razorpay Configuration (penalty payments)
  razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,

  // CORS Configuration
  corsOrigin: process.env.CORS_ORIGIN || "*",
};

// Validate critical environment variables
const validateConfig = () => {
  const required = ["databaseUrl", "jwtSecret", "encryptionKey"];
  const missing = required.filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
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

module.exports = { config, validateConfig, validateRazorpayConfig };
