import { Command } from 'commander';
import chalk from 'chalk';
import { AccountPool } from '../../core/account-pool';
import { formatDoctorResult } from '../formatter';

export function doctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Full diagnostic scan of all accounts')
    .action(() => {
      try {
        const pool = new AccountPool();
        pool.load();
        const accounts = pool.getAll();
        if (accounts.length === 0) {
          console.log(chalk.gray('No accounts in pool. Run `gemini-multi-auth login` first.'));
          return;
        }
        console.log(chalk.cyan(`Scanning ${accounts.length} account(s)...\n`));
        const results: Array<{
          accountId: string; label: string;
          status: 'OK' | 'DEGRADED' | 'DEAD' | 'EXPIRED' | 'MISSING_TOKENS';
          details: string; suggestion: string;
        }> = [];
        for (const account of accounts) {
          if (!account.oauthTokens.accessToken || !account.oauthTokens.refreshToken) {
            results.push({ accountId: account.id, label: account.label, status: 'MISSING_TOKENS', details: 'Access or refresh token is missing', suggestion: 'Re-login with `gemini-multi-auth login`' });
            continue;
          }
          const now = Date.now();
          if (account.oauthTokens.expiresAt < now) {
            results.push({ accountId: account.id, label: account.label, status: 'EXPIRED', details: `Token expired at ${new Date(account.oauthTokens.expiresAt).toISOString()}`, suggestion: 'Re-login with `gemini-multi-auth login`' });
            continue;
          }
          const expiresIn = account.oauthTokens.expiresAt - now;
          if (expiresIn < 5 * 60 * 1000) {
            results.push({ accountId: account.id, label: account.label, status: 'DEGRADED', details: `Token expires in ${Math.round(expiresIn / 60_000)}m`, suggestion: 'Monitor — may need re-login soon' });
            continue;
          }
          if (account.healthStatus === 'dead') {
            results.push({ accountId: account.id, label: account.label, status: 'DEAD', details: `Marked dead (${account.consecutiveErrors} consecutive errors)`, suggestion: 'Re-login with `gemini-multi-auth login`' });
            continue;
          }
          if (account.healthStatus === 'degraded') {
            results.push({ accountId: account.id, label: account.label, status: 'DEGRADED', details: `Degraded (${account.consecutiveErrors} consecutive errors)`, suggestion: 'Will auto-recover after cooldown, or re-login' });
            continue;
          }
          results.push({ accountId: account.id, label: account.label, status: 'OK', details: `Token valid, expires in ${Math.round(expiresIn / 60_000)}m`, suggestion: '' });
        }
        console.log(formatDoctorResult(results));
        const okCount = results.filter(r => r.status === 'OK').length;
        const degradedCount = results.filter(r => r.status === 'DEGRADED').length;
        const deadCount = results.filter(r => r.status === 'DEAD' || r.status === 'EXPIRED' || r.status === 'MISSING_TOKENS').length;
        if (deadCount > 0) console.log(chalk.red(`  ${deadCount} account(s) need attention.`));
        if (degradedCount > 0) console.log(chalk.yellow(`  ${degradedCount} account(s) degraded.`));
        if (okCount > 0) console.log(chalk.green(`  ${okCount} account(s) healthy.`));
        console.log('');
      } catch (err: unknown) {
        console.error(chalk.red(`Doctor failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = 1;
      }
    });
}
