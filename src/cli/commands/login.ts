import { getOauthClient } from '@google/gemini-cli-core/dist/src/code_assist/oauth2.js';
import { setupUser } from '@google/gemini-cli-core/dist/src/code_assist/setup.js';
import { AccountPool } from '../../core/account-pool';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const GEMINI_DIR = path.join(os.homedir(), '.gemini');
const CREDS_FILE = path.join(GEMINI_DIR, 'oauth_creds.json');
const ACCOUNTS_FILE = path.join(GEMINI_DIR, 'google_accounts.json');
const ACCOUNT_ID_FILE = path.join(GEMINI_DIR, 'google_account_id');

interface Backup {
  creds: string | null;
  accounts: string | null;
  accountId: string | null;
}

function backupGeminiFiles(): Backup {
  return {
    creds: fs.existsSync(CREDS_FILE) ? fs.readFileSync(CREDS_FILE, 'utf8') : null,
    accounts: fs.existsSync(ACCOUNTS_FILE) ? fs.readFileSync(ACCOUNTS_FILE, 'utf8') : null,
    accountId: fs.existsSync(ACCOUNT_ID_FILE) ? fs.readFileSync(ACCOUNT_ID_FILE, 'utf8') : null,
  };
}

function restoreGeminiFiles(backup: Backup): void {
  // Restore creds
  if (backup.creds) {
    fs.writeFileSync(CREDS_FILE, backup.creds, { mode: 0o600 });
  } else if (fs.existsSync(CREDS_FILE)) {
    fs.unlinkSync(CREDS_FILE);
  }

  // Restore accounts
  if (backup.accounts) {
    fs.writeFileSync(ACCOUNTS_FILE, backup.accounts);
  } else if (fs.existsSync(ACCOUNTS_FILE)) {
    fs.unlinkSync(ACCOUNTS_FILE);
  }

  // Restore account ID
  if (backup.accountId) {
    fs.writeFileSync(ACCOUNT_ID_FILE, backup.accountId);
  } else if (fs.existsSync(ACCOUNT_ID_FILE)) {
    fs.unlinkSync(ACCOUNT_ID_FILE);
  }
}

function forceAccountActive(email: string): void {
  // Set the target account as active in google_accounts.json
  const accountsData = fs.existsSync(ACCOUNTS_FILE)
    ? JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'))
    : { active: '', old: [] };

  // Move target from old to active, move current active to old
  const currentActive = accountsData.active;
  if (currentActive && currentActive !== email) {
    if (!accountsData.old) accountsData.old = [];
    if (!accountsData.old.includes(currentActive)) {
      accountsData.old.push(currentActive);
    }
  }

  // Remove target from old list
  if (accountsData.old) {
    accountsData.old = accountsData.old.filter((e: string) => e !== email);
  }

  accountsData.active = email;
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accountsData, null, 2));
}

function getCredsFromDisk(): { accessToken: string; refreshToken: string; expiresAt: number } | null {
  try {
    if (!fs.existsSync(CREDS_FILE)) return null;
    const creds = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));
    return {
      accessToken: creds.access_token || '',
      refreshToken: creds.refresh_token || '',
      expiresAt: creds.expiry_date || Date.now() + 3600 * 1000,
    };
  } catch {
    return null;
  }
}

function extractEmailFromToken(accessToken: string): string {
  try {
    const parts = accessToken.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      return payload.email || 'unknown@example.com';
    }
  } catch {}
  return 'unknown@example.com';
}

export async function login(label?: string, projectIdOverride?: string): Promise<void> {
  console.log(chalk.blue('Starting OAuth login flow...'));
  console.log(chalk.dim('A browser window will open for Google authentication.'));

  // Step 1: Save current state
  const backup = backupGeminiFiles();

  try {
    // Step 2: Force the target account active (or clear for new account)
    // If label looks like an email, use it; otherwise use it as a label hint
    // The browser will ask the user to pick which Google account to use
    console.log(chalk.dim('Preparing OAuth environment...'));

    // Remove existing creds to force fresh auth
    if (fs.existsSync(CREDS_FILE)) {
      fs.unlinkSync(CREDS_FILE);
    }

    // Step 3: Call getOauthClient() — this opens browser for fresh auth
    console.log(chalk.dim('Opening browser for authentication...'));
    const authClient = await getOauthClient();

    // Step 4: Setup user (OLD API: returns string projectId)
    // If project ID was provided, set env var for setupUser
    if (projectIdOverride) {
      process.env.GOOGLE_CLOUD_PROJECT = projectIdOverride;
    }
    const projectId = await setupUser(authClient);
    // Clean up env var
    if (projectIdOverride) {
      delete process.env.GOOGLE_CLOUD_PROJECT;
    }

    // Step 5: Get email from new token
    const tokenInfo = await authClient.getAccessToken();
    const email = extractEmailFromToken(tokenInfo.token || '');

    console.log(chalk.green(`Authenticated as: ${email}`));
    console.log(chalk.dim(`Project: ${projectId}`));

    // Step 6: Save to our pool
    const pool = new AccountPool();
    pool.load();

    // Check if this email already exists — remove old entry, add fresh
    const existing = pool.getAll().find(a => a.email === email);
    if (existing) {
      pool.remove(existing.id);
      console.log(chalk.dim(`Removed old entry for ${email} (${existing.id})`));
    }

    const account = pool.add({
      label: label || email.split('@')[0],
      email,
      oauthTokens: {
        accessToken: tokenInfo.token || '',
        refreshToken: authClient.credentials.refresh_token || '',
        expiresAt: authClient.credentials.expiry_date || Date.now() + 3600 * 1000,
      },
      projectId,
      tags: [],
    });
    console.log(chalk.green(`✓ Account added successfully!`));
    console.log(`  ID: ${account.id}`);
    console.log(`  Email: ${account.email}`);
    console.log(`  Project: ${account.projectId}`);
    console.log(`  Label: ${account.label}`);
  } catch (err: any) {
    console.error(chalk.red(`✗ Login failed: ${err.message}`));
  } finally {
    // Step 7: Always restore original ~/.gemini/ state
    try {
      restoreGeminiFiles(backup);
      console.log(chalk.dim('Restored original ~/.gemini/ state.'));
    } catch (restoreErr: any) {
      console.warn(chalk.yellow(`⚠ Could not restore ~/.gemini/ state: ${restoreErr.message}`));
      console.warn(chalk.yellow('You may need to manually restore ~/.gemini/oauth_creds.json'));
    }
  }
}
