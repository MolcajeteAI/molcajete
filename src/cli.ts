import { Command } from 'commander';
import { setDebug } from './lib/utils.js';
import { getActiveChild } from './commands/lib/claude.js';
import { runBuild } from './commands/build/index.js';

const program = new Command();

program
  .name('molcajete')
  .version('3.9.0')
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
