# Home Assistant Configuration Manager

A secure, modular tool for backing up and restoring Home Assistant configuration files via SSH.

## Basic Operations

Here are the most common commands you'll need:

| Action | Command | Description |
|--------|---------|-------------|
| **Sync** | `npm run sync` | Download config, fetch entities, and create a timestamped backup |
| **Backup** | `npm run backup` | Alias for `sync` |
| **Push** | `npm run push` | Upload your local `current/` config to HA (overwrites remote) |
| **Diff** | `npm run diff` | Show changes between the latest backup and current config |
| **Restore** | `npm run restore` | Restore from the latest backup |

## Features

- **Automated Backups**: Download HA config files and create timestamped backups
- **Entity Syncing**: Automatically fetches and saves the list of entities to `entities.txt`
- **Push Capability**: Easily upload your local changes to the server
- **Restore Capability**: Restore from any previous backup
- **Pattern Matching**: Include/exclude files based on patterns
- **Secure**: Credentials stored in environment variables, supports SSH keys
- **Modular Architecture**: Clean separation of concerns for maintainability

## Installation

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure your environment:
   ```bash
   cp .env.example .env
   # Edit .env with your Home Assistant SSH credentials
   ```

## Configuration

Edit `.env` with your settings:

```bash
# SSH Connection (required)
HA_SSH_HOST=192.168.1.100
HA_SSH_PORT=22
HA_SSH_USERNAME=root
HA_SSH_PASSWORD=your-password

# Or use SSH key authentication (recommended)
# HA_SSH_PRIVATE_KEY_PATH=/path/to/private/key

# Paths (required)
HA_REMOTE_CONFIG_PATH=/config
HA_LOCAL_BACKUP_PATH=./backups
HA_LOCAL_CURRENT_PATH=./current

# File patterns (optional)
HA_INCLUDE_PATTERNS=*.yaml,*.yml,.storage/*.json,automations/*,scripts/*
HA_EXCLUDE_PATTERNS=*.log,*.db,*.db-shm,*.db-wal
```

### SSH Key Authentication (Recommended)

For better security, use SSH key authentication:

1. Generate an SSH key pair (if you don't have one):
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/ha_backup_key
   ```

2. Copy the public key to your Home Assistant server:
   ```bash
   ssh-copy-id -i ~/.ssh/ha_backup_key.pub root@your-ha-server
   ```

3. Update `.env`:
   ```bash
   HA_SSH_PRIVATE_KEY_PATH=/Users/your-username/.ssh/ha_backup_key
   # Remove or comment out HA_SSH_PASSWORD
   ```

## Usage

### Sync (Download + Backup)

```bash
npm run sync
# or
node ha-sync.js sync
```

This is the primary command. It will:
1. Connect to your HA server via SSH
2. Download all matching configuration files
3. Fetch the latest list of entities and save to `current/entities.txt`
4. Create a timestamped backup in `./backups/`
5. Keep the 10 most recent backups (older ones are auto-deleted)

### Backup

```bash
npm run backup
```

Alias for `sync`.

### Push (Upload Local Config)

```bash
npm run push
# or
node ha-sync.js push
```

This will:
1. Connect to your HA server
2. Ask for confirmation
3. Upload all files from your local `current/` directory to the remote server

**Note:** This overwrites files on the remote server.

### Diff (Compare Local vs Backup)

```bash
npm run diff
# or
node ha-sync.js diff
```

Shows the differences between your current local configuration and the latest backup (the state of the last download).
Useful to see what you have changed before pushing.

### List Backups

```bash
node ha-sync.js list
```

Shows all available backups with timestamps.

### List Entities

```bash
node ha-sync.js entities
```

Connects to the remote Home Assistant server and lists all registered entities (IDs, names, and platforms) to the console.
Note that `sync` automatically saves this list to `current/entities.txt`.

### Restore

```bash
npm run restore
# or
node ha-sync.js restore [backup-name]
```

Restore the latest backup or a specific backup by name.

```bash
node ha-sync.js restore latest
# or
node ha-sync.js restore 2025-11-22T10-30-00-000Z
```

**Note**: You may need to restart Home Assistant for changes to take effect after a push or restore.

## Directory Structure

```
ha-configs/
├── lib/
│   ├── config.js           # Configuration management
│   ├── ssh-client.js       # SSH/SFTP operations
│   └── backup-manager.js   # Local backup storage
├── backups/                # Timestamped backups (auto-created)
├── current/                # Current downloaded config (auto-created)
│   ├── entities.txt        # List of entities from last sync
│   └── ...                 # Config files
├── ha-sync.js             # Main CLI script
├── package.json
├── .env                   # Your configuration (create from .env.example)
└── README.md
```

## Security Considerations

- **Never commit `.env`** to version control (it's in `.gitignore`)
- Use SSH key authentication instead of passwords when possible
- The script validates all configuration on startup
- No secrets are logged or exposed in error messages
- File patterns help avoid downloading sensitive data (logs, databases)

## Pattern Matching

### Include Patterns

Specify which files to download (comma-separated):

```bash
HA_INCLUDE_PATTERNS=*.yaml,*.yml,automations/*,scripts/*
```

If not specified, all files are included by default.

### Exclude Patterns

Specify which files to skip (comma-separated):

```bash
HA_EXCLUDE_PATTERNS=*.log,*.db,*.db-shm,*.db-wal,home-assistant_v2.db*
```

Common files to exclude:
- `*.log` - Log files
- `*.db*` - Database files
- `*.pyc` - Python bytecode
- `.DS_Store` - macOS metadata

## Troubleshooting

### Connection Refused

- Verify SSH is enabled on your Home Assistant server
- Check the IP address and port in `.env`
- Test connection manually: `ssh username@your-ha-host`

### Permission Denied

- Verify your SSH credentials are correct
- If using SSH keys, ensure the key has proper permissions:
  ```bash
  chmod 600 ~/.ssh/ha_backup_key
  ```

### Missing Files

- Check your include/exclude patterns
- Verify the remote path is correct
- Ensure your SSH user has read permissions

### No Backups Available

- Run `npm run sync` at least once to create the first backup
- Check that `HA_LOCAL_BACKUP_PATH` is correctly configured

## Development

### Running Tests

```bash
npm test
```

(Note: Tests would need to be added)

### Code Structure

The codebase follows these principles:

- **Modularity**: Separate concerns (config, SSH, backup management)
- **Security**: No hard-coded secrets, input validation, secure SSH
- **Error Handling**: Explicit error handling with meaningful messages
- **Maintainability**: Clear naming, pure functions, minimal dependencies

See `CLAUDE.md` for detailed coding standards.

## License

MIT
