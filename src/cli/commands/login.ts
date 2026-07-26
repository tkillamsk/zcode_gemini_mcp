import { getOauthClient } from '@google/gemini-cli-core/dist/src/code_assist/oauth2.js';
import { setupUser } from '@google/gemini-cli-core/dist/src/code_assist/setup.js';
import { AccountPool } from '../../core/account-pool';
import chalk from 'chalk';

export async function login(label?: string): Promise<void> {
  console.log(chalk.blue('Starting OAuth login flow...'));
  console.log(chalk.dim('A browser window will open for Google authentication.'));

  try {
    // Use OLD API: getOauthClient() with no arguments
    const authClient = await getOauthClient();

    // Use OLD API: setupUser(authClient) returns string
    const projectId = await setupUser(authClient);

    // Get user info from auth client
    const tokenInfo = await authClient.getAccessToken();
    const email = await getUserEmail(authClient);

    // Create account record
    const pool = new AccountPool();
    pool.load();

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
    process.exit(1);
  }
}

async function getUserEmail(authClient: any): Promise<string> {
  try {
    // Try to get email from token info
    const tokenInfo = await authClient.getAccessToken();
    if (tokenInfo.token) {
      // Decode JWT to get email
      const parts = tokenInfo.token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        return payload.email || 'unknown@example.com';
      }
    }
  } catch {
    // Ignore errors
  }
  return 'unknown@example.com';
}
