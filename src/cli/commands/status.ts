import { AccountPool } from '../../core/account-pool';
import chalk from 'chalk';

export async function status(): Promise<void> {
  const pool = new AccountPool();
  pool.load();

  const accounts = pool.getAll();
  const activeId = pool.getActive();

  if (accounts.length === 0) {
    console.log(chalk.yellow('No accounts configured.'));
    console.log('Run `gemini-multi-auth login` to add an account.');
    return;
  }

  console.log(chalk.blue('Account Pool Status'));
  console.log(chalk.dim('─'.repeat(80)));
  console.log(
    chalk.dim('ID'.padEnd(8)) +
    chalk.dim('Email'.padEnd(30)) +
    chalk.dim('Status'.padEnd(12)) +
    chalk.dim('Errors'.padEnd(8)) +
    chalk.dim('Label')
  );
  console.log(chalk.dim('─'.repeat(80)));

  for (const account of accounts) {
    const isActive = account.id === activeId;
    const statusColor = getStatusColor(account.healthStatus);
    const errors = account.consecutiveErrors.toString();
    const cooldown = account.cooldownUntil
      ? ` (cooldown until ${new Date(account.cooldownUntil).toLocaleTimeString()})`
      : '';

    console.log(
      chalk.cyan((isActive ? '→ ' : '  ') + account.id.slice(0, 8)) +
      chalk.white(account.email.padEnd(30)) +
      statusColor(account.healthStatus.padEnd(12)) +
      chalk.dim(errors.padEnd(8)) +
      chalk.dim(account.label + cooldown)
    );
  }

  console.log(chalk.dim('─'.repeat(80)));
  console.log(`Total: ${accounts.length} accounts`);
  if (activeId) {
    console.log(`Pinned: ${activeId}`);
  }
}

function getStatusColor(status: string): (text: string) => string {
  switch (status) {
    case 'healthy':
      return chalk.green;
    case 'degraded':
      return chalk.yellow;
    case 'dead':
      return chalk.red;
    default:
      return chalk.dim;
  }
}
