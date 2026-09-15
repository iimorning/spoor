/**
 * Serialise async writes so overlapping calls only persist the newest payload.
 * In-flight work finishes, then at most one trailing snapshot runs.
 */
export function createLatestWinsWriter<T>(write: (value: T) => Promise<void>) {
  let tail = Promise.resolve();
  let latest: T | undefined;

  return function enqueue(value: T): Promise<void> {
    latest = value;
    const run = tail.then(async () => {
      if (latest === undefined) return;
      const snapshot = latest;
      latest = undefined;
      await write(snapshot);
    });
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
