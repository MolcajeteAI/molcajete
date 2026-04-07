/**
 * -- Before Task Hook --
 *
 * Fires before a task begins its dev/test/review cycle. Use it to
 * set up task-specific state, notify external systems, or log progress.
 *
 * -- When it fires --
 * After the task is marked in_progress but before the first dev session.
 *
 * -- Input (ctx.input) --
 * @property {string} task_id      - Task ID ("TASK-0A1B")
 * @property {string} [feature_id] - Associated feature
 * @property {string} [usecase_id] - Associated use case
 * @property {string} [scenario_id]- Associated scenario
 * @property {string} [cwd]        - Worktree working directory
 * @property {string} [branch]     - Worktree branch name
 * @property {object} [build]      - BuildContext
 *
 * -- Expected output --
 * @returns {{ status: 'ok' }}
 */

/** @typedef {import('@molcajeteai/cli').HookContext} HookContext */
/** @typedef {import('@molcajeteai/cli').TaskLifecycleInput} TaskLifecycleInput */
/** @typedef {import('@molcajeteai/cli').LifecycleOutput} LifecycleOutput */

/** @param {HookContext<TaskLifecycleInput>} ctx */
export default async function beforeTask(ctx) {
  return { status: 'ok' };
}
