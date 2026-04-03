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

export interface HookMap {
  [name: string]: string; // name → absolute path
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
