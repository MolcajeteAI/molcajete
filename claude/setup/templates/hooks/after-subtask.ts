import type { HookContext, SubtaskLifecycleInput, LifecycleOutput } from '@molcajeteai/cli';

export default async function afterSubtask(
  ctx: HookContext<SubtaskLifecycleInput>,
): Promise<LifecycleOutput | void> {
  // ctx.input.task_id    — parent task identifier
  // ctx.input.subtask_id — subtask identifier
  // ctx.input.feature_id — optional feature identifier
  // ctx.input.status     — subtask completion status

  // Add your post-subtask logic here
}
