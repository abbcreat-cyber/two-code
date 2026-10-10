# Two Code 0.4.0：角色面板与原生思考链对接

## 交付

- 主手、副手各自打开紧凑设置面板：脚手架、模型搜索、提供方辨识、兼容信息、思考档位、独立高级配置。单/双角色、组合设置、设为新任务默认组合保留。
- Claude模型目录读取本机映射，Pi读取本机提供方模型；不会把别的脚手架模型当作当前脚手架可直接执行。连接认证仍沿用本机配置；ZCode模型与连接按钮进入原生设置页。没有新增跨脚手架API认证迁移系统。
- 对接原有ConversationTimeline、ReasoningRowView、已工作折叠和messageStreamShowReasoning设置；未重写这些组件。Claude、Pi、ZCode的真实思考增量进入持久化事件，再投影成原生reasoning行，主副手可区分。
- 修复副手长列表面板超出窗口，以及保存模型配置导致已工作耗时增长。

## 验收

- 18项相关回归通过；typecheck通过；lint为71个既有警告、0错误；架构检查0违规。
- `D:/Apps/TwoCode/qa/reasoning-1791632382077`：两次真实双向派工，Claude/Pi各自均有非空思考回执，重读JSON后原生行投影一致。
- `D:/Apps/TwoCode/qa/native-1791632567024`：ZCode原生model.streaming思考回执、原生续接和自动编辑通过。
- `D:/Apps/TwoCode/qa/integration-1791633127771`：最终安装包完整后台验收通过，页面错误0。独立角色面板、搜索、档位切换、默认组合、窗口边界、原生思考折叠展开、token弹层、旧任务组织操作、双向派工、重载保留会话与用量、停止均通过。
- Pi思考文本与本机原生JSONL逐字比较。上游仅返回text时，两侧均为空；没有用占位文字伪造思考。
- 截图：该目录的`lead-panel.png`、`sidekick-panel.png`、`native-reasoning.png`。所有GUI测试窗口位于屏幕外且不可聚焦，未操作物理鼠标键盘。

## 历史边界

检查现有三条问候会话对应Claude原始JSONL，均没有thinking块，因此不补造历史思考。新请求仅在上游实际返回思考时展示。已有任务、模型配置和原生sessionId保留。

最终程序位于 `D:/Apps/TwoCode/releases/0.4.0-final/win-unpacked/Two Code.exe`。旧版与数据备份位于 `D:/Apps/TwoCode/backups/role-panels-20261010`。
