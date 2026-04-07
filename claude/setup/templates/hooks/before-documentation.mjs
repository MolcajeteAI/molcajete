/**
 * -- Before Documentation Hook --
 *
 * Fires before the documentation session for a task. Use it to gather
 * context, prepare doc templates, or check documentation standards.
 *
 * -- When it fires --
 * After the task passes quality gates, before the doc session runs.
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
/** @typedef {import('@molcajeteai/cli').DocumentationLifecycleInput} DocumentationLifecycleInput */
/** @typedef {import('@molcajeteai/cli').LifecycleOutput} LifecycleOutput */

/** @param {HookContext<DocumentationLifecycleInput>} ctx */
export default async function beforeDocumentation(ctx) {
  return { status: 'ok' };
}
