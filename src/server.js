const createApp = require("./app");
const { config, validateConfig } = require("./config/env");
const { disconnectPrisma } = require("./config/prisma");
const cronManager = require("./config/cron");
const logger = require("./utils/logger");

/**
 * Start the server
 */
const startServer = async () => {
  try {
    // Validate environment configuration
    validateConfig();
    logger.info("Environment configuration validated");

    // Create Express app
    const app = createApp();

    // Start server
    const server = app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port} (${config.nodeEnv})`);
    });

    // Initialize cron jobs
    cronManager.initializeCronJobs();

    // Graceful shutdown handlers
    const gracefulShutdown = async (signal) => {
      logger.info(`${signal} signal received: closing HTTP server`);

      // Stop cron jobs
      cronManager.stopAllJobs();

      // Close server
      server.close(async () => {
        logger.info("HTTP server closed");

        // Disconnect from database
        await disconnectPrisma();

        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error("Forcing shutdown after timeout");
        process.exit(1);
      }, 10000);
    };

    // Handle shutdown signals
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));

    // Handle uncaught exceptions
    process.on("uncaughtException", (error) => {
      logger.error("Uncaught Exception:", error);
      gracefulShutdown("UNCAUGHT_EXCEPTION");
    });

    // Handle unhandled promise rejections
    process.on("unhandledRejection", (reason, promise) => {
      logger.error("Unhandled Rejection at:", promise, "reason:", reason);
      gracefulShutdown("UNHANDLED_REJECTION");
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
};

// Start the server
startServer();
