import type { HookContext, CommitLifecycleInput, LifecycleOutput } from '@molcajeteai/cli';

export default async function afterCommit(
  ctx: HookContext<CommitLifecycleInput>,
): Promise<LifecycleOutput | void> {
  // ctx.input.task_id        — task identifier
  // ctx.input.commits        — commit SHAs
  // ctx.input.files          — committed files
  // ctx.input.base_branch    — base branch
  // ctx.input.working_branch — working branch

  // Add your post-commit logic here (push, notify, etc.)
}
