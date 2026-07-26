import { AccountPool } from '../../core/account-pool';
import chalk from 'chalk';

export async function removeAccount(id: string): Promise<void> {
  const pool = new AccountPool();
  pool.load();

  // Find account by full ID or partial match
  const accounts = pool.getAll();
  const account = accounts.find(
    (a) => a.id === id || a.id.startsWith(id)
  );

  if (!account) {
    console.error(chalk.red(`✗ Account not found: ${id}`));
    console.log('Available accounts:');
    for (const a of accounts) {
      console.log(`  ${a.id} - ${a.email}`);
    }
    process.exit(1);
  }

  const removed = pool.remove(account.id);
  if (removed) {
    console.log(chalk.green(`✓ Removed account: ${account.email}`));
  } else {
    console.error(chalk.red(`✗ Failed to remove account`));
    process.exit(1);
  }
}
