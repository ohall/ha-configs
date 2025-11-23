#!/usr/bin/env node

import { loadConfig, getSshConfig } from './lib/config.js';
import { SshFileClient } from './lib/ssh-client.js';
import { BackupManager } from './lib/backup-manager.js';
import { createInterface } from 'readline';
import { mkdir, rm, cp } from 'fs/promises';
import { join, dirname } from 'path';
import { spawn } from 'child_process';

/**
 * Downloads Home Assistant configuration from remote server
 * @param {Object} config - Application configuration
 */
async function downloadConfig(config) {
  const sshClient = new SshFileClient(getSshConfig(config));
  const backupManager = new BackupManager(config.localBackupPath, config.localCurrentPath);
  
  // Create a temporary directory for download to ensure atomicity
  // We use a temp dir inside localBackupPath to try to stay on same volume
  const tempDownloadPath = join(config.localBackupPath, '.download_tmp_' + Date.now());

  try {
    console.log(`Connecting to ${config.host}...`);
    await sshClient.connect();
    await backupManager.initialize();
    await mkdir(tempDownloadPath, { recursive: true });

    console.log(`Listing files from ${config.remoteConfigPath}...`);
    const files = await sshClient.listFiles(
      config.remoteConfigPath,
      config.includePatterns,
      config.excludePatterns
    );

    console.log(`Found ${files.length} files to download`);

    let downloaded = 0;
    let failed = 0;

    for (const file of files) {
      try {
        // Download to temp path first
        const localTempPath = join(tempDownloadPath, file.relativePath);
        await sshClient.downloadFile(file.path, localTempPath);
        downloaded++;

        if (downloaded % 10 === 0) {
          console.log(`Downloaded ${downloaded}/${files.length} files...`);
        }
      } catch (error) {
        console.error(`Failed to download ${file.relativePath}: ${error.message}`);
        failed++;
      }
    }

    if (failed > 0) {
        console.warn(`\nWarning: ${failed} files failed to download.`);
        throw new Error(`${failed} files failed to download. Aborting sync to prevent inconsistent state.`);
    }

    console.log(`\nDownload complete. Updating local configuration...`);
    
    // Move files from temp to current path
    const tempFiles = await backupManager.listFiles(tempDownloadPath, tempDownloadPath);
    
    for (const file of tempFiles) {
        const destPath = backupManager.getCurrentFilePath(file.relativePath);
        await mkdir(dirname(destPath), { recursive: true });
        await cp(file.path, destPath, { force: true });
    }
    
    console.log(`Successfully updated ${downloaded} files.`);

  } catch (error) {
    console.error(`Download failed: ${error.message}`);
    throw error;
  } finally {
    await sshClient.disconnect();
    // Cleanup temp dir
    try {
        await rm(tempDownloadPath, { recursive: true, force: true });
    } catch (e) {
        console.warn(`Failed to clean up temp directory: ${e.message}`);
    }
  }
}

/**
 * Prompts for user confirmation
 * @param {string} question - Question to ask
 * @returns {Promise<boolean>}
 */
