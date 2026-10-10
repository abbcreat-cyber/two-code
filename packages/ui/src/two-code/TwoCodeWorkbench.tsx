import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, CircleStop, GitBranch, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useTwoCode } from "@/hooks/useTwoCode.js";
import { RoleCard } from "./RoleCard.js";
import "./two-code.css";

const statusNames = {
  idle: "就绪",
  running: "执行中",
  completed: "已结束",
  cancelled: "已停止",
  error: "需要处理",
};
export function TwoCodeWorkbench({ workspacePath }: { workspacePath: string }) {
  const state = useTwoCode(workspacePath);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  const task = state.task,
    busy = task?.status === "running" || sending;
  const selection = task ?? state.preferences;
  const leadSelection = task?.lead.selection ?? state.preferences.lead;
  const sidekickSelection = task?.sidekick.selection ?? state.preferences.sidekick;
  const events = useMemo(() => {
    const rows: Array<{ key: number; role: string; kind: string; text: string }> = [];
    for (const event of task?.events ?? []) {
      if (
        !showDetails &&
        (event.role === "sidekick" || event.kind === "tool" || event.kind === "status")
      )
        continue;
      const last = rows.at(-1);
      if (last && event.kind === "message" && last.kind === "message" && last.role === event.role)
        last.text += event.text;
      else rows.push({ key: event.seq, role: event.role, kind: event.kind, text: event.text });
    }
    return rows;
  }, [task?.events, showDetails]);
  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "instant" });
  }, [events.length, events.at(-1)?.text]);
  const send = async () => {
    if (!text.trim() || busy || state.loading) return;
    setSending(true);
    try {
      await state.submit(text);
      setText("");
    } catch {
      /* 错误由hook统一展示。 */
    } finally {
      setSending(false);
    }
  };
  return (
    <main className="two-code-workbench" data-testid="two-code-workbench">
      <header className="two-code-header">
        <div className="flex min-w-0 items-center gap-3">
          <span className="two-code-emblem">
            <GitBranch size={18} />
          </span>
          <div>
            <h1 className="text-ui-lg font-semibold">双角色工作台</h1>
            <p className="text-ui-xs text-foreground-subtle">Two Code · 脚手架各司其职</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={state.newTask} disabled={sending}>
          <Plus size={15} />
          新任务
        </Button>
      </header>
      <div className="two-code-body">
        <aside className="two-code-config">
          <div className="two-code-mode" role="group" aria-label="协作模式">
            {[true, false].map((dual) => (
              <button
                key={String(dual)}
                disabled={!!task}
                aria-pressed={selection.dual === dual}
                onClick={() => state.setPreferences({ ...state.preferences, dual })}
              >
                {dual ? "双角色" : "单角色对照"}
              </button>
            ))}
          </div>
          <RoleCard
            role="lead"
            selection={leadSelection}
            catalog={state.catalog}
            disabled={!!task || state.loading}
            actualModel={task?.lead.actualModel}
            sessionId={task?.lead.sessionId}
            onChange={(lead) => state.setPreferences({ ...state.preferences, lead })}
          />
          {selection.dual && (
            <>
              <div className="two-code-connector">
                <span />
                交接 · 回传 · 审查
                <span />
              </div>
              <RoleCard
                role="sidekick"
                selection={sidekickSelection}
                catalog={state.catalog}
                disabled={!!task || state.loading}
                actualModel={task?.sidekick.actualModel}
                sessionId={task?.sidekick.sessionId}
                onChange={(sidekick) => state.setPreferences({ ...state.preferences, sidekick })}
              />
            </>
          )}
          {task && (
            <p className="text-ui-xs text-foreground-subtle">
              本任务保留当前组合。切换组合请新建任务。
            </p>
          )}
          <div className="mt-5 flex items-center justify-between text-ui-caption text-foreground-subtle">
            <span>本目录任务</span>
            <span>{state.tasks.length}</span>
          </div>
          <div className="two-code-history">
            {state.tasks.map((item) => (
              <button
                key={item.id}
                aria-pressed={item.id === state.activeId}
                onClick={() => state.select(item.id)}
              >
                <span className={`two-code-dot ${item.status}`} />
                <span className="truncate">{item.title}</span>
              </button>
            ))}
          </div>
        </aside>
        <section className="two-code-conversation">
          <div className="two-code-conversation-bar">
            <span className="min-w-0 truncate text-ui-base font-medium">
              {task?.title ?? "一个任务，两套擅长的执行方式"}
            </span>
            <span className="flex shrink-0 items-center gap-2 text-ui-xs text-foreground-subtle">
              {task?.status === "running" ? (
                <RefreshCw size={12} className="animate-spin motion-reduce:animate-none" />
              ) : (
                <Check size={12} />
              )}
              {task ? statusNames[task.status] : "就绪"}
            </span>
          </div>
          <div ref={scroll} className="two-code-transcript" aria-live="polite" aria-busy={busy}>
            {!events.length && (
              <div className="two-code-empty">
                <div className="two-code-empty-rails">
                  <span>主手</span>
                  <GitBranch size={20} />
                  <span>副手</span>
                </div>
                <h2 className="text-ui-lg font-medium">把判断与执行放在合适的位置</h2>
                <p className="mt-2 max-w-sm text-ui-base text-foreground-subtle">
                  分别选择脚手架和模型。主手拆解任务，副手执行，结果回到主手审查。
                </p>
                <p className="mt-4 text-ui-xs text-foreground-subtlest">
                  也可以切到单角色，用同一任务作比较。
                </p>
              </div>
            )}
            {events.map((event) => (
              <article key={event.key} className={`two-code-event ${event.kind} ${event.role}`}>
                <div className="two-code-event-label">
                  {{ lead: "主手", sidekick: "副手", user: "你", system: "状态" }[event.role] ??
                    event.role}
                  {event.kind === "handoff" ? " · 交接" : event.kind === "tool" ? " · 工具" : ""}
                </div>
                <div className="whitespace-pre-wrap break-words text-ui-base leading-relaxed">
                  {event.text}
                </div>
              </article>
            ))}
          </div>
          {(state.error || task?.error) && (
            <div role="alert" className="two-code-error">
              {state.error || task?.error}
            </div>
          )}
          {!!task?.permissions.length && (
            <div className="two-code-permissions">
              {task.permissions.map((permission) => (
                <div key={permission.id}>
                  <strong className="text-ui-base">
                    {permission.role === "lead" ? "主手" : "副手"}请求：{permission.title}
                  </strong>
                  <details>
                    <summary className="text-ui-xs">查看操作详情</summary>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-ui-xs">
                      {permission.detail}
                    </pre>
                  </details>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" onClick={() => void state.respond(permission.id, true)}>
                      允许本次
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void state.respond(permission.id, false)}
                    >
                      拒绝
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <footer className="two-code-composer">
            <textarea
              aria-label="任务内容"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={task ? "继续这个任务，沿用主副手上下文…" : "描述一个具体任务…"}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <button
                className="flex items-center gap-1 text-ui-xs text-foreground-subtle"
                aria-pressed={showDetails}
                onClick={() => setShowDetails(!showDetails)}
              >
                <ChevronDown size={13} />
                执行细节
              </button>
              <div className="flex items-center gap-2">
                <span className="text-ui-xs text-foreground-subtlest">Ctrl + Enter</span>
                {busy ? (
                  <Button size="sm" variant="outline" onClick={() => void state.cancel()}>
                    <CircleStop size={14} />
                    停止
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={!text.trim() || state.loading}
                    onClick={() => void send()}
                  >
                    <ArrowUp size={14} />
                    {task ? "继续" : "开始"}
                  </Button>
                )}
              </div>
            </div>
          </footer>
        </section>
      </div>
    </main>
  );
}
