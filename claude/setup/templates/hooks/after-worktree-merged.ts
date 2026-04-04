import type { HookContext, WorktreeLifecycleInput, LifecycleOutput } from '@molcajeteai/cli';

export default async function afterWorktreeMerged(
  ctx: HookContext<WorktreeLifecycleInput>,
): Promise<LifecycleOutput | void> {
  // ctx.input.task_id     — task identifier
  // ctx.input.path        — worktree path (may no longer exist)
  // ctx.input.branch      — merged branch
  // ctx.input.base_branch — merge target

  // Add your post-merge logic here (cleanup, notify, etc.)
}
