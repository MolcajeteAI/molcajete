import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Plugin Directory ──

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const PLUGIN_DIR = resolve(__dirname, '../claude');

// ── Environment Config ──

export const BACKOFF_BASE = parseInt(process.env.MOLCAJETE_BACKOFF_BASE ?? '30', 10);
export const MAX_TURNS_AGENT = process.env.MOLCAJETE_MAX_TURNS_AGENT ?? '50';
export const BUDGET_AGENT = process.env.MOLCAJETE_BUDGET_AGENT ?? '5.00';
export const TIMEOUT = parseInt(process.env.MOLCAJETE_TASK_TIMEOUT ?? '897', 10) * 1000;
export const MAX_DEV_CYCLES = 7;

// ── Hook Constants ──

export const MANDATORY_HOOKS = ['test'];
export const ALL_HOOKS = [
  ...MANDATORY_HOOKS,
  'start', 'stop',
  'before-task', 'after-task',
  'before-subtask', 'after-subtask',
  'before-review', 'after-review',
  'before-documentation', 'after-documentation',
];
export const HOOK_TIMEOUT = parseInt(process.env.MOLCAJETE_HOOK_TIMEOUT ?? '30000', 10);

// ── JSON Schemas for Session Outputs ──

export const DEV_SESSION_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'failed'] },
    files_modified: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    key_decisions: { type: 'array', items: { type: 'string' } },
    error: { type: ['string', 'null'] },
  },
  required: ['status', 'files_modified', 'summary'],
};

export const REVIEW_SESSION_SCHEMA = {
  type: 'object',
  properties: {
    code_review: { type: 'array', items: { type: 'string' } },
    completeness: { type: 'array', items: { type: 'string' } },
  },
  required: ['code_review', 'completeness'],
};

export const DOC_SESSION_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'failed'] },
    files_modified: { type: 'array', items: { type: 'string' } },
    error: { type: ['string', 'null'] },
  },
  required: ['status', 'files_modified'],
};

export const RESOLVE_CONFLICTS_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['resolved', 'failed'] },
    files_resolved: { type: 'array', items: { type: 'string' } },
    decisions: { type: 'array', items: { type: 'string' } },
    error: { type: ['string', 'null'] },
  },
  required: ['status', 'files_resolved'],
};
