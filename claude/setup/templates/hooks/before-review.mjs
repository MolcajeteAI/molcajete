/**
 * -- Before Review Hook --
 *
 * Fires before the code review session for a task. Use it to prepare
 * review context or notify reviewers.
 *
 * -- When it fires --
 * After the dev session succeeds, before the review session runs.
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
/** @typedef {import('@molcajeteai/cli').ReviewLifecycleInput} ReviewLifecycleInput */
/** @typedef {import('@molcajeteai/cli').LifecycleOutput} LifecycleOutput */

/** @param {HookContext<ReviewLifecycleInput>} ctx */
export default async function beforeReview(ctx) {
  return { status: 'ok' };
}
