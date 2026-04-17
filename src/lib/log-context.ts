import { AsyncLocalStorage } from "node:async_hooks";

export interface TaskContext {
  taskId: string;
}

export const taskContext = new AsyncLocalStorage<TaskContext>();

let prefixEnabled = false;

export function enableTaskPrefix(enabled: boolean): void {
  prefixEnabled = enabled;
}

export function currentTaskPrefix(): string {
  if (!prefixEnabled) return "";
  const ctx = taskContext.getStore();
  if (!ctx) return "";
  return `[${ctx.taskId}] `;
}
