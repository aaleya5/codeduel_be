const bcrypt = require("bcryptjs");
const { prisma } = require("../config/prisma");
const { generateToken } = require("../utils/jwt");
const { AppError } = require("../middlewares/error.middleware");
const logger = require("../utils/logger");

/**
 * Register a new user
 * @param {Object} userData - User registration data
 * @returns {Object} User object and JWT token
 */
const register = async (userData) => {
  const { email, username, password, leetcodeUsername } = userData;

  // Check if user already exists
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ email }, { username }],
    },
  });

  if (existingUser) {
    if (existingUser.email === email) {
      throw new AppError("Email already registered", 400);
    }
    if (existingUser.username === username) {
      throw new AppError("Username already taken", 400);
    }
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 12);

  // Create user
  const user = await prisma.user.create({
    data: {
      email,
      username,
      password: hashedPassword,
      leetcodeUsername: leetcodeUsername || null,
    },
    select: {
      id: true,
      email: true,
      username: true,
      leetcodeUsername: true,
      createdAt: true,
    },
  });

  // Generate JWT token
  const token = generateToken({ userId: user.id });

  logger.info(`New user registered: ${user.username} (${user.email})`);

  return {
    user,
    token,
  };
};

/**
 * Login user
 * @param {string} emailOrUsername - Email or username
 * @param {string} password - User password
 * @returns {Object} User object and JWT token
 */
const login = async (emailOrUsername, password) => {
  // Find user by email or username
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: emailOrUsername }, { username: emailOrUsername }],
    },
  });

  if (!user) {
    throw new AppError("Invalid credentials", 401);
  }

  // Verify password
  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    throw new AppError("Invalid credentials", 401);
  }

  // Generate JWT token
  const token = generateToken({ userId: user.id });

  logger.info(`User logged in: ${user.username}`);

  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      leetcodeUsername: user.leetcodeUsername,
      createdAt: user.createdAt,
    },
    token,
  };
};

/**
 * Get user profile
 * @param {string} userId - User ID
 * @returns {Object} User profile
 */
const getProfile = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      leetcodeUsername: true,
      createdAt: true,
      _count: {
        select: {
          ownedChallenges: true,
          memberships: true,
        },
      },
    },
  });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  return user;
};

/**
 * Update user profile
 * @param {string} userId - User ID
 * @param {Object} updateData - Data to update
 * @returns {Object} Updated user profile
 */
const updateProfile = async (userId, updateData) => {
  const { leetcodeUsername, currentPassword, newPassword } = updateData;

  // If changing password, verify current password
  if (newPassword) {
    if (!currentPassword) {
      throw new AppError("Current password is required", 400);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password
    );

    if (!isPasswordValid) {
      throw new AppError("Current password is incorrect", 401);
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        leetcodeUsername:
          leetcodeUsername !== undefined ? leetcodeUsername : undefined,
      },
      select: {
        id: true,
        email: true,
        username: true,
        leetcodeUsername: true,
        updatedAt: true,
      },
    });

    logger.info(`User profile updated: ${updatedUser.username}`);

    return updatedUser;
  }

  // Update without password change
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      leetcodeUsername:
        leetcodeUsername !== undefined ? leetcodeUsername : undefined,
    },
    select: {
      id: true,
      email: true,
      username: true,
      leetcodeUsername: true,
      updatedAt: true,
    },
  });

  logger.info(`User profile updated: ${updatedUser.username}`);

  return updatedUser;
};

module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
};
