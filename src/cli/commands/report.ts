import { Command } from 'commander';
import chalk from 'chalk';
import { AccountPool } from '../../core/account-pool';
import { Ledger } from '../../stats/ledger';
import { formatReport } from '../formatter';

const WINDOW_MAP: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export function reportCommand(program: Command): void {
  program
    .command('report')
    .description('Show usage statistics')
    .option('-w, --window <window>', 'Time window: 1h, 6h, 24h (default), 7d', '24h')
    .action((opts: { window: string }) => {
      try {
        const windowMs = WINDOW_MAP[opts.window];
        if (!windowMs) {
          console.error(chalk.red(`Invalid window "${opts.window}". Use: 1h, 6h, 24h, 7d`));
          process.exitCode = 1;
          return;
        }

        const pool = new AccountPool();
        pool.load();

        const ledger = new Ledger();
        const entries = ledger.readSince(windowMs);

        // Aggregate by account
        const byAccountMap = new Map<
          string,
          {
            requests: number;
            tokensIn: number;
            tokensOut: number;
            totalLatency: number;
            errors: number;
          }
        >();

        for (const entry of entries) {
          let acct = byAccountMap.get(entry.aid);
          if (!acct) {
            acct = { requests: 0, tokensIn: 0, tokensOut: 0, totalLatency: 0, errors: 0 };
            byAccountMap.set(entry.aid, acct);
          }
          acct.requests++;
          acct.tokensIn += entry.tokIn;
          acct.tokensOut += entry.tokOut;
          acct.totalLatency += entry.latency;
          if (entry.err) acct.errors++;
        }

        // Build per-account summary
        const byAccount = Array.from(byAccountMap.entries()).map(([aid, stats]) => {
          const account = pool.get(aid);
          return {
            accountId: aid,
            label: account?.label ?? aid.slice(0, 6),
            requests: stats.requests,
            tokensIn: stats.tokensIn,
            tokensOut: stats.tokensOut,
            avgLatencyMs: stats.requests > 0 ? stats.totalLatency / stats.requests : 0,
            errors: stats.errors,
          };
        });

        // Sort by requests descending
        byAccount.sort((a, b) => b.requests - a.requests);

        // Totals
        const totalRequests = entries.length;
        const totalTokensIn = entries.reduce((s, e) => s + e.tokIn, 0);
        const totalTokensOut = entries.reduce((s, e) => s + e.tokOut, 0);
        const totalErrors = entries.filter((e) => e.err !== null).length;
        const totalLatency = entries.reduce((s, e) => s + e.latency, 0);

        console.log(
          formatReport({
            requests: totalRequests,
            tokensIn: totalTokensIn,
            tokensOut: totalTokensOut,
            errors: totalErrors,
            errorRate: totalRequests > 0 ? totalErrors / totalRequests : 0,
            avgLatencyMs: totalRequests > 0 ? totalLatency / totalRequests : 0,
            byAccount,
            windowLabel: opts.window,
          }),
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Report failed: ${msg}`));
        process.exitCode = 1;
      }
    });
}
