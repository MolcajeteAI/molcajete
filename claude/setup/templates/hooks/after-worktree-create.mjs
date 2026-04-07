/**
 * -- After Worktree Create Hook --
 *
 * Fires after a git worktree is created. Use it to install dependencies
 * in the worktree, copy config files, or set up the worktree environment.
 *
 * -- When it fires --
 * After `git worktree add` succeeds, before the task's dev session.
 *
 * -- Input (ctx.input) --
 * @property {string} task_id       - Task ID ("TASK-0A1B")
 * @property {string} branch        - Branch name created
 * @property {string} base_branch   - Base branch it was forked from
 * @property {string} worktree_path - Path where the worktree was created
 * @property {object} [build]       - BuildContext
 *
 * -- Expected output --
 * @returns {{ status: 'ok' }}
 */

/** @typedef {import('@molcajeteai/cli').HookContext} HookContext */
/** @typedef {import('@molcajeteai/cli').WorktreeCreateInput} WorktreeCreateInput */
/** @typedef {import('@molcajeteai/cli').LifecycleOutput} LifecycleOutput */

/** @param {HookContext<WorktreeCreateInput>} ctx */
export default async function afterWorktreeCreate(ctx) {
  return { status: 'ok' };
}
