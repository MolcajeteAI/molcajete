import { createRequire } from 'node:module';
import { Command } from 'commander';
import { setDebug } from './lib/utils.js';
import { getActiveChild } from './commands/lib/claude.js';
import { runBuild } from './commands/build/index.js';
import { runSetup } from './commands/setup/index.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const program = new Command();

program
  .name('molcajete')
  .version(pkg.version)
  .description('Spec-driven software development CLI powered by Claude Code')
  .option('--debug', 'Print spawned claude commands to stderr')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.debug) setDebug(true);
  });

program
  .command('build')
  .description('Execute all pending tasks in a plan')
  .argument('<plan-name>', 'Plan name, path, timestamp, or slug')
  .option('--resume', 'Resume from where a previous build left off (skip implemented tasks)')
  .action(async (planName, opts) => {
    await runBuild(planName, { resume: opts.resume });
  });

program
  .command('setup')
  .description('Detect project tooling and generate hook scripts')
  .option('--overwrite', 'Overwrite existing hooks')
  .option('--all', 'Generate all hooks (default + lifecycle)')
  .option('--yes', 'Skip confirmation')
  .action(async (opts) => {
    await runSetup({
      overwrite: opts.overwrite ?? false,
      all: opts.all ?? false,
      yes: opts.yes ?? false,
    });
  });

// Signal handlers
process.on('SIGINT', () => {
  const child = getActiveChild();
  if (child) child.kill('SIGINT');
  process.exit(130);
});

process.on('SIGTERM', () => {
  const child = getActiveChild();
  if (child) child.kill('SIGTERM');
  process.exit(143);
});

program.parse();
