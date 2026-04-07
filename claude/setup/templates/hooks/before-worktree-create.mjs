/**
 * -- Before Worktree Create Hook --
 *
 * Fires before a git worktree is created for a task. Use it to validate
 * the branch name, check disk space, or prepare shared resources.
 *
 * -- When it fires --
 * After the task starts, before `git worktree add` runs.
 *
 * -- Input (ctx.input) --
 * @property {string} task_id       - Task ID ("TASK-0A1B")
 * @property {string} branch        - Branch name to be created
 * @property {string} base_branch   - Base branch to fork from
 * @property {string} worktree_path - Path where the worktree will be created
 * @property {object} [build]       - BuildContext
 *
 * -- Expected output --
 * @returns {{ status: 'ok' }}
 */

/** @typedef {import('@molcajeteai/cli').HookContext} HookContext */
/** @typedef {import('@molcajeteai/cli').WorktreeCreateInput} WorktreeCreateInput */
/** @typedef {import('@molcajeteai/cli').LifecycleOutput} LifecycleOutput */

/** @param {HookContext<WorktreeCreateInput>} ctx */
export default async function beforeWorktreeCreate(ctx) {
  return { status: 'ok' };
}
