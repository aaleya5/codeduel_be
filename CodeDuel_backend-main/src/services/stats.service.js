const { prisma } = require("../config/prisma");
const logger = require("../utils/logger");

/**
 * Calculate user's current and longest streak
 */
const calculateUserStreak = async (userId) => {
  try {
    // Get all daily results for user, ordered by date DESC
    const results = await prisma.dailyResult.findMany({
      where: {
        member: {
          userId: userId,
        },
      },
      orderBy: {
        date: "desc",
      },
      select: {
        date: true,
        completed: true,
      },
    });

    if (results.length === 0) {
      return { currentStreak: 0, longestStreak: 0 };
    }

    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;

    // Calculate current streak (from most recent day backwards)
    let currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    for (const result of results) {
      const resultDate = new Date(result.date);
      resultDate.setHours(0, 0, 0, 0);

      // Check if this is consecutive
      const daysDiff = Math.floor(
        (currentDate - resultDate) / (1000 * 60 * 60 * 24)
      );

      if (daysDiff === 0 && result.completed) {
        currentStreak++;
        tempStreak++;
      } else if (daysDiff === 1 && currentStreak > 0 && result.completed) {
        currentStreak++;
        tempStreak++;
        currentDate = resultDate;
      } else {
        break;
      }

      currentDate = resultDate;
    }

    // Calculate longest streak
    tempStreak = 0;
    let prevDate = null;

    for (const result of results.sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    )) {
      const resultDate = new Date(result.date);
      resultDate.setHours(0, 0, 0, 0);

      if (result.completed) {
        if (
          !prevDate ||
          Math.floor((resultDate - prevDate) / (1000 * 60 * 60 * 24)) === 1
        ) {
          tempStreak++;
          longestStreak = Math.max(longestStreak, tempStreak);
        } else {
          tempStreak = 1;
        }
      } else {
        tempStreak = 0;
      }

      prevDate = resultDate;
    }

    return { currentStreak, longestStreak };
  } catch (error) {
    logger.error("Error calculating streak:", error);
    return { currentStreak: 0, longestStreak: 0 };
  }
};

/**
 * Get user's activity heatmap data (contribution graph)
 * Returns activity for the last 365 days
 */
const getUserActivityHeatmap = async (userId) => {
  try {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    // Get all daily results for the user in the last year
    const results = await prisma.dailyResult.findMany({
      where: {
        member: {
          userId: userId,
        },
        date: {
          gte: oneYearAgo,
        },
      },
      orderBy: {
        date: "asc",
      },
      select: {
        date: true,
        submissionsCount: true,
        completed: true,
      },
    });

    // Group by date and sum submissions
    const activityMap = {};

    results.forEach((result) => {
      const dateKey = result.date.toISOString().split("T")[0];
      if (!activityMap[dateKey]) {
        activityMap[dateKey] = 0;
      }
      activityMap[dateKey] += result.submissionsCount || 0;
    });

    // Convert to array format for frontend
    const activityData = Object.entries(activityMap).map(([date, count]) => ({
      date,
      count,
    }));

    return activityData;
  } catch (error) {
    logger.error("Error fetching activity heatmap:", error);
    return [];
  }
};

/**
 * Get user's submission chart data (last 30 days)
 */
const getUserSubmissionChart = async (userId) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get all daily results for the last 30 days
    const results = await prisma.dailyResult.findMany({
      where: {
        member: {
          userId: userId,
        },
        date: {
          gte: thirtyDaysAgo,
        },
      },
      orderBy: {
        date: "asc",
      },
      select: {
        date: true,
        submissionsCount: true,
        completed: true,
        member: {
          select: {
            challenge: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    // Group by date
    const chartMap = {};

    results.forEach((result) => {
      const dateKey = result.date.toISOString().split("T")[0];
      if (!chartMap[dateKey]) {
        chartMap[dateKey] = {
          date: dateKey,
          submissions: 0,
          passed: 0,
          failed: 0,
        };
      }
      chartMap[dateKey].submissions += result.submissionsCount || 0;
      if (result.completed) {
        chartMap[dateKey].passed++;
      } else {
        chartMap[dateKey].failed++;
      }
    });

    // Convert to array and fill missing dates
    const chartData = [];
    const currentDate = new Date(thirtyDaysAgo);
    const today = new Date();

    while (currentDate <= today) {
      const dateKey = currentDate.toISOString().split("T")[0];
      chartData.push(
        chartMap[dateKey] || {
          date: dateKey,
          submissions: 0,
          passed: 0,
          failed: 0,
        }
      );
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return chartData;
  } catch (error) {
    logger.error("Error fetching submission chart:", error);
    return [];
  }
};

/**
 * Get comprehensive user stats
 */
const getUserStats = async (userId) => {
  try {
    const [streaks, totalResults, totalPenalties, totalSubmissions] =
      await Promise.all([
        calculateUserStreak(userId),
        prisma.dailyResult.count({
          where: {
            member: {
              userId: userId,
            },
          },
        }),
        prisma.penaltyLedger.aggregate({
          where: {
            member: {
              userId: userId,
            },
          },
          _sum: {
            amount: true,
          },
        }),
        prisma.dailyResult.aggregate({
          where: {
            member: {
              userId: userId,
            },
          },
          _sum: {
            submissionsCount: true,
          },
        }),
      ]);

    return {
      currentStreak: streaks.currentStreak,
      longestStreak: streaks.longestStreak,
      totalDays: totalResults,
      totalPenalties: totalPenalties._sum.amount || 0,
      totalSubmissions: totalSubmissions._sum.submissionsCount || 0,
    };
  } catch (error) {
    logger.error("Error fetching user stats:", error);
    throw error;
  }
};

module.exports = {
  calculateUserStreak,
  getUserActivityHeatmap,
  getUserSubmissionChart,
  getUserStats,
};
