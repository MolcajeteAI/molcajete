import type { HookContext, ValidateLifecycleInput, LifecycleOutput } from '@molcajeteai/cli';

export default async function afterValidate(
  ctx: HookContext<ValidateLifecycleInput>,
): Promise<LifecycleOutput | void> {
  // ctx.input.task_id — task identifier
  // ctx.input.cycle   — validation cycle number

  // Add your post-validation logic here
}
