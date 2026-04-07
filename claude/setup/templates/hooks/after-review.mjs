/**
 * -- After Review Hook --
 *
 * Fires after the code review session completes. Use it to log review
 * findings, post results to a tracker, or trigger follow-up actions.
 *
 * -- When it fires --
 * After the review session finishes, with the review issues available.
 *
 * -- Input (ctx.input) --
 * @property {string}   task_id      - Task ID ("TASK-0A1B")
 * @property {string}   [feature_id] - Associated feature
 * @property {string}   [usecase_id] - Associated use case
 * @property {string}   [scenario_id]- Associated scenario
 * @property {string[]} [issues]     - Review issues found
 * @property {string}   [cwd]        - Worktree working directory
 * @property {string}   [branch]     - Worktree branch name
 * @property {object}   [build]      - BuildContext
 *
 * -- Expected output --
 * @returns {{ status: 'ok' }}
 */

/** @typedef {import('@molcajeteai/cli').HookContext} HookContext */
/** @typedef {import('@molcajeteai/cli').ReviewLifecycleInput} ReviewLifecycleInput */
/** @typedef {import('@molcajeteai/cli').LifecycleOutput} LifecycleOutput */

/** @param {HookContext<ReviewLifecycleInput>} ctx */
export default async function afterReview(ctx) {
  return { status: 'ok' };
}
