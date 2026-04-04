import type { HookContext, TaskLifecycleInput, LifecycleOutput } from '@molcajeteai/cli';

export default async function beforeTask(
  ctx: HookContext<TaskLifecycleInput>,
): Promise<LifecycleOutput | void> {
  // ctx.input.task_id    — task identifier
  // ctx.input.feature_id — optional feature identifier
  // ctx.input.status     — task status

  // Add your pre-task logic here (refresh env, pull changes, etc.)
}
