import type { HookContext, SubtaskLifecycleInput, LifecycleOutput } from '@molcajeteai/cli';

export default async function beforeSubtask(
  ctx: HookContext<SubtaskLifecycleInput>,
): Promise<LifecycleOutput | void> {
  // ctx.input.task_id    — parent task identifier
  // ctx.input.subtask_id — subtask identifier
  // ctx.input.feature_id — optional feature identifier

  // Add your pre-subtask logic here (refresh env, pull changes, etc.)
}
