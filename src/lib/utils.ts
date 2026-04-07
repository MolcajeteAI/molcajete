import { execSync } from "node:child_process";

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
  process.stderr.write(`[${ts}] ${args.join(" ")}\n`);
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
    const YELLOW = "\x1b[33m";
    const RESET = "\x1b[0m";
    process.stderr.write("\n");
    log(`${YELLOW}$ ${cmd}${RESET}`);
    log(`${YELLOW}cwd: ${(opts.cwd as string) || process.cwd()}${RESET}`);
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
