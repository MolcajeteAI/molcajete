import type { HookContext, CommitLifecycleInput, LifecycleOutput } from '@molcajeteai/cli';

export default async function beforeCommit(
  ctx: HookContext<CommitLifecycleInput>,
): Promise<LifecycleOutput | void> {
  // ctx.input.task_id        — task identifier
  // ctx.input.files          — files to be committed
  // ctx.input.base_branch    — base branch
  // ctx.input.working_branch — working branch

  // Add your pre-commit logic here (run checks, validate, etc.)
}
