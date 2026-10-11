# 主副手使用前端内置浏览器

Two Code已有Main WebContentsView浏览器、Host执行桥及前端标签页，Step/Claude桥此前未注入该能力。接入必须复用这些真实组件，不启动外部Chrome，不用模型运行Playwright脚本替代内置浏览器。

窗口Host通过装配层向Two Code注入浏览器执行端口。Coordinator以two-code:<taskId>和真实workspacePath提供固定scope；主副手共享此scope，分叉/其他任务使用不同scope。模型不能传sessionId、workspace、browserId/generation或认领用户其他会话的标签页。Main仍唯一持有标签页及浏览器状态，Two Code不创建浏览器状态副本；每次命令使用现有requestId与backend generation验证。

```text
Step原生browser / Claude MCP browser
  → schema与权限裁决 → Coordinator当前运行校验
  → 同一Host浏览器执行桥 → Main内置WebContentsView
  → 原生结构化状态/DOM/像素 → 主副手工具回执与前端浏览器标签
```

只在Host确有浏览器执行器时公布工具，缺失明确不可用，不自动换外部浏览器。公开navigate/back/forward/reload/snapshot/click/fill/type/press/scroll/hover/select/check/screenshot/getState/newTab/list/close；沿用共享BrowserCommand schema，拒绝内部生命周期、跨会话认领及未知指令。输入用JSON request字符串，描述给出准确示例。request命名是语义边界：实测Step会将command字段误当shell语句并另弹命令审批，浏览器JSON不得走shell解析。只读snapshot/getState/list/screenshot可直接读；其他动作按现有模式进行权限裁决，plan拒绝变更，edit/build确认，yolo允许；取消之后不再发新命令，也不把迟到结果记为当前执行成功，已送到Main的动作不宣称撤销。

截图通过原生image内容块返回模型，文本只附真实元数据，不把base64塞进回执文本。主副手不得把文字描述当像素验收。ZCode继续使用自身原生browser路径，不增加重复工具。

真实回归发现Main的直接fill分支未实现（返回capability_unsupported），而原生locator.fill已支持完整输入语义。直接fill必须从当前快照ref持有的真实、仍连接DOM的元素生成XPath，转交同一view的既有locator.fill；不复制输入实现，不用猜测selector或全局键鼠，失效ref返回ref_not_found。填充空字符串和替换已有内容沿用原生实现。此修复同时补齐原生内置浏览器协议，不依赖某一个模型临时改用click/type。

后续实测发现原生locator.fill空串返回成功但不清空：injected.fill选中了原文本，虚拟粘贴将空字符串视为无输入。后台guest发送CDP Delete同样可能静默无效，最终在既有虚拟输入实现里区分“空粘贴”和“替换为空”：焦点token校验通过后，用与正常填充相同的原生value setter清空并发出input事件；富文本沿用已选择的范围删除。不碰系统键鼠或剪贴板，replace:false的空串仍是无操作。

验收使用离屏不可聚焦的Two Code完整包和本地测试网页：主手打开、读DOM后派副手填表点击并看图；主手同tab复查，下一轮接着改状态；检查WebContents确为Electron内置页、页面服务端记录与模型报告一致、原生会话连续、请求scope隔离。测试模拟失败、拒绝、取消和缺失执行器；只清理本轮独立QA会话与页面。

## 2026-10-11 实测结果

最终完整包0.8.22在`embedded-browser-1791726126786`完成两轮，报告保存到`D:/Apps/TwoCode/reports/embedded-browser-1791726126786`。实际页为Electron `webview`（id=3），两轮相同；主手Step Plan、副手Claude DeepSeek，原生角色session均不变。

- 第一轮79.1秒，第二轮55.0秒。页面服务端输入账本为`["", "第一轮4826", "", "续接7823"]`，保存账本为`["第一轮4826", "续接7823"]`。
- 每轮副手恰好一次保存点击，主手零点击。第二轮主手原生browser请求仅snapshot/snapshot/screenshot，没有重新导航；任务始终只有一个对应WebView。
- 三次成功截图均在原生工具回执中含image像素，主副手识别蓝色画布数字6372；24次浏览器执行成功，另有一次开场门禁拒绝的尝试，尚未执行。最终没有浏览器执行错误、截图准备超时或页面异常。
- 页面真实输入事件和原生角色回执分别校验，不能因为工具返回ok或模型最终回答完成就判通过。早期`embedded-browser-1791725362610`原始脚本曾错误给出passed，但人工核对发现空值未清除，已由adjudication.json明确判失败。
- 早期测试另发现原生fill缺失、command参数被当shell审批、后台空值填充无效，均已修复。离屏截图准备曾偶发超时，最终三张截图未复现；尚未覆盖多标签并发截图或极端窗口遮挡条件，不宣称已消除所有截图边界问题。

验证：94项Two Code及填充回归通过；仓库常规typecheck、lint（0错误/70条原有警告）、架构检查通过。额外执行desktop Main全量类型检查有87条诊断，同轮修复前后错误列表完全一致，未计作通过。本次修改文件无新增类型诊断；该额外检查产生的无关编译文件已撤销/删除。

本轮试验任务与原生会话按独立QA目录所有权清理，仅保留精简报告和必要截图。实际覆盖本地网页的打开、DOM、清空/填值/点击、视觉及两轮交接；未验证任意外网、登录态网站或所有浏览器工具。
