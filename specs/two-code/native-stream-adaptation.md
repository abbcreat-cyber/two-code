# 原生行增量接入

## 目标与所有者

Two Code 原先把完整 TaskEvent 历史广播到 Renderer，再逐次 projectTwoCodeRows。这只复用了原版组件，没有复用原生增量数据更新方式。改为 Host 适配器将四脚手架事实翻译为标准 ConversationSnapshot / ConversationDelta；Renderer 直接调用原版 applyConversationDeltas，未变化的行保持对象身份。原版思考组件、动画、Timeline、Markdown 不改。

`适配器事件 → Coordinator 原始事实 → Host 行投影 → row.delta / row.upserted → 原版 reducer → 原版 Timeline`

Coordinator 继续拥有执行、取消、审批、usage 和原始事件持久化。行投影只持派生状态。兼容旧 onDidChange，但新的 UI 与任务索引使用轻量 view 通道，未订阅旧通道时不复制历史。

## 数据约束

- 初次/重连以完整标准快照建立基线；之后只传变化行/文本追加，不反复发送原始思考历史。
- 视图有进程 epoch 与单调 revision，Renderer 仅应用连续 revision；丢帧、epoch 变更先重取快照，不重发用户命令。过期帧/回包不覆盖新状态。
- task 是控制面投影，events 仅保留用户输入、工具开始及状态/失败等统计和历史回填所需事实；原始完整事件仍通过 read/list 和磁盘保存，不改写。
- 思考/正文文本追加使用原版 row.delta；结构/终态用 row.upserted。顺序改变时回到标准快照，不能猜测补丁。
- 命令 ACK 不携带 Renderer 自造状态；命令完成后读取权威 view，和流式更新按 revision 去重。
- 宿主生命周期结束释放视图缓存和通知；已暂停原任务不自动续跑。

## 验收

既有投影回归保持通过；新旧投影显示内容等价。持续思考只更新尾行，旧行对象不变；审批/错误/取消/副手交接边界不丢失。断档重取与迟到快照测试。原记录长流测通信量，GPU 开启的真实 max 思考任务测 CPU、输入/滚动探测、内存。交付后自动正常退出旧实例并启动新包，核验实际进程版本和窗口。
