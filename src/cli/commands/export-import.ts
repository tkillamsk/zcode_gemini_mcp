import { Command } from 'commander';
import fs from 'node:fs';
import chalk from 'chalk';
import { AccountPool } from '../../core/account-pool';
import type { AccountPool as PoolData } from '../../types';

export function exportCommand(program: Command): void {
  program
    .command('export')
    .description('Export account pool to stdout (JSON)')
    .action(() => {
      try {
        const pool = new AccountPool();
        pool.load();

        const accounts = pool.getAll();

        if (accounts.length === 0) {
          console.log(chalk.gray('No accounts to export.'));
          return;
        }

        const exportData = {
          exportedAt: new Date().toISOString(),
          version: 2,
          accounts: accounts.map((a) => ({
            id: a.id,
            label: a.label,
            email: a.email,
            oauthTokens: a.oauthTokens,
            projectId: a.projectId,
            createdAt: a.createdAt,
            tags: a.tags,
          })),
        };

        // Write to stdout as JSON
        process.stdout.write(JSON.stringify(exportData, null, 2) + '\n');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Export failed: ${msg}`));
        process.exitCode = 1;
      }
    });
}

export function importCommand(program: Command): void {
  program
    .command('import <file>')
    .description('Import account pool from a JSON file')
    .action((filePath: string) => {
      try {
        // Read file
        const resolved = filePath.startsWith('/') ? filePath : `${process.cwd()}/${filePath}`;
        if (!fs.existsSync(resolved)) {
          console.error(chalk.red(`File not found: ${resolved}`));
          process.exitCode = 1;
          return;
        }

        const content = fs.readFileSync(resolved, 'utf-8');
        let imported: {
          version?: number;
          accounts?: Array<{
            id: string;
            label: string;
            email: string;
            oauthTokens: { accessToken: string; refreshToken: string; expiresAt: number };
            projectId: string | null;
            createdAt: number;
            tags: string[];
          }>;
        };

        try {
          imported = JSON.parse(content);
        } catch {
          console.error(chalk.red('Invalid JSON file.'));
          process.exitCode = 1;
          return;
        }

        if (!imported.accounts || !Array.isArray(imported.accounts)) {
          console.error(chalk.red('Invalid export format — no accounts array found.'));
          process.exitCode = 1;
          return;
        }

        const pool = new AccountPool();
        pool.load();

        const existing = pool.getAll();
        const existingEmails = new Set(existing.map((a) => a.email.toLowerCase()));
        const existingIds = new Set(existing.map((a) => a.id));

        let imported_count = 0;
        let skipped_duplicates = 0;

        for (const account of imported.accounts) {
          // Skip if same ID already exists
          if (existingIds.has(account.id)) {
            skipped_duplicates++;
            continue;
          }

          // Skip if email already exists
          if (existingEmails.has(account.email.toLowerCase())) {
            skipped_duplicates++;
            console.log(
              chalk.gray(
                `  Skipped ${account.label} (${account.email}) — already in pool`,
              ),
            );
            continue;
          }

          // Add account
          pool.add({
            label: account.label,
            email: account.email,
            oauthTokens: account.oauthTokens,
            projectId: account.projectId ?? null,
            tags: account.tags ?? [],
          });

          imported_count++;
          console.log(chalk.green(`  Imported: ${account.label} (${account.email})`));
        }

        console.log('');
        console.log(
          chalk.green(
            `✓ Import complete: ${imported_count} imported, ${skipped_duplicates} skipped`,
          ),
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Import failed: ${msg}`));
        process.exitCode = 1;
      }
    });
}
