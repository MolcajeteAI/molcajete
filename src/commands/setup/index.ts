import { spawn } from 'node:child_process';
import { PLUGIN_DIR } from '../../lib/config.js';
import { log } from '../../lib/utils.js';

export interface SetupOptions {
  overwrite: boolean;
  all: boolean;
  yes: boolean;
}

export async function runSetup(options: SetupOptions): Promise<void> {
  const payload = JSON.stringify({
    overwrite: options.overwrite,
    all: options.all,
    yes: options.yes,
  });

  const child = spawn(
    'claude',
    [
      '--plugin-dir',
      PLUGIN_DIR,
      '--dangerously-skip-permissions',
      '-p',
      `/molcajete:setup ${payload}`,
    ],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
    },
  );

  const exitCode = await new Promise<number>((resolve) => {
    child.on('close', (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    log('Setup failed.');
    process.exit(exitCode);
  }
}
