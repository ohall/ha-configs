import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load environment variables from .env file
dotenv.config();

/**
 * Validates that required configuration values are present
 * @param {Object} config - Configuration object to validate
 * @throws {Error} If required values are missing
 */
function validateConfig(config) {
  const required = ['host', 'username', 'remoteConfigPath', 'localBackupPath', 'localCurrentPath'];
  const missing = required.filter(key => !config[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }

  // Ensure either password or private key is provided
  if (!config.password && !config.privateKey) {
    throw new Error('Either HA_SSH_PASSWORD or HA_SSH_PRIVATE_KEY_PATH must be provided');
  }
}

/**
 * Loads SSH private key from file if path is provided
 * @param {string|undefined} keyPath - Path to private key file
 * @returns {Buffer|undefined} Private key contents or undefined
 */
function loadPrivateKey(keyPath) {
  if (!keyPath) {
    return undefined;
  }

  try {
    const resolvedPath = resolve(keyPath);
    return readFileSync(resolvedPath);
  } catch (error) {
    throw new Error(`Failed to read private key from ${keyPath}: ${error.message}`);
  }
}

/**
 * Parses comma-separated patterns into an array
 * @param {string|undefined} patterns - Comma-separated pattern string
 * @returns {string[]} Array of patterns
 */
function parsePatterns(patterns) {
  if (!patterns) {
    return [];
  }
  return patterns.split(',').map(p => p.trim()).filter(Boolean);
}

/**
 * Loads and validates configuration from environment variables
 * @returns {Object} Configuration object
 */
export function loadConfig() {
  const config = {
    host: process.env.HA_SSH_HOST,
    port: parseInt(process.env.HA_SSH_PORT || '22', 10),
    username: process.env.HA_SSH_USERNAME,
    password: process.env.HA_SSH_PASSWORD,
    privateKey: loadPrivateKey(process.env.HA_SSH_PRIVATE_KEY_PATH),
    remoteConfigPath: process.env.HA_REMOTE_CONFIG_PATH,
    localBackupPath: process.env.HA_LOCAL_BACKUP_PATH || './backups',
    localCurrentPath: process.env.HA_LOCAL_CURRENT_PATH || './current',
    includePatterns: parsePatterns(process.env.HA_INCLUDE_PATTERNS),
    excludePatterns: parsePatterns(process.env.HA_EXCLUDE_PATTERNS),
  };

  validateConfig(config);

  return config;
}

/**
 * Creates SSH connection configuration object
 * @param {Object} config - Application configuration
 * @returns {Object} SSH connection configuration
 */
export function getSshConfig(config) {
  const sshConfig = {
    host: config.host,
    port: config.port,
    username: config.username,
  };

  if (config.privateKey) {
    sshConfig.privateKey = config.privateKey;
  } else {
    sshConfig.password = config.password;
  }

  return sshConfig;
}
