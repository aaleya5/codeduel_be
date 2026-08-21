const { PrismaClient } = require("@prisma/client");
const logger = require("../utils/logger");

// Singleton pattern for Prisma Client
let prismaInstance = null;

const getPrismaClient = () => {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      log: [
        { level: "error", emit: "event" },
        { level: "warn", emit: "event" },
      ],
    });

    // Query logging disabled for cleaner console output
    // Uncomment below for debugging:
    // if (process.env.NODE_ENV === "development") {
    //   prismaInstance.$on("query", (e) => {
    //     logger.debug("Query: " + e.query);
    //     logger.debug("Duration: " + e.duration + "ms");
    //   });
    // }

    // Log errors
    prismaInstance.$on("error", (e) => {
      logger.error("Prisma Error:", e);
    });

    // Log warnings
    prismaInstance.$on("warn", (e) => {
      logger.warn("Prisma Warning:", e);
    });
  }

  return prismaInstance;
};

// Graceful shutdown
const disconnectPrisma = async () => {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    logger.info("Prisma Client disconnected");
  }
};

module.exports = {
  prisma: getPrismaClient(),
  disconnectPrisma,
};
