import type { HookContext, WorktreeCreateInput, LifecycleOutput } from '@molcajeteai/cli';

export default async function beforeWorktreeCreate(
  ctx: HookContext<WorktreeCreateInput>,
): Promise<LifecycleOutput | void> {
  // ctx.input.task_id        — task identifier
  // ctx.input.branch         — worktree branch being created
  // ctx.input.base_branch    — base branch for the worktree
  // ctx.input.worktree_path  — absolute path to the worktree

  // Add your pre-create logic here (validate, notify, etc.)
}
