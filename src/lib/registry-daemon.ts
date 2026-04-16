/**
 * Registry Daemon — standalone process for cross-instance resource coordination.
 *
 * Listens on a Unix socket at ~/.molcajete/registry.sock.
 * Tracks connected Molcajete instances, manages shared KV store, and allocates ports.
 * Exits gracefully after a grace period when the last client disconnects.
 *
 * This file is a separate tsup entry point — it runs as its own process.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { dirname } from "node:path";
import type { RegistryRequest, RegistryState } from "./registry-protocol.js";
import {
  DEFAULT_PORT_RANGE_END,
  DEFAULT_PORT_RANGE_START,
  encodeLine,
  GRACE_PERIOD_MS,
  MOLCAJETE_DIR,
  PID_FILE,
  parseLine,
  SOCKET_PATH,
} from "./registry-protocol.js";

// ── In-Memory State ──

const state: RegistryState = {
  instances: {},
  store: {},
  ports: {},
};

// Map socket → instanceId for cleanup on disconnect
const socketToInstance = new Map<Socket, string>();
const clients = new Set<Socket>();
let graceTimer: ReturnType<typeof setTimeout> | null = null;

// ── Socket Helpers ──

function broadcast(exclude?: Socket): void {
  const push = encodeLine({ type: "push", event: "state", data: state });
  for (const client of clients) {
    if (client !== exclude && !client.destroyed) {
      client.write(push);
    }
  }
}

function respond(socket: Socket, id: string, result: Record<string, unknown>): void {
  if (!socket.destroyed) {
    socket.write(encodeLine({ id, type: "res", result }));
  }
}

function respondError(socket: Socket, id: string, error: string): void {
  if (!socket.destroyed) {
    socket.write(encodeLine({ id, type: "res", error }));
  }
}

// ── Request Handlers ──

function handleRegister(socket: Socket, req: RegistryRequest): void {
  const {
    id: instanceId,
    cwd,
    planId,
    pid,
  } = req.params as {
    id: string;
    cwd: string;
    planId: string;
    pid: number;
  };

  state.instances[instanceId] = {
    id: instanceId,
    cwd: cwd as string,
    planId: planId as string,
    pid: pid as number,
    connectedAt: Date.now(),
  };

  socketToInstance.set(socket, instanceId);

  // Cancel grace timer — a client is connected
  if (graceTimer) {
    clearTimeout(graceTimer);
    graceTimer = null;
  }

  respond(socket, req.id, { ok: true });
  // Send full state to newly registered client
  socket.write(encodeLine({ type: "push", event: "state", data: state }));
  broadcast(socket);
}

function handleDeregister(socket: Socket, req: RegistryRequest): void {
  const instanceId = socketToInstance.get(socket);
  if (instanceId) {
    pruneInstance(instanceId);
    socketToInstance.delete(socket);
  }
  respond(socket, req.id, { ok: true });
  broadcast(socket);
}

function handleGet(socket: Socket, req: RegistryRequest): void {
  const key = req.params.key as string;
  respond(socket, req.id, { value: state.store[key] ?? null });
}

function handleSet(socket: Socket, req: RegistryRequest): void {
  const key = req.params.key as string;
  const value = req.params.value;
  state.store[key] = value;
  respond(socket, req.id, { ok: true });
  broadcast(socket);
}

function handleAllocatePort(socket: Socket, req: RegistryRequest): void {
  const startFrom = (req.params.startFrom as number) || DEFAULT_PORT_RANGE_START;
  const instanceId = socketToInstance.get(socket);

  if (!instanceId) {
    respondError(socket, req.id, "Instance not registered");
    return;
  }

  // Find first available port in range
  for (let port = startFrom; port <= DEFAULT_PORT_RANGE_END; port++) {
    if (!state.ports[port]) {
      state.ports[port] = instanceId;
      respond(socket, req.id, { port });
      broadcast(socket);
      return;
    }
  }

  respondError(socket, req.id, `No available ports in range ${startFrom}-${DEFAULT_PORT_RANGE_END}`);
}

function handleListInstances(socket: Socket, req: RegistryRequest): void {
  respond(socket, req.id, { instances: Object.values(state.instances) });
}

// ── Instance Cleanup ──

function pruneInstance(instanceId: string): void {
  delete state.instances[instanceId];

  // Release allocated ports
  for (const [port, owner] of Object.entries(state.ports)) {
    if (owner === instanceId) {
      delete state.ports[Number(port)];
    }
  }
}

// ── Connection Handler ──

function handleConnection(socket: Socket): void {
  clients.add(socket);

  let buffer = "";

  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      const msg = parseLine(line);
      if (!msg || msg.type !== "req") continue;

      const req = msg as RegistryRequest;

      switch (req.method) {
        case "register":
          handleRegister(socket, req);
          break;
        case "deregister":
          handleDeregister(socket, req);
          break;
        case "get":
          handleGet(socket, req);
          break;
        case "set":
          handleSet(socket, req);
          break;
        case "allocate-port":
          handleAllocatePort(socket, req);
          break;
        case "list-instances":
          handleListInstances(socket, req);
          break;
        default:
          respondError(socket, req.id, `Unknown method: ${req.method}`);
      }
    }
  });

  socket.on("close", () => {
    clients.delete(socket);

    const instanceId = socketToInstance.get(socket);
    if (instanceId) {
      pruneInstance(instanceId);
      socketToInstance.delete(socket);
      broadcast();
    }

    // Start grace timer if no clients remain
    if (clients.size === 0 && !graceTimer) {
      graceTimer = setTimeout(() => {
        cleanup();
        process.exit(0);
      }, GRACE_PERIOD_MS);
    }
  });

  socket.on("error", () => {
    // Handled by close event
  });
}

// ── Startup ──

function cleanup(): void {
  try {
    if (existsSync(SOCKET_PATH)) unlinkSync(SOCKET_PATH);
  } catch {
    // ignore
  }
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Ensure directory exists
mkdirSync(dirname(SOCKET_PATH), { recursive: true });

// Check for stale socket
if (existsSync(SOCKET_PATH)) {
  // Check if another daemon is running
  if (existsSync(PID_FILE)) {
    try {
      const pid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
      if (isProcessAlive(pid)) {
        // Another daemon is running — exit gracefully
        process.exit(0);
      }
    } catch {
      // Can't read PID file — assume stale
    }
  }
  // Stale socket — remove it
  unlinkSync(SOCKET_PATH);
}

const server = createServer(handleConnection);

server.on("error", (err) => {
  if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
    // Another daemon won the race — exit gracefully
    process.exit(0);
  }
  process.stderr.write(`Registry daemon error: ${err.message}\n`);
  cleanup();
  process.exit(1);
});

server.listen(SOCKET_PATH, () => {
  // Write PID file
  mkdirSync(MOLCAJETE_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(process.pid));

  // Start grace timer — if no client connects within grace period, exit
  graceTimer = setTimeout(() => {
    cleanup();
    process.exit(0);
  }, GRACE_PERIOD_MS);
});

// Cleanup on exit signals
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});

process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});
