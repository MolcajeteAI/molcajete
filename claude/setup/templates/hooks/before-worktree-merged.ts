import type { HookContext, WorktreeLifecycleInput, LifecycleOutput } from '@molcajeteai/cli';

export default async function beforeWorktreeMerged(
  ctx: HookContext<WorktreeLifecycleInput>,
): Promise<LifecycleOutput | void> {
  // ctx.input.task_id     — task identifier
  // ctx.input.path        — worktree path
  // ctx.input.branch      — branch to merge
  // ctx.input.base_branch — merge target

  // Add your pre-merge logic here (run final checks, etc.)
}
