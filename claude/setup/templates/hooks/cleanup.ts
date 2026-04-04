import type { HookContext, CleanupInput, CleanupOutput } from '@molcajeteai/cli';

export default async function cleanup(
  ctx: HookContext<CleanupInput>,
): Promise<CleanupOutput> {
  // ctx.input.path   — worktree path to clean up
  // ctx.input.branch — branch to remove

  // Add your cleanup logic here (remove worktree, delete branch)
  return { status: 'ok' };
}
