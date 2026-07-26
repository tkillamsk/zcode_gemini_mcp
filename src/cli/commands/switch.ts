import { AccountPool } from '../../core/account-pool';
import chalk from 'chalk';

export async function switchAccount(id: string): Promise<void> {
  const pool = new AccountPool();
  pool.load();

  if (id === 'none') {
    pool.clearActive();
    console.log(chalk.green('✓ Account unpinned. Rotation will use automatic selection.'));
    return;
  }

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

  if (account.healthStatus === 'dead') {
    console.error(chalk.red(`✗ Account is dead (auth invalid): ${account.email}`));
    console.log('Remove it with `gemini-multi-auth remove ' + account.id + '`');
    process.exit(1);
  }

  pool.setActive(account.id);
  console.log(chalk.green(`✓ Pinned account: ${account.email}`));
  console.log(`  ID: ${account.id}`);
}
