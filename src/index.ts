// Public API — hook type exports
export type {
  // Build context
  BuildContext,
  BuildStage,

  // Context
  HookContext,
  HookFn,
  HookInfo,

  // Mandatory hook
  TestHookInput,
  TestHookOutput,

  // Environment hooks
  StartInput,
  StartOutput,
  StopInput,
  StopOutput,

  // Lifecycle hooks
  TaskLifecycleInput,
  SubtaskLifecycleInput,
  LifecycleOutput,
} from './types.js';

// Git utilities
export { merge, rebase, resolveConflicts } from './lib/git.js';
export type { GitResult, MergeOptions } from './lib/git.js';
