/** 使用空闲名额持续派发，但同一配置始终只有一个所属任务。 */
export async function runMatrixQueue<T extends { pair: string[] }>(
  jobs: T[],
  run: (job: T) => Promise<void>,
  stop: () => Promise<boolean>,
  concurrency = 4,
) {
  const pending = [...jobs],
    busy = new Set<string>(),
    active = new Set<Promise<void>>();
  const errors: unknown[] = [];
  while (pending.length || active.size) {
    if (!errors.length && !(await stop())) {
      while (active.size < concurrency) {
        const index = pending.findIndex((job) => job.pair.every((id) => !busy.has(id)));
        if (index < 0) break;
        const job = pending.splice(index, 1)[0]!;
        job.pair.forEach((id) => busy.add(id));
        const running = Promise.resolve()
          .then(() => run(job))
          .catch((error) => {
            errors.push(error);
          })
          .finally(() => {
            job.pair.forEach((id) => busy.delete(id));
            active.delete(running);
          });
        active.add(running);
      }
    }
    if (!active.size) break;
    await Promise.race(active);
  }
  if (errors.length) throw new AggregateError(errors, "矩阵任务派发异常，已等待所属运行结束");
}
