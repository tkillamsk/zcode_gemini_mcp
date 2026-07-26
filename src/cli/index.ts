#!/usr/bin/env node

import { Command } from 'commander';
import { login } from './commands/login';
import { status } from './commands/status';
import { switchAccount } from './commands/switch';
import { removeAccount } from './commands/remove';
import { reportCommand } from './commands/report';
import { checkCommand } from './commands/check';
import { doctorCommand } from './commands/doctor';
import { exportCommand, importCommand } from './commands/export-import';

const program = new Command();

program
  .name('gemini-multi-auth')
  .description('Multi-account OAuth rotation for Gemini CLI')
  .version('1.0.0');

program
  .command('login')
  .description('Add a new Google account via OAuth')
  .argument('[label]', 'Optional label for the account')
  .option('-p, --project <id>', 'Google Cloud project ID')
  .action((label, opts) => login(label, opts.project));

program
  .command('status')
  .description('Show pool status and account health')
  .action(status);

program
  .command('switch')
  .description('Pin an account for use (or unpin with "none")')
  .argument('<id>', 'Account ID or "none" to unpin')
  .action(switchAccount);

program
  .command('remove')
  .description('Remove an account from the pool')
  .argument('<id>', 'Account ID to remove')
  .action(removeAccount);

reportCommand(program);
checkCommand(program);
doctorCommand(program);
exportCommand(program);
importCommand(program);

program.parse();
