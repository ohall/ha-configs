import SftpClient from 'ssh2-sftp-client';
import { join, dirname } from 'path';
import { mkdir } from 'fs/promises';

/**
 * Creates and manages SSH/SFTP connections for file operations
 */
export class SshFileClient {
  constructor(sshConfig) {
    this.sshConfig = sshConfig;
    this.sftp = new SftpClient();
    this.connected = false;
  }

  /**
   * Establishes SSH connection
   * @throws {Error} If connection fails
   */
  async connect() {
    if (this.connected) {
      return;
    }

    try {
      await this.sftp.connect(this.sshConfig);
      this.connected = true;
    } catch (error) {
      throw new Error(`SSH connection failed: ${error.message}`);
    }
  }

  /**
   * Closes SSH connection
   */
  async disconnect() {
    if (this.connected) {
      await this.sftp.end();
      this.connected = false;
    }
  }

  /**
   * Lists files in a remote directory recursively
   * @param {string} remotePath - Remote directory path
   * @param {string[]} includePatterns - File patterns to include
   * @param {string[]} excludePatterns - File patterns to exclude
   * @returns {Promise<Array<{path: string, type: string, size: number}>>} List of files
   */
  async listFiles(remotePath, includePatterns = [], excludePatterns = []) {
    const files = [];

    const shouldInclude = (filename) => {
      // If no include patterns specified, include everything
      if (includePatterns.length === 0) {
        return true;
      }
      return includePatterns.some(pattern => this._matchPattern(filename, pattern));
    };

    const shouldExclude = (filename) => {
      return excludePatterns.some(pattern => this._matchPattern(filename, pattern));
    };

    const traverse = async (path) => {
      try {
        const list = await this.sftp.list(path);

        for (const item of list) {
          const fullPath = join(path, item.name);
          const relativePath = fullPath.replace(remotePath, '').replace(/^\//, '');

          if (item.type === 'd') {
            // Recursively traverse directories
            await traverse(fullPath);
          } else if (item.type === '-') {
            // Regular file
            if (!shouldExclude(relativePath) && shouldInclude(relativePath)) {
              files.push({
                path: fullPath,
                relativePath,
                type: item.type,
                size: item.size,
              });
            }
          }
        }
      } catch (error) {
        // Skip directories we can't access
        console.warn(`Warning: Could not access ${path}: ${error.message}`);
      }
    };

    await traverse(remotePath);
    return files;
  }

  /**
   * Downloads a file from remote to local path
   * @param {string} remotePath - Remote file path
   * @param {string} localPath - Local file path
   */
  async downloadFile(remotePath, localPath) {
    try {
      // Ensure local directory exists
      await mkdir(dirname(localPath), { recursive: true });
      await this.sftp.get(remotePath, localPath);
    } catch (error) {
      throw new Error(`Failed to download ${remotePath}: ${error.message}`);
    }
  }

  /**
   * Reads a file from remote and returns content as Buffer
   * @param {string} remotePath - Remote file path
   * @returns {Promise<Buffer>} File content
   */
  async readFile(remotePath) {
    try {
      return await this.sftp.get(remotePath);
    } catch (error) {
      throw new Error(`Failed to read ${remotePath}: ${error.message}`);
    }
  }

  /**
   * Uploads a file from local to remote path
   * @param {string} localPath - Local file path
   * @param {string} remotePath - Remote file path
   */
  async uploadFile(localPath, remotePath) {
    try {
      // Ensure remote directory exists
      const remoteDir = dirname(remotePath);
      
      // Check if directory exists before trying to create it
      // This avoids "Bad path" errors when the directory already exists on some SFTP servers
      let dirExists = false;
      try {
        const type = await this.sftp.exists(remoteDir);
        // specific fix: treat any existing path (dir, link, or even file) as "exists"
        // to avoid attempting mkdir which fails if the path exists as a file/link
        if (type) {
          dirExists = true;
        }
      } catch (e) {
        // Ignore error, assume it doesn't exist if we can't check
      }

      if (!dirExists) {
        await this.sftp.mkdir(remoteDir, true);
      }

      await this.sftp.put(localPath, remotePath);
    } catch (error) {
      throw new Error(`Failed to upload ${localPath}: ${error.message}`);
    }
  }

  /**
   * Simple pattern matching for file inclusion/exclusion
   * Supports * (wildcard) and ** (recursive wildcard)
   * @param {string} filename - Filename to test
   * @param {string} pattern - Pattern to match against
   * @returns {boolean} Whether filename matches pattern
   */
  _matchPattern(filename, pattern) {
    // Escape special regex characters except * and ?
    let regexPattern = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');

    // Handle ** (recursive match)
    regexPattern = regexPattern.replace(/\*\*/g, '.__RECURSIVE_WILDCARD__');
    
    // Handle * (single level match - does not match /)
    regexPattern = regexPattern.replace(/\*/g, '[^/]*');

    // Restore **
    regexPattern = regexPattern.replace(/\.__RECURSIVE_WILDCARD__/g, '.*');

    // Handle ? (single char match)
    regexPattern = regexPattern.replace(/\?/g, '.');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filename);
  }
}
