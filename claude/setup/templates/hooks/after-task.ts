import type { HookContext, TaskLifecycleInput, LifecycleOutput } from '@molcajeteai/cli';

export default async function afterTask(
  ctx: HookContext<TaskLifecycleInput>,
): Promise<LifecycleOutput | void> {
  // ctx.input.task_id    — task identifier
  // ctx.input.feature_id — optional feature identifier
  // ctx.input.status     — task completion status
  // ctx.input.summary    — task summary

  // Add your post-task logic here (notify, update tracker, etc.)
}
