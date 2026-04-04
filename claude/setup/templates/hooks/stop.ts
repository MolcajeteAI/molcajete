import type { HookContext, StopInput, StopOutput } from '@molcajeteai/cli';
import { execSync } from 'node:child_process';

export default async function stop(
  ctx: HookContext<StopInput>,
): Promise<StopOutput> {
  try {
    execSync('__STOP_COMMAND__', {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    });
    return { status: 'ok' };
  } catch (err) {
    return { status: 'failed', summary: (err as Error).message };
  }
}
