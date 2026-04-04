import type { HookContext, WorktreeLifecycleInput, LifecycleOutput } from '@molcajeteai/cli';

export default async function afterWorktreeCreated(
  ctx: HookContext<WorktreeLifecycleInput>,
): Promise<LifecycleOutput | void> {
  // ctx.input.task_id     — task identifier
  // ctx.input.path        — worktree path
  // ctx.input.branch      — branch name
  // ctx.input.base_branch — base branch

  // Add your post-worktree-creation logic here (install deps, seed data, etc.)
}
