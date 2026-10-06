const notificationService = require("../services/notification.service");
const { asyncHandler } = require("../middlewares/error.middleware");

/**
 * Get current user's notifications
 * GET /api/notifications?unreadOnly=true
 */
const getNotifications = asyncHandler(async (req, res) => {
  const unreadOnly = req.query.unreadOnly === "true";

  const notifications = await notificationService.getUserNotifications(
    req.user.id,
    { unreadOnly }
  );

  res.status(200).json({
    success: true,
    data: notifications,
  });
});

/**
 * Get current user's unread notification count
 * GET /api/notifications/unread-count
 */
const getUnreadCount = asyncHandler(async (req, res) => {
  const count = await notificationService.getUnreadCount(req.user.id);

  res.status(200).json({
    success: true,
    data: { count },
  });
});

/**
 * Mark a single notification as read
 * PATCH /api/notifications/:id/read
 */
const markAsRead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updated = await notificationService.markAsRead(id, req.user.id);

  if (!updated) {
    return res.status(404).json({
      success: false,
      message: "Notification not found",
    });
  }

  res.status(200).json({
    success: true,
    message: "Notification marked as read",
  });
});

/**
 * Mark all of the current user's notifications as read
 * PATCH /api/notifications/read-all
 */
const markAllAsRead = asyncHandler(async (req, res) => {
  const count = await notificationService.markAllAsRead(req.user.id);

  res.status(200).json({
    success: true,
    message: `${count} notification(s) marked as read`,
  });
});

module.exports = {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
};
