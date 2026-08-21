const cron = require("node-cron");
const { config } = require("./env");
const logger = require("../utils/logger");
const evaluationService = require("../services/evaluation.service");

class CronManager {
  constructor() {
    this.jobs = [];
  }

  /**
   * Initialize all cron jobs
   */
  initializeCronJobs() {
    if (!config.cronEnabled) {
      logger.info("Cron jobs are disabled");
      return;
    }

    // Daily evaluation job - runs every day at configured time (default: 1 AM)
    const dailyEvaluationJob = cron.schedule(
      config.dailyEvaluationTime,
      async () => {
        logger.info("Starting daily evaluation cron job");
        try {
          await evaluationService.runDailyEvaluation();
          logger.info("Daily evaluation completed successfully");
        } catch (error) {
          logger.error("Daily evaluation failed:", error);
        }
      },
      {
        scheduled: true,
        timezone: "UTC", // Use UTC or configure based on requirements
      }
    );

    this.jobs.push({
      name: "dailyEvaluation",
      job: dailyEvaluationJob,
    });

    logger.info(
      `Cron jobs initialized. Daily evaluation scheduled at: ${config.dailyEvaluationTime}`
    );
  }

  /**
   * Stop all cron jobs
   */
  stopAllJobs() {
    this.jobs.forEach(({ name, job }) => {
      job.stop();
      logger.info(`Stopped cron job: ${name}`);
    });
  }

  /**
   * Manually trigger daily evaluation (for testing purposes)
   */
  async triggerDailyEvaluation() {
    logger.info("Manually triggering daily evaluation");
    try {
      await evaluationService.runDailyEvaluation();
      logger.info("Manual daily evaluation completed");
    } catch (error) {
      logger.error("Manual daily evaluation failed:", error);
      throw error;
    }
  }
}

module.exports = new CronManager();
