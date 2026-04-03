import { createConnection, type Socket } from 'node:net';
import { fork } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { GlobalRegistry, InstanceInfo } from '../types.js';
import {
  SOCKET_PATH,
  PID_FILE,
  encodeLine,
  parseLine,
} from './registry-protocol.js';
import type { RegistryState, RegistryResponse, RegistryPush } from './registry-protocol.js';
import { log } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Null Registry (fallback) ──

/**
 * Null implementation of GlobalRegistry for use when the daemon is unavailable.
 * Gracefully degrades: builds proceed without cross-instance coordination.
 */
export class NullRegistry implements GlobalRegistry {
  get<T = unknown>(_key: string): T | undefined {
    return undefined;
  }

  async set(_key: string, _value: unknown): Promise<void> {
    // no-op
  }

  has(_key: string): boolean {
    return false;
  }

  listInstances(): InstanceInfo[] {
    return [];
  }

  async allocatePort(startFrom?: number): Promise<number> {
    return startFrom ?? 2222;
  }

  async connect(): Promise<void> {
    // no-op
  }

  disconnect(): void {
    // no-op
  }
}

// ── Real Registry Client ──

export class RegistryClient implements GlobalRegistry {
  private instance: InstanceInfo;
  private socket: Socket | null = null;
  private cachedState: RegistryState = { instances: {}, store: {}, ports: {} };
  private pendingRequests = new Map<string, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  private buffer = '';

  constructor(instance: InstanceInfo) {
    this.instance = instance;
  }

  // ── Synchronous reads from cache ──

  get<T = unknown>(key: string): T | undefined {
    return this.cachedState.store[key] as T | undefined;
  }

  has(key: string): boolean {
    return key in this.cachedState.store;
  }

  listInstances(): InstanceInfo[] {
    return Object.values(this.cachedState.instances).map((inst) => ({
      cwd: inst.cwd,
      planId: inst.planId,
      pid: inst.pid,
      id: inst.id,
    }));
  }

  // ── Async operations ──

  async set(key: string, value: unknown): Promise<void> {
    await this.request('set', { key, value });
  }

  async allocatePort(startFrom?: number): Promise<number> {
    const result = await this.request('allocate-port', { startFrom });
    return result.port as number;
  }

  // ── Connection Lifecycle ──

  async connect(): Promise<void> {
    // Try to connect to existing daemon
    try {
      await this.tryConnect();
      await this.register();
      return;
    } catch {
      // Socket doesn't exist or is stale — need to spawn daemon
    }

    // Check for stale PID
    if (existsSync(PID_FILE)) {
      try {
        const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
        try {
          process.kill(pid, 0);
          // Process alive but socket failed — wait a bit and retry
        } catch {
          // Stale PID — daemon is dead
        }
      } catch {
        // Can't read PID file
      }
    }

    // Spawn daemon
    this.spawnDaemon();

    // Retry with backoff: 50ms, 100ms, 200ms, 400ms, 800ms
    const delays = [50, 100, 200, 400, 800];
    for (const delay of delays) {
      await new Promise((r) => setTimeout(r, delay));
      try {
        await this.tryConnect();
        await this.register();
        return;
      } catch {
        // Retry
      }
    }

    log('Warning: could not connect to registry daemon — proceeding without coordination');
  }

  disconnect(): void {
    if (this.socket && !this.socket.destroyed) {
      // Best-effort deregister
      const id = randomUUID().slice(0, 8);
      try {
        this.socket.write(encodeLine({
          id,
          type: 'req',
          method: 'deregister',
          params: {},
        }));
      } catch {
        // ignore
      }
      this.socket.destroy();
    }
    this.socket = null;
  }

  // ── Private ──

  private tryConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!existsSync(SOCKET_PATH)) {
        reject(new Error('Socket does not exist'));
        return;
      }

      const socket = createConnection(SOCKET_PATH);
      let connected = false;

      const timeout = setTimeout(() => {
        if (!connected) {
          socket.destroy();
          reject(new Error('Connection timeout'));
        }
      }, 2000);

      socket.on('connect', () => {
        connected = true;
        clearTimeout(timeout);
        this.socket = socket;
        this.setupSocket();
        resolve();
      });

      socket.on('error', (err) => {
        if (!connected) {
          clearTimeout(timeout);
          reject(err);
        }
      });
    });
  }

  private setupSocket(): void {
    if (!this.socket) return;

    this.socket.on('data', (chunk) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';

      for (const line of lines) {
        const msg = parseLine(line);
        if (!msg) continue;

        if (msg.type === 'res') {
          const res = msg as RegistryResponse;
          const pending = this.pendingRequests.get(res.id);
          if (pending) {
            this.pendingRequests.delete(res.id);
            if (res.error) {
              pending.reject(new Error(res.error));
            } else {
              pending.resolve(res.result || {});
            }
          }
        } else if (msg.type === 'push') {
          const push = msg as RegistryPush;
          if (push.event === 'state') {
            this.cachedState = push.data;
          }
        }
      }
    });

    this.socket.on('close', () => {
      // Reject all pending requests
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error('Connection closed'));
      }
      this.pendingRequests.clear();
      this.socket = null;
    });

    this.socket.on('error', () => {
      // Handled by close event
    });
  }

  private async register(): Promise<void> {
    await this.request('register', {
      id: this.instance.id,
      cwd: this.instance.cwd,
      planId: this.instance.planId,
      pid: this.instance.pid,
    });
  }

  private request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        reject(new Error('Not connected'));
        return;
      }

      const id = randomUUID().slice(0, 8);
      this.pendingRequests.set(id, { resolve, reject });

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${method} timed out`));
      }, 5000);

      // Clear timeout when resolved
      const originalResolve = this.pendingRequests.get(id)!.resolve;
      const originalReject = this.pendingRequests.get(id)!.reject;
      this.pendingRequests.set(id, {
        resolve: (v) => { clearTimeout(timeout); originalResolve(v); },
        reject: (e) => { clearTimeout(timeout); originalReject(e); },
      });

      this.socket.write(encodeLine({
        id,
        type: 'req',
        method: method as 'register',
        params,
      }));
    });
  }

  private spawnDaemon(): void {
    // Resolve the daemon entry point
    const daemonPath = resolve(__dirname, 'registry-daemon.mjs');

    try {
      const child = fork(daemonPath, [], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    } catch (err) {
      log(`Warning: failed to spawn registry daemon: ${(err as Error).message}`);
    }
  }
}
