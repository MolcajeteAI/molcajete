// ── Shared Interfaces ──

export interface Task {
  id: string; // TASK-XXXX
  title: string;
  intent: string;
  feature?: string;
  use_case?: string;
  scenario?: string;
  domain?: string;
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
  bdd_command?: string;
}

export interface Settings {
  useWorktrees: boolean;
  allowParallelTasks: boolean;
  startTimeout: number;
  persistWorktreeBranches: boolean;
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

export interface ValidateSessionOutput {
  code_review: string[];
  completeness: string[];
  formatting?: string[];
  linting?: string[];
  bdd_tests?: string[];
}

export interface CommitSessionOutput {
  status: 'done' | 'failed';
  commits: string[];
  error?: string | null;
}

export interface DocSessionOutput {
  status: 'done' | 'failed';
  files_modified: string[];
  error?: string | null;
}

export interface WorktreeFixOutput {
  status: 'resolved' | 'failed';
  worktree_path: string;
  action_taken?: string;
  error?: string | null;
}

export interface TaskContext {
  [key: string]: unknown;
  feature_id?: string;
  usecase_id?: string;
  scenario_id?: string;
}

export interface DevValidateResult {
  ok: boolean;
  devResult: DevSessionOutput | null;
  validateResult: ValidateSessionOutput | null;
  error?: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: string[];
  structured: ValidateSessionOutput;
  hardStop?: boolean;
}

// ── Hook Context Types ──

/** Key-value store scoped to a lifecycle phase (plan, task, subtask). */
export interface ScopedStore {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  keys(): string[];
  entries(): Array<[string, unknown]>;
  clear(): void;
}

/** Describes a host environment (local or remote) for test execution. */
export interface HostDescriptor {
  name: string;
  type: 'local' | 'remote';
  path?: string;
  ssh?: { host: string; port: number; user: string; keyPath?: string };
  appPath?: string;
  metadata?: Record<string, unknown>;
}

/** Task-scoped store with host registration. */
export interface TaskStore extends ScopedStore {
  registerHost(descriptor: HostDescriptor): void;
  getHost(name?: string): HostDescriptor | undefined;
  getHosts(): HostDescriptor[];
  removeHost(name: string): boolean;
}

/** Information about the current Molcajete instance. */
export interface InstanceInfo {
  cwd: string;
  planId: string;
  pid: number;
  id: string;
}

/** Information about the hook being executed. */
export interface HookInfo {
  name: string;
  taskId?: string;
  subtaskId?: string;
  worktreePath?: string;
  branch?: string;
  identifiers?: Record<string, string>;
}

/** Global cross-instance registry interface. */
export interface GlobalRegistry {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): Promise<void>;
  has(key: string): boolean;
  listInstances(): InstanceInfo[];
  allocatePort(startFrom?: number): Promise<number>;
  connect(): Promise<void>;
  disconnect(): void;
}

/** Context object passed to v2 hook functions. */
export interface HookContext {
  plan: ScopedStore;
  task: TaskStore;
  subtask: ScopedStore;
  global: GlobalRegistry;
  instance: InstanceInfo;
  hook: HookInfo;
  /** Convenience: get the first registered host (or by name). */
  getHost(name?: string): HostDescriptor | undefined;
  /** Convenience: get all registered hosts. */
  getHosts(): HostDescriptor[];
  /** Convenience: get allocated port for a host port mapping. */
  getHostPort(internalPort: number): number | undefined;
  /** Serializable snapshot for Claude sessions. */
  snapshot(): ContextSnapshot;
}

/** Serializable subset of context for Claude session prompts. */
export interface ContextSnapshot {
  planId: string;
  taskId?: string;
  subtaskId?: string;
  planStore: Record<string, unknown>;
  taskStore: Record<string, unknown>;
  hosts: HostDescriptor[];
}

/** v2 hook function signature. */
export type HookFn = (ctx: HookContext) => Promise<HookResult | void>;

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
