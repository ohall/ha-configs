import { mkdir, readdir, copyFile, stat, rm } from 'fs/promises';
import { join, dirname, relative } from 'path';
import { existsSync } from 'fs';

/**
 * Manages local backup storage with versioning
 */
export class BackupManager {
  constructor(backupPath, currentPath) {
    this.backupPath = backupPath;
    this.currentPath = currentPath;
  }

  /**
   * Ensures backup directories exist
   */
  async initialize() {
    await mkdir(this.backupPath, { recursive: true });
    await mkdir(this.currentPath, { recursive: true });
  }

  /**
   * Creates a timestamped backup of the current state
   * @returns {Promise<string>} Path to the created backup
   */
  async createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = join(this.backupPath, timestamp);

    if (!existsSync(this.currentPath)) {
      throw new Error('No current configuration to backup');
    }

    await this._copyDirectory(this.currentPath, backupDir);
    console.log(`Backup created: ${backupDir}`);
    return backupDir;
  }

  /**
   * Lists all available backups, sorted by date (newest first)
   * @returns {Promise<Array<{name: string, path: string, date: Date}>>}
   */
  async listBackups() {
    try {
      const entries = await readdir(this.backupPath);
      const backups = [];

      for (const entry of entries) {
        const backupPath = join(this.backupPath, entry);
        const stats = await stat(backupPath);

        if (stats.isDirectory()) {
          backups.push({
            name: entry,
            path: backupPath,
            date: stats.mtime,
          });
        }
      }

      // Sort by date, newest first
      return backups.sort((a, b) => b.date - a.date);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Restores a backup to the current directory
   * @param {string} backupName - Name of the backup to restore (or 'latest')
   * @returns {Promise<string>} Path of the restored backup
   */
  async restoreBackup(backupName = 'latest') {
    const backups = await this.listBackups();

    if (backups.length === 0) {
      throw new Error('No backups available to restore');
    }

    let backupToRestore;
    if (backupName === 'latest') {
      backupToRestore = backups[0];
    } else {
      backupToRestore = backups.find(b => b.name === backupName);
      if (!backupToRestore) {
        throw new Error(`Backup not found: ${backupName}`);
      }
    }

    // Clear current directory before restoring
    if (existsSync(this.currentPath)) {
      await rm(this.currentPath, { recursive: true, force: true });
    }

    await this._copyDirectory(backupToRestore.path, this.currentPath);
    console.log(`Restored backup: ${backupToRestore.name}`);
    return backupToRestore.path;
  }

  /**
   * Saves a file to the current directory
   * @param {string} relativePath - Relative path of the file
   * @param {string} sourcePath - Source file path
   */
  async saveFile(relativePath, sourcePath) {
    const destPath = join(this.currentPath, relativePath);
    await mkdir(dirname(destPath), { recursive: true });
    await copyFile(sourcePath, destPath);
  }

  /**
   * Gets the full path for a file in the current directory
   * @param {string} relativePath - Relative path of the file
   * @returns {string} Full local path
   */
  getCurrentFilePath(relativePath) {
    return join(this.currentPath, relativePath);
  }

  /**
   * Recursively copies a directory
   * @param {string} src - Source directory
   * @param {string} dest - Destination directory
   */
  async _copyDirectory(src, dest) {
    await mkdir(dest, { recursive: true });
    const entries = await readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);

      if (entry.isDirectory()) {
        await this._copyDirectory(srcPath, destPath);
      } else {
        await copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * Lists files in a local directory recursively
   * @param {string} dir - Directory to list
   * @param {string} baseDir - Base directory for relative paths (defaults to dir)
   * @returns {Promise<Array<{path: string, relativePath: string}>>}
   */
  async listFiles(dir = this.currentPath, baseDir = this.currentPath) {
    const files = [];
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = relative(baseDir, fullPath);

      if (entry.isDirectory()) {
        const subFiles = await this.listFiles(fullPath, baseDir);
        files.push(...subFiles);
      } else {
        files.push({
          path: fullPath,
          relativePath: relativePath
        });
      }
    }
    return files;
  }

  /**
   * Cleans old backups, keeping only the specified number
   * @param {number} keepCount - Number of backups to keep
   * @returns {Promise<number>} Number of backups deleted
   */
  async cleanOldBackups(keepCount = 10) {
    const backups = await this.listBackups();

    if (backups.length <= keepCount) {
      return 0;
    }

    const toDelete = backups.slice(keepCount);
    let deleted = 0;

    for (const backup of toDelete) {
      try {
        await rm(backup.path, { recursive: true, force: true });
        deleted++;
        console.log(`Deleted old backup: ${backup.name}`);
      } catch (error) {
        console.warn(`Failed to delete backup ${backup.name}: ${error.message}`);
      }
    }

    return deleted;
  }
}
