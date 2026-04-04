import type { HookContext, WorktreeLifecycleInput, LifecycleOutput } from '@molcajeteai/cli';

export default async function beforeWorktreeCreated(
  ctx: HookContext<WorktreeLifecycleInput>,
): Promise<LifecycleOutput | void> {
  // ctx.input.task_id     — task identifier
  // ctx.input.path        — planned worktree path
  // ctx.input.branch      — branch name
  // ctx.input.base_branch — base branch

  // Add your pre-worktree-creation logic here
}
