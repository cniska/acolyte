/**
 * Runs `job` over every item with at most `limit` of them in flight, returning results in the
 * input's order. A rejecting job stops new work from starting and, once the in-flight jobs have
 * settled, rejects with the first error — so a caller never leaves work running behind it.
 */
export async function concurrentMap<T, R>(
  items: readonly T[],
  limit: number,
  job: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const errors: unknown[] = [];
  let next = 0;

  const width = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: width }, async () => {
    while (errors.length === 0) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = await job(items[index] as T);
      } catch (error) {
        // Collected rather than thrown: the other workers have to be given the chance to notice and
        // exit before the caller is told, or their work outlives the call that started it.
        errors.push(error);
        return;
      }
    }
  });

  await Promise.all(workers);
  if (errors.length > 0) throw errors[0];
  return results;
}
