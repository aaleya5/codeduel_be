const authService = require("../services/auth.service");
const { asyncHandler } = require("../middlewares/error.middleware");
const { body, validationResult } = require("express-validator");

/**
 * Validation middleware for registration
 */
const validateRegister = [
  body("email")
    .isEmail()
    .normalizeEmail()
    .withMessage("Valid email is required"),
  body("username")
    .isLength({ min: 3, max: 30 })
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage(
      "Username must be 3-30 characters and contain only letters, numbers, and underscores"
    ),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),
  body("leetcodeUsername")
    .optional()
    .isLength({ min: 1, max: 50 })
    .withMessage("LeetCode username must be 1-50 characters"),
];

/**
 * Validation middleware for login
 */
const validateLogin = [
  body("emailOrUsername")
    .notEmpty()
    .withMessage("Email or username is required"),
  body("password").notEmpty().withMessage("Password is required"),
];

/**
 * Register a new user
 * POST /api/auth/register
 */
const register = asyncHandler(async (req, res) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: errors.array(),
    });
  }

  const { email, username, password, leetcodeUsername } = req.body;

  const result = await authService.register({
    email,
    username,
    password,
    leetcodeUsername,
  });

  res.status(201).json({
    success: true,
    message: "User registered successfully",
    data: result,
  });
});

/**
 * Login user
 * POST /api/auth/login
 */
const login = asyncHandler(async (req, res) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: errors.array(),
    });
  }

  const { emailOrUsername, password } = req.body;

  const result = await authService.login(emailOrUsername, password);

  res.status(200).json({
    success: true,
    message: "Login successful",
    data: result,
  });
});

/**
 * Get current user profile
 * GET /api/auth/profile
 */
const getProfile = asyncHandler(async (req, res) => {
  const user = await authService.getProfile(req.user.id);

  res.status(200).json({
    success: true,
    data: user,
  });
});

/**
 * Update user profile
 * PUT /api/auth/profile
 */
const updateProfile = asyncHandler(async (req, res) => {
  const { leetcodeUsername, currentPassword, newPassword } = req.body;

  const user = await authService.updateProfile(req.user.id, {
    leetcodeUsername,
    currentPassword,
    newPassword,
  });

  res.status(200).json({
    success: true,
    message: "Profile updated successfully",
    data: user,
  });
});

module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
  validateRegister,
  validateLogin,
};
