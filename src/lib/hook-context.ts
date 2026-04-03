import type {
  ScopedStore,
  TaskStore,
  HostDescriptor,
  HookContext,
  HookInfo,
  InstanceInfo,
  GlobalRegistry,
  ContextSnapshot,
} from '../types.js';

// ── ScopedStoreImpl ──

export class ScopedStoreImpl implements ScopedStore {
  protected store = new Map<string, unknown>();

  get<T = unknown>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  keys(): string[] {
    return [...this.store.keys()];
  }

  entries(): Array<[string, unknown]> {
    return [...this.store.entries()];
  }

  clear(): void {
    this.store.clear();
  }

  /** Serialize to plain object for snapshots. */
  toJSON(): Record<string, unknown> {
    return Object.fromEntries(this.store);
  }
}

// ── TaskStoreImpl ──

export class TaskStoreImpl extends ScopedStoreImpl implements TaskStore {
  private hosts = new Map<string, HostDescriptor>();

  registerHost(descriptor: HostDescriptor): void {
    this.hosts.set(descriptor.name, descriptor);
  }

  getHost(name?: string): HostDescriptor | undefined {
    if (name) return this.hosts.get(name);
    // Return first host if no name specified
    const first = this.hosts.values().next();
    return first.done ? undefined : first.value;
  }

  getHosts(): HostDescriptor[] {
    return [...this.hosts.values()];
  }

  removeHost(name: string): boolean {
    return this.hosts.delete(name);
  }

  override clear(): void {
    super.clear();
    this.hosts.clear();
  }
}

// ── HookContextManager ──

/**
 * Manages the lifecycle of scoped stores across plan, task, and subtask boundaries.
 * Builds HookContext objects for v2 hooks.
 */
export class HookContextManager {
  private planStore = new ScopedStoreImpl();
  private taskStore = new TaskStoreImpl();
  private subtaskStore = new ScopedStoreImpl();
  private instance: InstanceInfo;
  private registry: GlobalRegistry;
  private portMap = new Map<number, number>(); // internalPort → allocatedPort

  constructor(instance: InstanceInfo, registry: GlobalRegistry) {
    this.instance = instance;
    this.registry = registry;
  }

  // ── Scope Lifecycle ──

  newPlanScope(): void {
    this.planStore = new ScopedStoreImpl();
    this.taskStore = new TaskStoreImpl();
    this.subtaskStore = new ScopedStoreImpl();
    this.portMap.clear();
  }

  newTaskScope(): void {
    this.taskStore = new TaskStoreImpl();
    this.subtaskStore = new ScopedStoreImpl();
    this.portMap.clear();
  }

  clearTaskScope(): void {
    this.taskStore.clear();
    this.subtaskStore.clear();
    this.portMap.clear();
  }

  newSubtaskScope(): void {
    this.subtaskStore = new ScopedStoreImpl();
  }

  clearSubtaskScope(): void {
    this.subtaskStore.clear();
  }

  // ── Port Mapping ──

  setPortMapping(internalPort: number, allocatedPort: number): void {
    this.portMap.set(internalPort, allocatedPort);
  }

  getPortMapping(internalPort: number): number | undefined {
    return this.portMap.get(internalPort);
  }

  // ── Context Building ──

  buildContext(hookInfo: HookInfo): HookContext {
    const taskStore = this.taskStore;
    const portMap = this.portMap;

    return {
      plan: this.planStore,
      task: taskStore,
      subtask: this.subtaskStore,
      global: this.registry,
      instance: this.instance,
      hook: hookInfo,

      getHost(name?: string): HostDescriptor | undefined {
        return taskStore.getHost(name);
      },

      getHosts(): HostDescriptor[] {
        return taskStore.getHosts();
      },

      getHostPort(internalPort: number): number | undefined {
        return portMap.get(internalPort);
      },

      snapshot(): ContextSnapshot {
        return {
          planId: hookInfo.taskId?.split('-').slice(0, 2).join('-') || '',
          taskId: hookInfo.taskId,
          subtaskId: hookInfo.subtaskId,
          planStore: (taskStore as unknown as ScopedStoreImpl).toJSON
            ? Object.fromEntries(
                (taskStore as unknown as { store: Map<string, unknown> }).store || new Map(),
              )
            : {},
          taskStore: Object.fromEntries(
            (taskStore as unknown as { store: Map<string, unknown> }).store || new Map(),
          ),
          hosts: taskStore.getHosts(),
        };
      },
    };
  }

  /** Build a snapshot for Claude session prompts. */
  snapshot(taskId?: string, subtaskId?: string): ContextSnapshot {
    return {
      planId: this.instance.planId,
      taskId,
      subtaskId,
      planStore: this.planStore.toJSON(),
      taskStore: this.taskStore.toJSON(),
      hosts: this.taskStore.getHosts(),
    };
  }
}
