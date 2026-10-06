const { prisma } = require("../config/prisma");
const logger = require("../utils/logger");

/**
 * Create a notification for a user.
 * Failures here are logged but never thrown - a notification failing to
 * write should never break the evaluation/penalty flow that triggered it.
 *
 * @param {string} userId
 * @param {string} type - e.g. "PENALTY_APPLIED", "STREAK_BROKEN"
 * @param {string} title
 * @param {string} message
 * @param {string|null} challengeId
 */
const createNotification = async (
  userId,
  type,
  title,
  message,
  challengeId = null
) => {
  try {
    return await prisma.notification.create({
      data: { userId, type, title, message, challengeId },
    });
  } catch (error) {
    logger.error(
      `Failed to create notification (${type}) for user ${userId}:`,
      error.message
    );
    return null;
  }
};

/**
 * Get a user's notifications, most recent first.
 */
const getUserNotifications = async (userId, { unreadOnly = false, limit = 50 } = {}) => {
  return await prisma.notification.findMany({
    where: {
      userId,
      ...(unreadOnly ? { isRead: false } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
};

/**
 * Count a user's unread notifications.
 */
const getUnreadCount = async (userId) => {
  return await prisma.notification.count({
    where: { userId, isRead: false },
  });
};

/**
 * Mark a single notification as read. Scoped to the owning user so one
 * user can't mark another user's notification as read.
 */
const markAsRead = async (notificationId, userId) => {
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { isRead: true },
  });

  return result.count > 0;
};

/**
 * Mark every notification for a user as read.
 */
const markAllAsRead = async (userId) => {
  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });

  return result.count;
};

module.exports = {
  createNotification,
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
};
