const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notification.controller");
const { authenticate } = require("../middlewares/auth.middleware");

/**
 * @route   GET /api/notifications
 * @desc    Get current user's notifications (optional ?unreadOnly=true)
 * @access  Private
 */
router.get("/", authenticate, notificationController.getNotifications);

/**
 * @route   GET /api/notifications/unread-count
 * @desc    Get current user's unread notification count
 * @access  Private
 */
router.get(
  "/unread-count",
  authenticate,
  notificationController.getUnreadCount
);

/**
 * @route   PATCH /api/notifications/read-all
 * @desc    Mark all of the current user's notifications as read
 * @access  Private
 */
router.patch(
  "/read-all",
  authenticate,
  notificationController.markAllAsRead
);

/**
 * @route   PATCH /api/notifications/:id/read
 * @desc    Mark a single notification as read
 * @access  Private
 */
router.patch("/:id/read", authenticate, notificationController.markAsRead);

module.exports = router;
