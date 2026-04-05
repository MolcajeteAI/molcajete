import type { HookContext, ReviewLifecycleInput, LifecycleOutput } from '@molcajeteai/cli';

export default async function afterReview(
  ctx: HookContext<ReviewLifecycleInput>,
): Promise<LifecycleOutput | void> {
  // ctx.input.task_id    — task identifier
  // ctx.input.feature_id — optional feature identifier

  // Add your post-review logic here
}
