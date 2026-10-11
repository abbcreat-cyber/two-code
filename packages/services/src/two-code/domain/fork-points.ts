/** 仅整轮成功边界可分叉，中间开场/工具响应不承诺完整上下文。 */
export function twoCodeForkPoints(task: {
  status: string;
  events: ReadonlyArray<{
    seq: number;
    role: string;
    kind: string;
    text: string;
    continuation?: boolean;
  }>;
}): number[] {
  const points: number[] = [];
  let completed: number | undefined,
    failed = false;
  const finish = () => {
    if (completed && !failed) points.push(completed);
    completed = undefined;
    failed = false;
  };
  for (const event of task.events) {
    if (event.role === "user" && event.kind === "message" && !event.continuation) finish();
    if (event.role === "lead" && event.kind === "status" && event.text.startsWith("执行已结束"))
      completed = event.seq;
    if (event.kind === "error" || (event.role === "system" && event.text === "正在停止主手与副手"))
      failed = true;
  }
  if (task.status === "error" || task.status === "cancelled" || task.status === "running")
    failed = true;
  finish();
  return points;
}
