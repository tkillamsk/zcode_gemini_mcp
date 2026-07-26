import chalk from 'chalk';
import type { AccountRecord } from '../types';

const STATUS_ICONS: Record<AccountRecord['healthStatus'], string> = {
  healthy: chalk.green('●'),
  degraded: chalk.yellow('◐'),
  dead: chalk.red('○'),
  unknown: chalk.gray('○'),
};

const STATUS_LABELS: Record<AccountRecord['healthStatus'], string> = {
  healthy: chalk.green('healthy'),
  degraded: chalk.yellow('degraded'),
  dead: chalk.red('dead'),
  unknown: chalk.gray('unknown'),
};

export function maskToken(token: string): string {
  if (token.length <= 4) return '****';
  return '*'.repeat(token.length - 4) + token.slice(-4);
}

export function timeAgo(ms: number): string {
  if (ms <= 0) return 'never';
  const diff = Date.now() - ms;
  if (diff < 0) return 'never';

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function cooldownLeft(cooldownUntil: number | null): string {
  if (!cooldownUntil) return '—';
  const remaining = cooldownUntil - Date.now();
  if (remaining <= 0) return '—';

  const minutes = Math.ceil(remaining / 60_000);
  if (minutes < 60) return chalk.yellow(`${minutes}m left`);

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return chalk.yellow(`${hours}h ${mins}m left`);
}

export function formatAccount(
  account: AccountRecord,
  opts?: { pinned?: boolean; requestCount?: number },
): string {
  const icon = STATUS_ICONS[account.healthStatus];
  const id = account.id.slice(0, 6);
  const label = opts?.pinned ? chalk.cyan(account.label) : account.label;
  const cooldown = cooldownLeft(account.cooldownUntil);
  const lastUsed = account.lastHealthCheck ? timeAgo(account.lastHealthCheck) : 'never';
  const requests = opts?.requestCount?.toLocaleString() ?? '—';

  return `  ${id}    ${label.padEnd(20)} ${icon}        ${cooldown.padEnd(14)} ${lastUsed.padEnd(12)} ${requests}`;
}

export function formatPool(
  accounts: AccountRecord[],
  activeId: string | null,
  stats?: {
    totalRequests24h?: number;
    totalTokensIn?: number;
    totalTokensOut?: number;
    totalErrors?: number;
    lastRotation?: number;
  },
): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(chalk.bold(`Account Pool (${accounts.length} account${accounts.length !== 1 ? 's' : ''})`));
  lines.push(chalk.gray('─'.repeat(70)));

  if (accounts.length === 0) {
    lines.push(chalk.gray('  No accounts. Run `gemini-multi-auth login` to add one.'));
    lines.push('');
    return lines.join('\n');
  }

  // Header
  lines.push(
    `  ${'ID'.padEnd(8)} ${'Label'.padEnd(20)} ${'Status'.padEnd(10)} ${'Cooldown'.padEnd(16)} ${'Last Used'.padEnd(12)} ${'Requests'}`,
  );
  lines.push(
    `  ${'─'.repeat(6)}  ${'─'.repeat(18)} ${'─'.repeat(8)} ${'─'.repeat(14)} ${'─'.repeat(10)} ${'─'.repeat(8)}`,
  );

  for (const account of accounts) {
    const icon = STATUS_ICONS[account.healthStatus];
    const id = account.id.slice(0, 6);
    const label = account.id === activeId ? chalk.cyan(account.label) : account.label;
    const cooldown = cooldownLeft(account.cooldownUntil);
    const lastUsed = account.lastHealthCheck ? timeAgo(account.lastHealthCheck) : 'never';
    const requests = '—';

    lines.push(
      `  ${id.padEnd(8)} ${label.padEnd(20)} ${icon}        ${cooldown.padEnd(16)} ${lastUsed.padEnd(12)} ${requests}`,
    );
  }

  lines.push('');

  // Rotation mode
  if (activeId) {
    const pinnedAccount = accounts.find((a) => a.id === activeId);
    lines.push(chalk.cyan(`  Active rotation: pinned → ${pinnedAccount?.label ?? activeId.slice(0, 6)}`));
  } else {
    lines.push('  Active rotation: round-robin (no pin)');
  }

  if (stats?.lastRotation) {
    lines.push(`  Last rotation:   ${timeAgo(stats.lastRotation)}`);
  }

  // Totals
  if (stats) {
    lines.push('');
    if (stats.totalRequests24h !== undefined) {
      lines.push(`  Total requests:  ${stats.totalRequests24h.toLocaleString()} (24h)`);
    }
    if (stats.totalTokensIn !== undefined || stats.totalTokensOut !== undefined) {
      const fmtIn = formatTokenCount(stats.totalTokensIn ?? 0);
      const fmtOut = formatTokenCount(stats.totalTokensOut ?? 0);
      lines.push(`  Total tokens:    ${fmtIn} in / ${fmtOut} out`);
    }
    if (stats.totalErrors !== undefined) {
      const reqs = stats.totalRequests24h ?? 0;
      const pct = reqs > 0 ? ((stats.totalErrors / reqs) * 100).toFixed(1) : '0.0';
      lines.push(`  Errors:          ${stats.totalErrors} (${pct}%)`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

export function formatReport(totals: {
  requests: number;
  tokensIn: number;
  tokensOut: number;
  errors: number;
  errorRate: number;
  avgLatencyMs: number;
  byAccount: Array<{
    accountId: string;
    label: string;
    requests: number;
    tokensIn: number;
    tokensOut: number;
    avgLatencyMs: number;
    errors: number;
  }>;
  windowLabel: string;
}): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(chalk.bold(`Usage Report — last ${totals.windowLabel}`));
  lines.push(chalk.gray('─'.repeat(70)));
  lines.push('');

  // Totals
  lines.push(chalk.bold('  Totals'));
  lines.push(`  Requests:    ${totals.requests.toLocaleString()}`);
  lines.push(`  Tokens:      ${formatTokenCount(totals.tokensIn)} in / ${formatTokenCount(totals.tokensOut)} out`);
  lines.push(`  Avg Latency: ${Math.round(totals.avgLatencyMs)}ms`);
  lines.push(`  Errors:      ${totals.errors} (${(totals.errorRate * 100).toFixed(1)}%)`);
  lines.push('');

  // Per-account breakdown
  if (totals.byAccount.length > 0) {
    lines.push(chalk.bold('  By Account'));
    lines.push(
      `  ${'Account'.padEnd(26)} ${'Reqs'.padStart(8)} ${'Tokens In'.padStart(12)} ${'Tokens Out'.padStart(12)} ${'Avg Lat'.padStart(10)} ${'Errors'.padStart(8)}`,
    );
    lines.push(
      `  ${'─'.repeat(24)}  ${'─'.repeat(6)} ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(8)} ${'─'.repeat(6)}`,
    );

    for (const acct of totals.byAccount) {
      const id = acct.accountId.slice(0, 6);
      const name = `${id} ${acct.label}`.slice(0, 24);
      lines.push(
        `  ${name.padEnd(26)} ${acct.requests.toLocaleString().padStart(8)} ${formatTokenCount(acct.tokensIn).padStart(12)} ${formatTokenCount(acct.tokensOut).padStart(12)} ${(`${Math.round(acct.avgLatencyMs)}ms`).padStart(10)} ${acct.errors.toLocaleString().padStart(8)}`,
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}

export function formatHealthCheck(result: {
  accountId: string;
  label: string;
  status: 'healthy' | 'degraded' | 'dead' | 'unknown';
  latencyMs?: number;
  error?: string | null;
  tokenValid?: boolean;
  tokenExpiry?: number | null;
}): string {
  const icon = STATUS_ICONS[result.status];
  const id = result.accountId.slice(0, 6);
  const label = result.label;

  let line = `  ${icon} ${id} ${label} — ${STATUS_LABELS[result.status]}`;

  if (result.latencyMs !== undefined) {
    line += chalk.gray(` (${Math.round(result.latencyMs)}ms)`);
  }
  if (result.error) {
    line += chalk.red(` — ${result.error}`);
  }
  if (result.tokenValid === false) {
    line += chalk.red(' — token expired');
  } else if (result.tokenValid && result.tokenExpiry) {
    const left = result.tokenExpiry - Date.now();
    if (left < 300_000) {
      line += chalk.yellow(` — token expires in ${Math.ceil(left / 60_000)}m`);
    }
  }

  return line;
}

export function formatDoctorResult(results: Array<{
  accountId: string;
  label: string;
  status: 'OK' | 'DEGRADED' | 'DEAD' | 'EXPIRED' | 'MISSING_TOKENS';
  details: string;
  suggestion: string;
}>): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(chalk.bold('Doctor — Full Diagnostic'));
  lines.push(chalk.gray('─'.repeat(70)));
  lines.push('');

  for (const r of results) {
    const id = r.accountId.slice(0, 6);
    let statusColor: (s: string) => string;

    switch (r.status) {
      case 'OK':
        statusColor = chalk.green;
        break;
      case 'DEGRADED':
        statusColor = chalk.yellow;
        break;
      case 'DEAD':
      case 'EXPIRED':
      case 'MISSING_TOKENS':
        statusColor = chalk.red;
        break;
      default:
        statusColor = chalk.gray;
    }

    lines.push(`  ${statusColor(r.status.padEnd(14))} ${id} ${r.label}`);
    lines.push(chalk.gray(`                 ${r.details}`));
    if (r.suggestion) {
      lines.push(chalk.cyan(`                 → ${r.suggestion}`));
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toLocaleString();
}
