# Two Code

唯一所有者是 TwoCodeCoordinator。它接收UI命令，管理角色归属、请求幂等、权限、事件和持久状态。原生框架保管模型上下文，Adapter必须以原生结算而非ACK确认完成。

调用方经contract访问catalog/list/create/read/submit/cancel/respond及onDidChange。运行中不接受第二条普通输入；取消后显式续接保留角色会话。重复requestId不重复执行。副手能力只注入主手，不允许跨任务派工。读者不得把completed当作品质验收。

UI重开先读快照再消费单调序号变化。Host重启将未完成任务标为可恢复错误，禁止自动重跑。权限等待随取消结束；晚到结果不得覆盖取消。持久化失败必须显式报错。

技术端口和验收见specs/two-code/multi-harness.md。

configure({ taskId, preferences })在空闲时修改本任务的主副手模型、模式和单/双角色开关；与submit共用执行租约，同脚手架保留sessionId。configurePreferences只修改新任务默认值。旧快照模式默认为build，usage默认为空，不能估算旧token。

EngineRun携带本轮mode和usage回执入口。Claude的工具前置钩子、Pi的tool_call扩展统一经过任务权限裁决；ZCode通过原生sendText的mode/planEnabled提交。按角色运行编号替换累计回执，避免分块与最终结算重复计费。UI只投影已采集用量，不把主副手contextWindow相加。

任务以two-code:<uuid>接入原生任务索引。Coordinator拥有执行事实，原生索引拥有重命名、置顶、分组、归档等组织元数据；展示投影保留这些元数据。前端复用原生SessionPane入口、ConversationTimeline、ChatPromptEditor、ModelConfigSelect和PermissionDialog，不维护第二份可选任务列表。后台投影在服务释放前收尾，查询期间收到的新事件优先于迟到快照。
