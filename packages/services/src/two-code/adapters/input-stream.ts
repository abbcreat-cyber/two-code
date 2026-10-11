/** 原生流式输入队列；只持有尚未写入CLI的消息，不保存产品任务状态。 */
export class InputStream<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private wake?: () => void;
  closed = false;
  push(value: T): void {
    if (this.closed) throw new Error("原生输入已结束，更新未送达");
    this.values.push(value);
    this.wake?.();
    this.wake = undefined;
  }
  finish(): void {
    this.closed = true;
    this.wake?.();
    this.wake = undefined;
  }
  async *[Symbol.asyncIterator]() {
    while (!this.closed || this.values.length) {
      if (this.values.length) yield this.values.shift()!;
      else
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
    }
  }
}
