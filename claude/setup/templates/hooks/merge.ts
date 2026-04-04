import type { HookContext, MergeInput, MergeOutput } from '@molcajeteai/cli';

export default async function merge(
  ctx: HookContext<MergeInput>,
): Promise<MergeOutput> {
  // ctx.input.path        — worktree path
  // ctx.input.branch      — branch to merge
  // ctx.input.base_branch — target branch

  // Add your merge logic here
  return { status: 'ok' };
}
