import { getOauthClient } from '@google/gemini-cli-core/dist/src/code_assist/oauth2.js';
import { setupUser } from '@google/gemini-cli-core/dist/src/code_assist/setup.js';
import { AccountPool } from '../../core/account-pool';
import { CONFIG_FILE } from '../../constants';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';

const GEMINI_DIR = path.join(os.homedir(), '.gemini');
const CREDS_FILE = path.join(GEMINI_DIR, 'oauth_creds.json');
const ACCOUNTS_FILE = path.join(GEMINI_DIR, 'google_accounts.json');
const ACCOUNT_ID_FILE = path.join(GEMINI_DIR, 'google_account_id');

interface Backup {
  creds: string | null;
  accounts: string | null;
  accountId: string | null;
}

// ── Config helpers (email → projectId) ──

interface LoginConfig {
  emailProjects: Record<string, string>;
}

function loadConfig(): LoginConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch {}
  return { emailProjects: {} };
}

function saveConfig(config: LoginConfig): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function getSavedProject(email: string): string | undefined {
  return loadConfig().emailProjects[email];
}

function saveProjectForEmail(email: string, projectId: string): void {
  const config = loadConfig();
  config.emailProjects[email] = projectId;
  saveConfig(config);
}

// ── Prompt user for project ID ──

function promptProjectId(email: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(
      chalk.yellow(`Enter Google Cloud Project ID for ${email}: `),
      (answer) => {
        rl.close();
        resolve(answer.trim());
      }
    );
  });
}

// ── Gemini ~/.gemini/ backup/restore ──

function backupGeminiFiles(): Backup {
  return {
    creds: fs.existsSync(CREDS_FILE) ? fs.readFileSync(CREDS_FILE, 'utf8') : null,
    accounts: fs.existsSync(ACCOUNTS_FILE) ? fs.readFileSync(ACCOUNTS_FILE, 'utf8') : null,
    accountId: fs.existsSync(ACCOUNT_ID_FILE) ? fs.readFileSync(ACCOUNT_ID_FILE, 'utf8') : null,
  };
}

function restoreGeminiFiles(backup: Backup): void {
  if (backup.creds) {
    fs.writeFileSync(CREDS_FILE, backup.creds, { mode: 0o600 });
  } else if (fs.existsSync(CREDS_FILE)) {
    fs.unlinkSync(CREDS_FILE);
  }
  if (backup.accounts) {
    fs.writeFileSync(ACCOUNTS_FILE, backup.accounts);
  } else if (fs.existsSync(ACCOUNTS_FILE)) {
    fs.unlinkSync(ACCOUNTS_FILE);
  }
  if (backup.accountId) {
    fs.writeFileSync(ACCOUNT_ID_FILE, backup.accountId);
  } else if (fs.existsSync(ACCOUNT_ID_FILE)) {
    fs.unlinkSync(ACCOUNT_ID_FILE);
  }
}

function extractEmailFromToken(token: string): string {
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      return payload.email || 'unknown@example.com';
    }
  } catch {}
  return 'unknown@example.com';
}

function extractEmailFromCredsFile(): string {
  try {
    if (!fs.existsSync(CREDS_FILE)) return 'unknown@example.com';
    const creds = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));
    // Try id_token (JWT with email)
    if (creds.id_token) return extractEmailFromToken(creds.id_token);
    // Try access_token (may be a JWT)
    if (creds.access_token) return extractEmailFromToken(creds.access_token);
  } catch {}
  // Fallback: google_accounts.json active entry
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
      if (data.active) return data.active;
    }
  } catch {}
  return 'unknown@example.com';
}

export async function login(label?: string, projectIdOverride?: string): Promise<void> {
  console.log(chalk.blue('Starting OAuth login flow...'));
  console.log(chalk.dim('A browser window will open for Google authentication.'));

  const backup = backupGeminiFiles();

  try {
    console.log(chalk.dim('Preparing OAuth environment...'));

    // If label looks like an email prefix, set it as active
    if (label) {
      try {
        const accountsData = fs.existsSync(ACCOUNTS_FILE)
          ? JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'))
          : { active: '', old: [] };
        const allEmails = [accountsData.active, ...(accountsData.old || [])].filter(Boolean);
        const targetEmail = allEmails.find((e: string) =>
          e === label || e.startsWith(label + '@') || e.split('@')[0] === label
        );
        if (targetEmail && accountsData.active !== targetEmail) {
          const current = accountsData.active;
          if (current && !accountsData.old) accountsData.old = [];
          if (current && !accountsData.old.includes(current)) accountsData.old.push(current);
          accountsData.old = accountsData.old.filter((e: string) => e !== targetEmail);
          accountsData.active = targetEmail;
          fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accountsData, null, 2));
          console.log(chalk.dim(`Set active account to: ${targetEmail}`));
        }
      } catch {}
    }

    // Remove cached creds to force fresh OAuth
    if (fs.existsSync(CREDS_FILE)) {
      fs.unlinkSync(CREDS_FILE);
    }

    console.log(chalk.dim('Opening browser for authentication...'));
    const authClient = await getOauthClient();

    // Extract email
    let email = extractEmailFromCredsFile();
    console.log(chalk.green(`Authenticated as: ${email}`));

    // ── Determine project ID ──
    let projectId = projectIdOverride || '';

    // 1. Check saved config
    if (!projectId) {
      const saved = getSavedProject(email);
      if (saved) {
        console.log(chalk.dim(`Using saved project: ${saved}`));
        projectId = saved;
      }
    }

    // 2. Try setupUser (works for personal accounts or if project already registered)
    if (!projectId) {
      try {
        const result = await setupUser(authClient);
        if (result && result !== 'placeholder' && result.length > 3) {
          projectId = result;
          console.log(chalk.dim(`Auto-detected project: ${projectId}`));
        }
      } catch (err: any) {
        if (!err.message?.includes('GOOGLE_CLOUD_PROJECT')) throw err;
        // Workspace account — needs project
      }
    }

    // 3. Still no project — try with saved project via env var
    if (!projectId) {
      const saved = getSavedProject(email);
      if (saved) {
        process.env.GOOGLE_CLOUD_PROJECT = saved;
        try {
          await setupUser(authClient);
          projectId = saved;
          console.log(chalk.dim(`Project confirmed: ${projectId}`));
        } catch {
          delete process.env.GOOGLE_CLOUD_PROJECT;
        }
      }
    }

    // 4. Prompt user
    if (!projectId) {
      console.log(chalk.yellow('No project found. This account needs a Google Cloud project.'));
      projectId = await promptProjectId(email);
      if (!projectId) {
        throw new Error('Project ID is required for this account');
      }
      process.env.GOOGLE_CLOUD_PROJECT = projectId;
      try {
        await setupUser(authClient);
      } finally {
        delete process.env.GOOGLE_CLOUD_PROJECT;
      }
    }

    // Save project for future logins
    saveProjectForEmail(email, projectId);
    console.log(chalk.dim(`Project: ${projectId}`));

    // Save to pool
    const tokenInfo = await authClient.getAccessToken();
    const pool = new AccountPool();
    pool.load();

    // Remove any existing entry for this email
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
    try {
      restoreGeminiFiles(backup);
      console.log(chalk.dim('Restored original ~/.gemini/ state.'));
    } catch (restoreErr: any) {
      console.warn(chalk.yellow(`⚠ Could not restore ~/.gemini/ state: ${restoreErr.message}`));
    }
  }
}
