import { execSync } from "node:child_process";
import { debugCmd, stripAnsi } from "./format.js";
import { writeLog } from "./logger.js";
import { clearForLog, isSpinning, redrawAfterLog } from "./spinner.js";

// ── Debug Flag ──

let debug = false;

export function setDebug(value: boolean): void {
  debug = value;
}

export function isDebug(): boolean {
  return debug;
}

// ── Logging ──

export function log(...args: unknown[]): void {
  const ts = new Date().toISOString().slice(11, 19);
  const line = args.join(" ");

  if (isSpinning()) clearForLog();
  process.stderr.write(`[${ts}] ${line}\n`);
  if (isSpinning()) redrawAfterLog();

  writeLog(stripAnsi(line));
}

/**
 * Emit a non-title line: same transport as log() but no timestamp prefix.
 * Still routed through the log file (ANSI-stripped).
 */
export function logDetail(...args: unknown[]): void {
  const line = args.join(" ");

  if (isSpinning()) clearForLog();
  process.stderr.write(`${line}\n`);
  if (isSpinning()) redrawAfterLog();

  writeLog(stripAnsi(line));
}

// ── Sleep ──

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Shell Quoting ──

export function shellQuote(arg: string): string {
  if (/^[a-zA-Z0-9_./:=@-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

// ── Project Root ──

export function resolveProjectRoot(): string {
  return run("git rev-parse --show-toplevel").trim();
}

// ── Command Runner ──

export function run(cmd: string, opts: Record<string, unknown> = {}): string {
  if (debug) {
    process.stderr.write("\n");
    logDetail(debugCmd(cmd, (opts.cwd as string) || process.cwd()));
    process.stderr.write("\n");
  }
  return execSync(cmd, { encoding: "utf8", ...opts }) as string;
}

// ── Task ID Helpers ──

/** Check if an ID is a sub-task (TASK-XXXX-N format). */
export function isSubTaskId(id: string): boolean {
  return /^TASK-[A-Z0-9]{4}-\d+$/.test(id);
}

/** Extract parent task ID from a sub-task ID. */
export function parentTaskId(subTaskId: string): string {
  return subTaskId.replace(/-\d+$/, "");
}

/** Build the Claude session label shared by every dev/review/doc/recover call for a task. */
export function sessionLabel(planName: string, taskId: string): string {
  const parent = isSubTaskId(taskId) ? parentTaskId(taskId) : taskId;
  return `${planName}-${parent}`;
}
