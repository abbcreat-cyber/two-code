# Two Code 0.3.0 验收

本轮修复：空闲任务可独立更换主手/副手模型并续用原生上下文；接通四种权限模式；复制会话统计与Token用量组件到原生输入框下方。

## 复制来源

桌面“阶跃星辰.lnk” → `D:/Apps/StepCode/launch-real-desktop.vbs` → `launch-real-desktop.mjs` → `launch-lean-desktop.mjs` → `releases/20261010-v1.0.8`。

该版本构建脚本指向 `D:/Projects/stepfun-harness-public`。从其中 `packages/ui/src/v4/composer/SessionStatisticsBar.tsx` 原样复制两项显示、数字格式、弹层及位置类名。只适配目标仓库已有的ChatContextUsage参数（selectedProvider取glm，目标旧组件不支持showPercentage）。统计类型沿用源字段；Two Code适配器负责填入真实数据。

源文件复制前后SHA256均为 `C32D8C5B42142D61C07F0E16023877D1C3AAA61DF3F598BDCDC9A4CA2107C7F5`。本轮未对源项目、其启动器和快捷方式执行写入。

## 结果与证据

- 15项回归测试通过：主副手持久会话、空闲切换、busy拒绝、保存失败回退、取消审批、跨Host执行租约、回执去重、统计汇总、权限目录边界。
- `pnpm typecheck`通过；`pnpm lint`为71个既有警告、0错误；架构检查0违规。
- `D:/Apps/TwoCode/qa/controls-live-1791630026911/results.json`：Claude Code、Pi各4次真实读写测试。build请求审批且拒绝后无文件；edit、yolo生成精确MODE_OK；plan拦截写入。Claude切换到本机sonnet别名后原会话ID及暗号保留。全部沿用本机腾讯DeepSeek配置。
- `D:/Apps/TwoCode/qa/native-1791630249441/followup.json`：ZCode原生首轮、续接、自动编辑真实写入和两轮usage通过。补测发现独立模式命令需要CAS版本，已修为原生Submission随轮冻结mode/planEnabled/modelSelection。
- `D:/Apps/TwoCode/qa/integration-1791630535412/observation.json`：最终0.3.0安装包后台UI验收；旧任务模型按钮可用，模型/副手档位和权限模式保存，原生侧栏、重命名/置顶/归档、正反向派工、同会话续接、停止、刷新用量不重计均通过，页面错误0。
- 同目录`live.png`、`mode-menu.png`、`statistics-details.png`、`token-details.png`保留界面证据。token弹层总数与任务回执精确求和相等。
- `D:/Apps/TwoCode/qa/installed-identity.json`：实际用户数据下两条既有会话可打开，主副手模型按钮可用，Two Code身份、独立数据目录正确。测试窗位于屏幕外且不可聚焦，未操作物理鼠标键盘。

## 交付与边界

- 最终程序：`D:/Apps/TwoCode/releases/0.3.0-final/win-unpacked/Two Code.exe`，桌面Two Code快捷方式已更新。
- 旧版数据、Electron状态和快捷方式备份：`D:/Apps/TwoCode/backups/controls-20261010-1911`。既有两条任务JSON及全局模型偏好SHA256未变。
- 发布校验：`D:/Apps/TwoCode/qa/release-0.3-sha256.json`。
- 模型切换在空闲时生效；已建立原生会话的角色更换脚手架仍需新建任务，避免错用会话ID。
- 原本未采集的历史token不补估计；缺少原生耗时数据时显示“—”。统计从新增回执开始，主副手token合计，吞吐率按有计时回执计算。未把本机别名切换声称为不同模型后端对比。
