import type { HookContext, ReviewLifecycleInput, LifecycleOutput } from '@molcajeteai/cli';

export default async function beforeReview(
  ctx: HookContext<ReviewLifecycleInput>,
): Promise<LifecycleOutput | void> {
  // ctx.input.task_id    — task identifier
  // ctx.input.feature_id — optional feature identifier

  // Add your pre-review logic here
}
