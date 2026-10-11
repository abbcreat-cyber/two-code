# 协作控制与回执一致性

本轮按用户最新要求只检查配合链路：派工、消息送达、审批、取消、会话续接、幂等和状态一致性。模型答案质量、思考时长不作为修复目标，不为测试结果再改角色提示词。

真实Step Plan主手/Claude DeepSeek high副手的拒绝测试：脚本未执行、标记文件不存在，但两底座的verification均写failed；Claude还未发notExecuted。准入前拒绝、实际执行失败、已开始后中断必须区分。

Coordinator继续拥有唯一事件日志和权限裁决。Claude适配器以PreToolUse/canUseTool的明确拒绝和原生tool_use_id/toolUseID记录未执行，而不是从模型自述/任意错误文字推断；两个入口按同一ID去重。Step/Pi沿用现有执行前门禁回执识别。verification新增status=not-executed：不带进程退出码或stdout摘要；原生tool_end及UI使用同一拒绝事实。SDK明确interrupted仅表示中断，不证明未执行或已回滚。

```text
权限请求 → Coordinator裁决 → 适配器记录同一调用ID的准入拒绝
                                 ↓
                  tool notExecuted + verification not-executed
                                 ↓
                 主手交接回执 / 原工具详情 / 历史快照
```

拒绝消息可能先于SDK的助手消息或参数流被消费，后来的tool_use/tool_input/tool_end不得把未执行改成运行或成功，也不得产生重复工具行。只在有明确拒绝事实时使用not-executed，普通错误及中断保持各自状态。旧快照不根据文字追溯改写。

真实改向中，Claude将已开始工具的中断写为SDK结构字段tool_use_result="User rejected tool use"，没有interrupted布尔值。适配器发interrupt前，由本轮ClaudeReceiptTracker快照记录未结束调用ID；仅该集合中的调用收到此原生结构标记且is_error时记interrupted。普通输出文字、其他错误、已结束调用和后续新调用不受影响；明确准入拒绝仍优先记not-executed。Tracker随run创建与清理，不跨代继承。

```text
update → 检查run generation → tracker快照未结束调用ID → native interrupt
                                     ↓
           同ID的原生拒绝结构回执 → interrupted → 同一日志投影/交接报告
```

实测场景：拒绝副手命令、拒绝主手命令、待审批时重复submit、取消待审批任务、拒绝迟到批准、使用原副手会话续接、执行中补充改向。使用隔离目录中的微型标记脚本独立检查副作用；实测模型固定，异常时序由回归夹具补充。前端仍沿用原工具详情，桌面流式与快照恢复使用同一日志投影。

2026-10-11验收（Step Plan / step-5-preview主手，Claude / DeepSeek V4.1 Flash high副手）：

- `D:/Apps/TwoCode/qa/control-candidate-1791706394532`：主手、副手的执行前拒绝均回报not-executed，标记文件不存在。
- `D:/Apps/TwoCode/qa/control-resume-confirm-1791706572065`：重复submit不重复派发；待审批取消后迟到批准被拒；原请求ID保持取消；新请求恢复同一副手会话且不执行旧命令。
- `D:/Apps/TwoCode/qa/fusion-live-1791706973751`：实际开始一次的等待命令被改向停止，原生回执interrupted；同一副手生成updated.txt；过原定45秒期限后仍无late.txt。updateMs含等待迟到副作用的观察期，不是速度指标。
- `D:/Apps/TwoCode/qa/control-failure-console.log`：真实退出码7保留failed，没有误判为拒绝或中断。
- 106项回归通过，typecheck通过，架构违规0；lint错误0、已有警告70。
- 0.8.12打包界面验收：`D:/Apps/TwoCode/qa/receipts-ui-1791707078744`，成功、失败、副手拒绝、主手拒绝、执行中断五种快照均通过；无页面异常。截图确认状态位于原工具详情，主手拒绝只有一条工具行。

测试边界：一次续接由模型选择了工作区外路径，框架正确拒绝；一次改向前模型增加了命令包装，精确准入规则正确拒绝、未进入目标场景。两次证据均保留，未修改产品提示词去优化模型输出；确认测试给定确切路径及原始命令后覆盖对应配合机制。
