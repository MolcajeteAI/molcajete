import { join } from "node:path";
import { homedir } from "node:os";

// ── Constants ──

export const MOLCAJETE_DIR = join(homedir(), ".molcajete");
export const SOCKET_PATH = join(MOLCAJETE_DIR, "registry.sock");
export const PID_FILE = join(MOLCAJETE_DIR, "registry.pid");
export const GRACE_PERIOD_MS = 5000;
export const DEFAULT_PORT_RANGE_START = 2222;
export const DEFAULT_PORT_RANGE_END = 3000;

// ── Wire Protocol: Line-Delimited JSON (NDJSON) ──

export interface RegistryRequest {
  id: string;
  type: "req";
  method: "register" | "deregister" | "get" | "set" | "allocate-port" | "list-instances";
  params: Record<string, unknown>;
}

export interface RegistryResponse {
  id: string;
  type: "res";
  result?: Record<string, unknown>;
  error?: string;
}

export interface RegistryPush {
  type: "push";
  event: "state";
  data: RegistryState;
}

export type RegistryMessage = RegistryRequest | RegistryResponse | RegistryPush;

// ── State ──

export interface RegistryInstance {
  id: string;
  cwd: string;
  planId: string;
  pid: number;
  connectedAt: number;
}

export interface RegistryState {
  instances: Record<string, RegistryInstance>;
  store: Record<string, unknown>;
  ports: Record<number, string>; // port → instanceId
}

// ── Helpers ──

export function encodeLine(msg: RegistryMessage): string {
  return `${JSON.stringify(msg)}\n`;
}

export function parseLine(line: string): RegistryMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as RegistryMessage;
  } catch {
    return null;
  }
}