async function confirm(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(`${question} (y/N) `, answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

/**
 * Uploads local configuration to remote server
 * @param {Object} config - Application configuration
 * @param {string} sourcePath - Local source path (current or backup)
 */
async function uploadConfig(config, sourcePath) {
  const sshClient = new SshFileClient(getSshConfig(config));
  const backupManager = new BackupManager(config.localBackupPath, config.localCurrentPath);

  try {
    console.log(`Connecting to ${config.host}...`);
    await sshClient.connect();

    console.log(`Listing files from ${sourcePath}...`);
    const files = await backupManager.listFiles(sourcePath);
    
    // Filter files based on patterns
    const sshClientForMatching = new SshFileClient({}); // Temp instance for pattern matching
    const filesToUpload = files.filter(file => {
       const shouldExclude = config.excludePatterns.some(p => sshClientForMatching._matchPattern(file.relativePath, p));
       const shouldInclude = config.includePatterns.length === 0 || config.includePatterns.some(p => sshClientForMatching._matchPattern(file.relativePath, p));
       return !shouldExclude && shouldInclude;
    });

    console.log(`Found ${filesToUpload.length} files to upload`);

    if (filesToUpload.length === 0) {
        console.log('Nothing to upload.');
        return;
    }

    const confirmed = await confirm(`Are you sure you want to upload ${filesToUpload.length} files to ${config.host}? This will overwrite remote files.`);
    if (!confirmed) {
        console.log('Upload cancelled.');
        return;
    }

    let uploaded = 0;
    let failed = 0;

    for (const file of filesToUpload) {
      try {
        const remotePath = `${config.remoteConfigPath}/${file.relativePath}`;
        // Ensure remote path uses forward slashes
        const normalizedRemotePath = remotePath.replace(/\\/g, '/');
        
        await sshClient.uploadFile(file.path, normalizedRemotePath);
        uploaded++;

        if (uploaded % 10 === 0) {
          console.log(`Uploaded ${uploaded}/${filesToUpload.length} files...`);
        }
      } catch (error) {
        console.error(`Failed to upload ${file.relativePath}: ${error.message}`);
        failed++;
      }
    }

    console.log(`\nUpload complete: ${uploaded} succeeded, ${failed} failed`);

  } catch (error) {
    console.error(`Upload failed: ${error.message}`);
    throw error;
  } finally {
    await sshClient.disconnect();
  }
}

/**
 * Command: backup
 * Downloads current config and creates a timestamped backup
 */
async function cmdBackup(config) {
  console.log('Starting backup...\n');

  const backupManager = new BackupManager(config.localBackupPath, config.localCurrentPath);
  
  // 1. Backup local state FIRST to prevent data loss if download overwrites something valuable
  // Check if there is anything to backup first
  try {
      const files = await backupManager.listFiles();
      if (files.length > 0) {
          console.log('Backing up current local state before download...');
          const preDownloadBackup = await backupManager.createBackup();
          console.log(`Local state backed up to: ${preDownloadBackup}\n`);
      }
  } catch (e) {
      // If directory doesn't exist or is empty, just continue
  }

  // 2. Download from remote
  await downloadConfig(config);

  // 3. Create backup of the newly downloaded state
  const backupPath = await backupManager.createBackup();

  // Clean old backups (keep last 10)
  const deleted = await backupManager.cleanOldBackups(10);
  if (deleted > 0) {
    console.log(`Cleaned up ${deleted} old backup(s)`);
  }

  console.log('\nBackup completed successfully!');
  console.log(`Backup location: ${backupPath}`);
}

/**
 * Command: diff
 * Shows changes between the latest backup and current configuration
 */
async function cmdDiff(config) {
  const backupManager = new BackupManager(config.localBackupPath, config.localCurrentPath);
  const backups = await backupManager.listBackups();

  if (backups.length === 0) {
    console.error('No backups available to compare against.');
    return;
  }

  const latestBackup = backups[0];
  console.log(`Comparing current config with latest backup: ${latestBackup.name}\n`);
  
  // Check if diff is available
  const diffCmd = spawn('diff', ['-r', latestBackup.path, config.localCurrentPath], {
    stdio: 'inherit'
  });

  return new Promise((resolve, reject) => {
    diffCmd.on('close', (code) => {
      // diff returns 0 for no differences, 1 for differences, >1 for errors
      if (code === 0) {
        console.log('\nNo differences found.');
      } else if (code === 1) {
         // Differences found, output already handled by stdio: inherit
         // We don't consider this an error
      } else {
        console.error(`diff command failed with code ${code}`);
      }
      resolve();
    });

    diffCmd.on('error', (err) => {
      console.error('Failed to run diff command. Is it installed?');
      console.error(err.message);
      resolve(); // Don't crash the script
    });
  });
}

/**
 * Command: restore
 * Restores a backup (uploads to remote server)
 */
async function cmdRestore(config, backupName = 'latest') {
  console.log(`Restoring backup: ${backupName}\n`);

  const backupManager = new BackupManager(config.localBackupPath, config.localCurrentPath);
  const backups = await backupManager.listBackups();

  if (backups.length === 0) {
    console.error('No backups available to restore');
    process.exit(1);
  }

  let targetBackup;
  if (backupName === 'latest') {
    targetBackup = backups[0];
  } else {
    targetBackup = backups.find(b => b.name === backupName);
  }

  if (!targetBackup) {
    console.error(`Backup '${backupName}' not found.`);
    console.log('Available backups:');
    backups.forEach(b => console.log(`  ${b.name}`));
    process.exit(1);
  }

  console.log(`Selected backup: ${targetBackup.name} (${targetBackup.date.toLocaleString()})`);
  console.log(`Path: ${targetBackup.path}`);

  console.warn('\nWARNING: This will overwrite configuration on the REMOTE server.');
  
  const confirmed = await confirm('Do you want to proceed with the restore?');
  if (!confirmed) {
      console.log('Restore cancelled.');
      return;
  }

  // Restore logic:
  // 1. Upload the backup files to the remote server
  // Note: We are NOT restoring to localCurrentPath first, we upload directly from backup to avoid messing up local state
  // unless user wants to sync afterwards.
  
  await uploadConfig(config, targetBackup.path);
  
  console.log('\nRestore process completed.');
  console.log('Note: You may need to restart Home Assistant for changes to take effect.');
}

/**
 * Command: push
 * Uploads current local configuration to remote server
 */
async function cmdPush(config) {
  console.log('Pushing current configuration...\n');
  await uploadConfig(config, config.localCurrentPath);
  console.log('Note: You may need to restart Home Assistant for changes to take effect.');
}

/**
 * Command: sync
 * Downloads current config without creating a backup
 */
async function cmdSync(config) {
  console.log('Syncing configuration...\n');
  await downloadConfig(config);
  console.log('\nSync completed successfully!');
}

/**
 * Command: list
 * Lists all available backups
 */
async function cmdList(config) {
  const backupManager = new BackupManager(config.localBackupPath, config.localCurrentPath);
  const backups = await backupManager.listBackups();

  if (backups.length === 0) {
    console.log('No backups found');
    return;
  }

  console.log(`Found ${backups.length} backup(s):\n`);
  backups.forEach((backup, index) => {
    const marker = index === 0 ? ' (latest)' : '';
    const size = 'unknown'; // Could calculate if needed
    console.log(`  ${backup.name}`);
    console.log(`    Date: ${backup.date.toLocaleString()}${marker}`);
    console.log(`    Path: ${backup.path}\n`);
  });
}

/**
 * Command: entities
 * Lists all entities from remote registry
 */
async function cmdEntities(config) {
  const sshClient = new SshFileClient(getSshConfig(config));
  
  try {
    console.log(`Connecting to ${config.host}...`);
    await sshClient.connect();

    // Try to find the entity registry
    // It's usually in .storage/core.entity_registry
    const registryPath = `${config.remoteConfigPath}/.storage/core.entity_registry`;
    // Ensure path uses forward slashes
    const normalizedPath = registryPath.replace(/\\/g, '/');
    
    console.log(`Reading entity registry from ${normalizedPath}...`);
    
    const content = await sshClient.readFile(normalizedPath);
    const registry = JSON.parse(content.toString());
    
    if (!registry.data || !registry.data.entities) {
      console.error('Invalid registry format: missing data.entities');
      return;
    }

    const entities = registry.data.entities;
    console.log(`Found ${entities.length} entities:\n`);
    
    // Sort by entity_id
    entities.sort((a, b) => a.entity_id.localeCompare(b.entity_id));
    
    entities.forEach(e => {
      console.log(`${e.entity_id}`);
      const name = e.name || e.original_name || '<no name>';
      console.log(`  Name: ${name}`);
      console.log(`  Platform: ${e.platform}`);
      if (e.area_id) console.log(`  Area: ${e.area_id}`);
      if (e.disabled_by) console.log(`  Disabled by: ${e.disabled_by}`);
      console.log('');
    });

  } catch (error) {
    console.error(`Failed to list entities: ${error.message}`);
    if (error.message.includes('no such file')) {
        console.error('Could not find .storage/core.entity_registry. Is the path correct?');
    }
    throw error;
  } finally {
    await sshClient.disconnect();
  }
}

/**
 * Displays usage information
 */
function showUsage() {
  console.log(`
Home Assistant Configuration Manager

Usage:
  node ha-sync.js <command> [options]

Commands:
  backup              Download config from HA and create timestamped backup
  push                Upload current local config to HA (overwrites remote)
  sync                Download config from HA (no backup created)
  diff                Show changes between latest backup and current config
  restore [name]      Restore a backup (defaults to latest)
  list                List all available backups
  entities            List all entities from remote registry
  help                Show this help message

Examples:
  node ha-sync.js backup
  node ha-sync.js push
  node ha-sync.js sync
  node ha-sync.js diff
  node ha-sync.js list
  node ha-sync.js entities
  node ha-sync.js restore latest
  node ha-sync.js restore 2025-11-22T10-30-00-000Z

Configuration:
  Copy .env.example to .env and configure your settings.
  Required: HA_SSH_HOST, HA_SSH_USERNAME, HA_SSH_PASSWORD (or key)
  `);
}

/**
 * Main entry point
 */
async function main() {
  const command = process.argv[2];
  const arg = process.argv[3];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    showUsage();
    process.exit(0);
  }

  try {
    const config = loadConfig();

    switch (command) {
      case 'backup':
        await cmdBackup(config);
        break;

      case 'push':
        await cmdPush(config);
        break;

      case 'sync':
        await cmdSync(config);
        break;

      case 'diff':
        await cmdDiff(config);
        break;

      case 'restore':
        await cmdRestore(config, arg);
        break;

      case 'list':
        await cmdList(config);
        break;

      case 'entities':
        await cmdEntities(config);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        showUsage();
        process.exit(1);
    }
  } catch (error) {
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
}
