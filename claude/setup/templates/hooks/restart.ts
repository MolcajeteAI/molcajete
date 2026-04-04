import type { HookContext, RestartInput, RestartOutput } from '@molcajeteai/cli';

export default async function restart(
  ctx: HookContext<RestartInput>,
): Promise<RestartOutput> {
  // Add your restart logic here (e.g., docker compose restart)
  return { status: 'ready' };
}
