import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripAnsi } from "./format.js";

let logFilePath: string | null = null;

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function initLogger(command: string, label: string): string {
  const dir = join(tmpdir(), "molcajete");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // ignore — already exists
  }

  const safeName = label.replace(/[^a-zA-Z0-9_-]/g, "-");
  logFilePath = join(dir, `${command}-${safeName}-${timestamp()}.log`);

  try {
    writeFileSync(logFilePath, `# ${command} ${label} — ${new Date().toISOString()}\n`);
  } catch {
    // never crash over a log file
  }

  return logFilePath;
}

export function writeLog(line: string): void {
  if (!logFilePath) return;
  try {
    const ts = new Date().toISOString().slice(11, 19);
    appendFileSync(logFilePath, `[${ts}] ${stripAnsi(line)}\n`);
  } catch {
    // never crash over a log file
  }
}

export function closeLogger(): void {
  if (!logFilePath) return;
  try {
    appendFileSync(logFilePath, `# closed ${new Date().toISOString()}\n`);
  } catch {
    // never crash over a log file
  }
  logFilePath = null;
}

export function getLogFilePath(): string | null {
  return logFilePath;
}
