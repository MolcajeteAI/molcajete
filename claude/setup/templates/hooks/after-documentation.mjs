/**
 * -- After Documentation Hook --
 *
 * Fires after the documentation session completes. Use it to validate
 * generated docs, publish them, or notify stakeholders.
 *
 * -- When it fires --
 * After the doc session finishes and doc changes are committed.
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
export default async function afterDocumentation(ctx) {
  return { status: 'ok' };
}
