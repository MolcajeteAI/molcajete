export interface AsyncMutex {
  run<T>(fn: () => Promise<T> | T): Promise<T>;
}

export function createMutex(): AsyncMutex {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(fn: () => Promise<T> | T): Promise<T> {
      const next = tail.then(() => fn());
      tail = next.catch(() => undefined);
      return next as Promise<T>;
    },
  };
}
