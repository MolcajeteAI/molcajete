import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { log, run } from '../../lib/utils.js';
import { PLUGIN_DIR } from '../../lib/config.js';
import { invokeClaude } from '../lib/claude.js';

/**
 * Non-interactive setup command.
 */
export async function runSetup(opts: {
  overwrite?: boolean;
  overwriteHooks?: boolean;
  hooks?: string[];
  all?: boolean;
}): Promise<void> {
  const projectRoot = run('git rev-parse --show-toplevel').trim();
  const settingsPath = join(projectRoot, '.molcajete', 'settings.json');
  const hooksDir = join(projectRoot, '.molcajete', 'hooks');

  const alreadySetUp = existsSync(settingsPath) && existsSync(hooksDir);

  if (alreadySetUp && !opts.overwrite && !opts.overwriteHooks) {
    log('Already set up. Use --overwrite to regenerate everything or --overwrite-hooks to regenerate hooks only.');
    process.exit(0);
  }

  if (opts.overwriteHooks && !opts.overwrite) {
    log('Regenerating hooks only...');
    const hookDirective = buildHookDirective(opts);
    await spawnSetup(projectRoot, `Regenerate hooks for this project. ${hookDirective}Only output hooks, do not modify settings.`);
    log('Hooks regenerated.');
    return;
  }

  log('Running setup...');
  const hookDirective = buildHookDirective(opts);
  await spawnSetup(projectRoot, `Set up this project for Molcajete. Auto-detect the tech stack and generate hooks + settings. Do not ask any questions — infer everything from the codebase. ${hookDirective}`);
  log('Setup complete.');
}

function buildHookDirective(opts: { hooks?: string[]; all?: boolean }): string {
  if (opts.hooks?.length) {
    return `Generate only these specific hooks: ${opts.hooks.join(', ')}. `;
  }
  if (opts.all) {
    return 'Include all optional lifecycle hooks beyond the mandatory ones. ';
  }
  return '';
}

async function spawnSetup(projectRoot: string, prompt: string): Promise<void> {
  const result = await invokeClaude(projectRoot, [
    '--model', 'sonnet',
    '--max-turns', '30',
    '--allowedTools', 'Read,Write,Edit,Glob,Grep,Bash',
    `/m:setup ${prompt}`,
  ]);

  if (result.exitCode !== 0) {
    process.stderr.write('Error: setup session failed\n');
    if (result.stderr) process.stderr.write(result.stderr + '\n');
    process.exit(1);
  }
}
