// Public API — hook type exports
export type {
  // Context
  HookContext,
  HookFn,
  HookInfo,

  // Stores
  ScopedStore,
  TaskStore,
  GlobalRegistry,
  InstanceInfo,
  HostDescriptor,

  // Shared
  HookIdentifiers,

  // Mandatory hooks
  HealthCheckInput,
  HealthCheckOutput,
  RunTestsInput,
  RunTestsOutput,
  FormatInput,
  FormatOutput,
  LintInput,
  LintOutput,

  // Environment hooks
  StartInput,
  StartOutput,
  StopInput,
  StopOutput,
  LogsInput,
  LogsOutput,
  RestartInput,
  RestartOutput,

  // Worktree hooks
  CreateWorktreeInput,
  CreateWorktreeOutput,
  CleanupInput,
  CleanupOutput,
  MergeInput,
  MergeOutput,

  // Lifecycle hooks
  TaskLifecycleInput,
  SubtaskLifecycleInput,
  CommitLifecycleInput,
  ValidateLifecycleInput,
  WorktreeLifecycleInput,
  LifecycleOutput,
} from './types.js';
