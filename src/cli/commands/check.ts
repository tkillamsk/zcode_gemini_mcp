import { Command } from 'commander';
import chalk from 'chalk';
import { AccountPool } from '../../core/account-pool';
import { formatHealthCheck } from '../formatter';

export function checkCommand(program: Command): void {
  program
    .command('check [account]')
    .description('Run health check on one or all accounts')
    .action((accountRef?: string) => {
      try {
        const pool = new AccountPool();
        pool.load();
        const accounts = pool.getAll();
        if (accounts.length === 0) {
          console.log(chalk.gray('No accounts in pool.'));
          return;
        }
        const toCheck = accountRef
          ? accounts.filter(a => a.id.startsWith(accountRef) || a.id === accountRef || a.label.toLowerCase() === accountRef.toLowerCase())
          : accounts;
        if (accountRef && toCheck.length === 0) {
          console.error(chalk.red(`No account found matching "${accountRef}".`));
          process.exitCode = 1;
          return;
        }
        console.log(chalk.cyan(`Checking ${toCheck.length} account(s)...\n`));
        for (const account of toCheck) {
          const now = Date.now();
          const expired = account.oauthTokens.expiresAt < now;
          const expiresIn = account.oauthTokens.expiresAt - now;
          let status: 'healthy' | 'degraded' | 'dead' = 'healthy';
          let error: string | null = null;
          if (!account.oauthTokens.accessToken || !account.oauthTokens.refreshToken) {
            status = 'dead'; error = 'Missing tokens — re-login required';
          } else if (expired) {
            status = 'degraded'; error = `Token expired ${new Date(account.oauthTokens.expiresAt).toISOString()}`;
          } else if (account.healthStatus === 'dead') {
            status = 'dead'; error = `Marked dead (${account.consecutiveErrors} consecutive errors)`;
          } else if (expiresIn < 5 * 60 * 1000) {
            status = 'degraded'; error = `Token expires in ${Math.ceil(expiresIn / 60_000)}m`;
          }
          console.log(formatHealthCheck({
            accountId: account.id, label: account.label, status,
            latencyMs: undefined, error, tokenValid: !expired && status === 'healthy',
            tokenExpiry: account.oauthTokens.expiresAt,
          }));
        }
        console.log('');
      } catch (err: unknown) {
        console.error(chalk.red(`Health check failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = 1;
      }
    });
}
