// Public API — hook type exports

export type { GitResult, MergeOptions } from "./lib/git.js";

// Git utilities
export { merge, rebase, resolveConflicts } from "./lib/git.js";
export type {
  // Build context
  BuildContext,
  BuildStage,
  DocumentationLifecycleInput,
  // Halt hook (fires when build is abandoned mid-flight)
  HaltHookInput,
  // Healthcheck hook (infra preflight)
  HealthcheckHookInput,
  HealthcheckHookOutput,
  // Context
  HookContext,
  HookFn,
  HookInfo,
  LifecycleOutput,
  ReviewLifecycleInput,
  // Environment hooks
  StartInput,
  StartOutput,
  StopInput,
  StopOutput,
  SubtaskLifecycleInput,
  // Lifecycle hooks
  TaskLifecycleInput,
  // Mandatory hook
  VerifyHookInput,
  VerifyHookOutput,
  WorktreeCreateInput,
  WorktreeMergeInput,
} from "./types.js";
