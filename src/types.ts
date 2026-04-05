// ── Build Context ──

export type BuildStage =
  | 'start'
  | 'before-task'
  | 'development'
  | 'validation'
  | 'after-task'
  | 'documentation'
  | 'stop'
  | 'halted'
  | 'failed';

export interface BuildContext {
  plan_path: string;
  plan_name: string;
  plan_status: string;
  base_branch: string;
  scope: string[];
  stage: BuildStage;
  completed: {
    tasks: string[];
    scenarios: string[];
    use_cases: string[];
    features: string[];
  };
}

// ── Shared Interfaces ──

export interface Task {
  id: string; // TASK-XXXX
  title: string;
  intent: string;
  feature?: string;
  use_case?: string;
  scenario?: string;
  domain?: string;
  architecture?: string;
  description?: string;
  files_to_modify?: string[];
  estimated_context?: string;
  depends_on?: string[];
  status: 'pending' | 'in_progress' | 'implemented' | 'failed';
  errors?: string[];
  summary?: string;
  sub_tasks?: SubTask[];
}

export interface SubTask {
  id: string; // TASK-XXXX-N
  title: string;
  intent?: string;
  description?: string;
  files_to_modify?: string[];
  estimated_context?: string;
  depends_on?: string[];
  status: 'pending' | 'in_progress' | 'implemented' | 'failed';
  errors?: string[];
  summary?: string;
}

export interface PlanData {
  tasks: Task[];
  status: string;
  scope?: string[];
  base_branch?: string;
}

export interface Settings {
  maxDevCycles: number;
  remote: string;
  push: boolean;
  startTimeout?: number;
}

export interface HookResult {
  ok: boolean;
  data: Record<string, unknown>;
  stderr: string;
}

export interface ClaudeResult {
  output: string;
  stderr: string;
  exitCode: number;
  realMs: number;
}

export interface SessionStats {
  apiMs: number;
  costUsd: number;
  apiTime: string;
  realTime: string;
  realMs: number;
  cost: string;
}

export interface BuildStats {
  totalCostUsd: number;
  totalApiMs: number;
  totalRealMs: number;
  sessions: number;
}

export interface DevSessionOutput {
  status: 'done' | 'failed';
  files_modified: string[];
  summary: string;
  key_decisions?: string[];
  error?: string | null;
}

export interface ReviewSessionOutput {
  code_review: string[];
  completeness: string[];
}

export interface DocSessionOutput {
  status: 'done' | 'failed';
  files_modified: string[];
  error?: string | null;
}

export interface ResolveConflictsOutput {
  status: 'resolved' | 'failed';
  files_resolved: string[];
  decisions: string[];
  error?: string | null;
}

export interface RecoverySessionOutput {
  status: 'recovered' | 'failed';
  actions_taken: string[];
  files_modified: string[];
  summary: string;
  error?: string | null;
}

export interface RecoveryContext {
  plan_path: string;
  plan_name: string;
  failed_task_id: string;
  failed_stage: BuildStage;
  error: string;
  build: BuildContext;
  prior_summaries: string[];
  cycle_count: number;
}

export interface TaskContext {
  [key: string]: unknown;
  feature_id?: string;
  usecase_id?: string;
  scenario_id?: string;
}

export interface DevTestReviewResult {
  ok: boolean;
  devResult: DevSessionOutput | null;
  reviewResult: ReviewSessionOutput | null;
  error?: string;
}

// ── Verify Hook Types ──

export interface VerifyHookInput {
  task_id: string;
  commit: string;
  files: string[];
  tags: string[];
  scope: 'task' | 'subtask' | 'final';
  build?: BuildContext;
}

export interface VerifyHookOutput {
  status: 'success' | 'failure';
  issues: string[];
}

// ── Hook Types ──

export type StartInput = { build?: BuildContext };
export interface StartOutput {
  status: 'ready' | 'failed';
  summary?: string;
}

export type StopInput = { build?: BuildContext };
export interface StopOutput {
  status: 'ok' | 'failed';
  summary?: string;
}

export interface TaskLifecycleInput {
  task_id: string;
  feature_id?: string;
  usecase_id?: string;
  scenario_id?: string;
  status?: string;
  summary?: string;
  build?: BuildContext;
}

export interface SubtaskLifecycleInput {
  task_id: string;
  subtask_id: string;
  feature_id?: string;
  usecase_id?: string;
  scenario_id?: string;
  status?: string;
  build?: BuildContext;
}

export interface ReviewLifecycleInput {
  task_id: string;
  feature_id?: string;
  usecase_id?: string;
  scenario_id?: string;
  build?: BuildContext;
}

export interface DocumentationLifecycleInput {
  task_id: string;
  feature_id?: string;
  usecase_id?: string;
  scenario_id?: string;
  build?: BuildContext;
}

export interface LifecycleOutput {
  status: 'ok';
}

/** v2 hook function signature. */
export type HookFn<TInput = Record<string, unknown>, TOutput = unknown> =
  (ctx: HookContext<TInput>) => Promise<TOutput | void>;

/** Hook entry: path + version + optional cached function. */
export interface HookEntry {
  path: string;
  version: 1 | 2;
  fn?: HookFn;
}

/** Hook map: name → entry. */
export interface HookMap {
  [name: string]: HookEntry;
}

/** Context object passed to v2 hook functions. */
export interface HookContext<TInput = Record<string, unknown>> {
  input: TInput;
  hook: HookInfo;
}

/** Information about the hook being executed. */
export interface HookInfo {
  name: string;
  taskId?: string;
  subtaskId?: string;
}
