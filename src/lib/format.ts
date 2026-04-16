/**
 * Centralized ANSI styling + layout helpers for `molcajete build` output.
 *
 * Colors are dropped automatically when stderr is not a TTY or NO_COLOR is set.
 * Layout helpers return preformatted strings suitable for `log()` / `logDetail()`.
 */

// ── Color constants ──

const ESC = "\x1b[";
export const RESET = `${ESC}0m`;
export const BOLD = `${ESC}1m`;
export const DIM = `${ESC}2m`;
export const RED = `${ESC}31m`;
export const GREEN = `${ESC}32m`;
export const YELLOW = `${ESC}33m`;
export const MAGENTA = `${ESC}35m`;
export const CYAN = `${ESC}36m`;
export const GRAY = `${ESC}90m`;
export const TEAL = `${ESC}38;5;73m`;

// ── TTY / NO_COLOR gate ──

export function colorsEnabled(): boolean {
  if (process.env.NO_COLOR) return false;
  return Boolean(process.stderr.isTTY);
}

function c(code: string, s: string): string {
  return colorsEnabled() ? `${code}${s}${RESET}` : s;
}

function combine(codes: string[], s: string): string {
  return colorsEnabled() ? `${codes.join("")}${s}${RESET}` : s;
}

// ── ANSI stripping ──

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

// ── Value formatting ──

export function fmtTokens(n: number): string {
  if (!n) return "0";
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

// ── Rule width ──

function ruleWidth(): number {
  const cols = process.stderr.columns;
  return Math.min(cols && cols > 0 ? cols : 80, 72);
}

function rule(char: string, color: string): string {
  return c(color, char.repeat(ruleWidth()));
}

// ── Phase labels ──

export type Phase = "DEV" | "VERIFY" | "REVIEW" | "DOC" | "RECOVERY";

const PHASE_COLOR: Record<Phase, string> = {
  DEV: MAGENTA,
  VERIFY: CYAN,
  REVIEW: YELLOW,
  DOC: GREEN,
  RECOVERY: RED,
};

export function phaseLabel(phase: Phase): string {
  return combine([BOLD, PHASE_COLOR[phase]], phase);
}

export function phaseSep(): string {
  return `\n${c(GRAY, "---")}\n`;
}

// ── Headings ──

export function taskHeading(id: string, title: string): { title: string; rule: string } {
  return {
    title: `${combine([BOLD, CYAN], `TASK  ${id}`)}  ${c(BOLD, title)}`,
    rule: rule("=", CYAN),
  };
}

export function subTaskHeading(id: string, title: string): { title: string; rule: string } {
  return {
    title: `${combine([BOLD, CYAN], `SUB-TASK  ${id}`)}  ${c(BOLD, title)}`,
    rule: rule("-", GRAY),
  };
}

export function subTaskCloseRule(): string {
  return rule("-", GRAY);
}

export function subTaskCloseTitle(id: string, status: "implemented" | "failed"): string {
  const statusColor = status === "implemented" ? GREEN : RED;
  return `${combine([BOLD, CYAN], `SUB-TASK  ${id}`)}  ${combine([BOLD, statusColor], status)}`;
}

export function buildEndHeading(): { title: string; rule: string } {
  return {
    title: combine([BOLD, CYAN], "BUILD COMPLETE"),
    rule: rule("=", CYAN),
  };
}

// ── Stats line ──

export type StatField = [label: string, value: string];

export function statsLine(fields: StatField[]): string {
  return fields
    .map(([label, value]) => `${c(TEAL, `[${label}: `)}${c(YELLOW, value)}${c(TEAL, "]")}`)
    .join(" ");
}

// ── Issues block ──

export function issuesBlock(issues: string[]): string {
  if (issues.length === 0) return "";
  const title = combine([BOLD, RED], "Issues:");
  const bullets = issues.map((issue) => c(GRAY, `  - ${issue}`)).join("\n");
  return `${title}\n${bullets}`;
}

// ── Debug emission ──

export function debugCmd(cmd: string, cwd: string): string {
  const line1 = c(YELLOW, `$ ${cmd}`);
  const line2 = c(YELLOW, `cwd: ${cwd}`);
  return `${line1}\n${line2}`;
}

export function debugHookIn(name: string, input: string): string {
  return `${c(YELLOW, `$ hook: ${name}`)}\n${c(YELLOW, `input: ${input}`)}`;
}

export function debugHookOut(output: string): string {
  return c(YELLOW, `output: ${output}`);
}
