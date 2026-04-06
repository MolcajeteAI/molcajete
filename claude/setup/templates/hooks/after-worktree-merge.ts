import type { HookContext, WorktreeMergeInput, LifecycleOutput } from '@molcajeteai/cli';

export default async function afterWorktreeMerge(
  ctx: HookContext<WorktreeMergeInput>,
): Promise<LifecycleOutput | void> {
  // ctx.input.task_id        — task identifier
  // ctx.input.branch         — worktree branch that was merged
  // ctx.input.base_branch    — target branch for the merge
  // ctx.input.worktree_path  — absolute path to the worktree

  // Add your post-merge logic here (cleanup, notify, etc.)
}
