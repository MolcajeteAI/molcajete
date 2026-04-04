import type { HookContext, StartInput, StartOutput } from '@molcajeteai/cli';
import { execSync } from 'node:child_process';

export default async function start(
  ctx: HookContext<StartInput>,
): Promise<StartOutput> {
  try {
    execSync('__START_COMMAND__', {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    });
    return { status: 'ready' };
  } catch (err) {
    return { status: 'failed', summary: (err as Error).message };
  }
}
