const crypto = require("crypto");
const { config } = require("../config/env");

// Algorithm and key derivation settings
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // For GCM mode
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

/**
 * Derive encryption key from master key
 * @param {string} salt - Salt for key derivation
 * @returns {Buffer} Derived key
 */
const deriveKey = (salt) => {
  return crypto.pbkdf2Sync(
    config.encryptionKey,
    salt,
    ITERATIONS,
    KEY_LENGTH,
    "sha512"
  );
};

/**
 * Encrypt data using AES-256-GCM
 * @param {string} text - Plain text to encrypt
 * @returns {string} Encrypted data in format: salt:iv:authTag:encryptedData
 */
const encrypt = (text) => {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(salt);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // Return format: salt:iv:authTag:encryptedData
  return [
    salt.toString("hex"),
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted,
  ].join(":");
};

/**
 * Decrypt data using AES-256-GCM
 * @param {string} encryptedData - Encrypted data in format: salt:iv:authTag:encryptedData
 * @returns {string} Decrypted plain text
 */
const decrypt = (encryptedData) => {
  const parts = encryptedData.split(":");

  if (parts.length !== 4) {
    throw new Error("Invalid encrypted data format");
  }

  const salt = Buffer.from(parts[0], "hex");
  const iv = Buffer.from(parts[1], "hex");
  const authTag = Buffer.from(parts[2], "hex");
  const encrypted = parts[3];

  const key = deriveKey(salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
};

/**
 * Hash data using SHA-256
 * @param {string} data - Data to hash
 * @returns {string} Hex-encoded hash
 */
const hash = (data) => {
  return crypto.createHash("sha256").update(data).digest("hex");
};

/**
 * Generate random token
 * @param {number} length - Length of token in bytes (default: 32)
 * @returns {string} Hex-encoded random token
 */
const generateRandomToken = (length = 32) => {
  return crypto.randomBytes(length).toString("hex");
};

module.exports = {
  encrypt,
  decrypt,
  hash,
  generateRandomToken,
};
