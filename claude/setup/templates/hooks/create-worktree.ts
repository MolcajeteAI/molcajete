import type { HookContext, CreateWorktreeInput, CreateWorktreeOutput } from '@molcajeteai/cli';

export default async function createWorktree(
  ctx: HookContext<CreateWorktreeInput>,
): Promise<CreateWorktreeOutput> {
  // ctx.input.path       — worktree path
  // ctx.input.branch     — branch name
  // ctx.input.base_branch — base branch

  // Add your worktree creation logic here
  return { status: 'ok', path: ctx.input.path };
}
