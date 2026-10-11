# Step Code 底座及原生 PowerShell

目标产品为 Two Code（桌面快捷方式 Two Code.lnk），在现有 ZCode、Claude Code、Pi 旁增加 Step Code。不是接入 DeepSeek Harness，也不修改独立 Step Code/StepFun 桌面产品。

## 所有者及身份

- 沿用 TwoCodeCoordinator，原生 Step RPC 只提供执行、历史和结算；不另建双角色状态机。
- HarnessId 新增 step-code。主、副手都能选择，并复用原权限、取消、会话恢复与配置冻结路径。
- 本机 `.stepcode/models.json` 只读导入 step-api 与 step-plan，均请求 step-5-preview。
- API 显示为 **Step-5 API**，订阅显示为 **Step-5 订阅**。身份包括 harness/provider/model，禁止仅按 model 去重或互相回退。
- TwoCodeConnections 持有可编辑配置；每次准入冻结对应渠道密钥/地址，写入角色私有配置目录，不修改 Step 本机原配置。

```mermaid
flowchart LR
  UI[Two Code 模型设置] --> C[TwoCodeConnections]
  C --> Q[TwoCodeCoordinator]
  Q --> A[Step Code RPC Adapter]
  A --> E[本机 step.exe]
  E --> P[step-api / step-plan]
```

## 执行和工具

复用 Pi 家族 JSONL RPC 的请求、事件、取消和 usage 解析；启动命令、配置目录、扩展依赖按底座独立装配。Step 使用本机 step.exe，不通过 Pi 执行 Step API。必须等 agent_settled，不能把 prompt ACK 当完成。

Windows 有原生 powershell 的底座直接启用/保留该工具，command 填原始 PowerShell，不包 Bash。Step 原生工具接受 timeout 秒。Pi/Claude/ZCode 逐个核实；不存在的原生能力不得伪称存在。所有工具仍经过 Two Code 的 permissionDecision，plan 不允许写入或命令，build 请求许可，yolo 保留既有授权语义。Step 原生递归委派工具禁用，由 Two Code 持久副手统一调度。

## 验收

设置页第四张底座卡；主、副手选择器显示两个不同名称/身份；API/订阅编辑与冻结互不覆盖。真实 Step Plan 小任务走 step.exe 并复用原 session，至少一次副手直接使用原生 powershell；不消费 API 渠道完成正向模型请求。模拟覆盖两路配置及启动路径，保留已有三底座回归。后台打包与 UI 验收，不操作鼠标。

## Step 订阅主手与 Claude DeepSeek 副手专项验收

固定主手 step-code / step-plan / step-5-preview；副手从 Claude Code 目录选择核实为 DeepSeek 的模型，保存请求 ID 与目录真实名称，不替换成其他底座。使用独立 QA 数据和小型工作区，禁止鼠标操作。每项最长 180 秒，退出时取消本脚本持有的任务。

- 并行实现布尔解析和先失败后修正输入的小任务；以不可变测试文件哈希、真实执行次数和文件结果验收。
- 后续仅凭记忆回答；必须沿用副手 session，且不新增执行/文件工具。
- 中文、空格、方括号、美元符号路径下的 JSON 数据处理：核对原生 PowerShell 调用、逐字内容、两任务会话互不相同。
- 副手等待权限时取消：Coordinator 收回权限、迟到批准拒绝、命令未执行；显式续接保留角色会话并能完成新小任务。
- 非阻塞派工必须读取副手报告；同 requestId 重发不得重复执行。

状态和取消仍由 Coordinator 唯一持有：提交 → 原生派工 → 权限等待 → 取消收回 → 显式续接。测试脚本只经公共服务调用观察，不创建产品状态副本。证据文件写入串行化，避免并发测试自身覆盖结果。

### 原生扩展 UI 协议边界

真实安装包验收发现 Step 的 `setStatus` 被当成权限弹窗。Pi/Step 共用适配器必须按 method 分流：`setStatus/setWidget/setTitle/set_editor_text` 是原生终端展示通知，不创建权限、不回复布尔值、不改变 Two Code 的标题或输入草稿；`notify` 作为普通通知文本展示；只有 `confirm` 进入 Coordinator 权限路径。`select/input/editor` 需要字符串响应，当前尚未提供对应交互，必须取消原生请求并明确报出不支持，不能以“允许本次”伪造答案。未知方法同样显式失败，不猜测授权语义。

### 分工与权限卡

真实写文件小任务中，副手为额外校验申请 PowerShell，超出原请求指定的工具范围。角色指令明确原始用户限制优先于主手补充要求；主手明确谁验收，副手不得以额外取证为由添加命令、重复测试或自行扩大范围。此为模型行为指导，不替代 Coordinator 权限裁决，不能承诺模型绝不偏离。

权限卡标题明确显示“需要权限 · 主手/副手”，工具参数继续由原生工具卡展示，避免仅展示原始 JSON 而看不出申请角色。角色标签独立于模型提供的 description，不能被 PowerShell 参数说明覆盖。沿用 PermissionDialog 和既有版式，不另建批准入口。真实 UI 验收要求 Write 批准后无需额外 shell 即完成，由主手读取核对；后续显式 PowerShell 任务仍正常弹出批准。

Coordinator 将真实共享工作目录注入两角色指令，避免主手因副手返回绝对路径而重新猜目录。Pi/Step Windows 指令同时说明文件专用工具、原生 PowerShell 和对应语法；启用工具还需要匹配模型看到的运行环境，不通过 run_command 拼接 Unix 命令来做文件读取。

验收边界：早期题面“主手只读核对”未明确禁止主手用只读命令测量末尾换行，脚本却拒绝所有额外命令，该次不能单凭超时认定底座失效。最终题面明确主手仅 read_file、副手仅 Write，禁止执行工具和额外字节检查；原题的模型行为偏差保留记录，不声称自然语言限制具有硬隔离效果。

## 0.8.0 验收记录（2026-10-11）

- 本机 `C:/Users/12647/.stepcode/bin/step.exe` 作为实际 Step Code 执行入口；没有依赖 DeepSeek Harness 或另一个桌面软件的执行桥。
- Two Code 真实主副手均为 `step-plan/step-5-preview`，副手调用原生 `powershell`，输出 `TWO_CODE_NATIVE_PS=8` 和完整的 `中文 $ & 空格`。下一轮仅凭原生历史回忆标记，同一副手 session 保持不变。
- 在同一原生会话上切至 `step-api/step-5-preview`，通过 `get_state` 确认真实模型身份，在 prompt 发送之前主动终止测试。因此 API 渠道仅做配置及原生恢复路由验证，未进行计费推理验收。
- Claude Code / Pi 的实际工具目录都包含原生 PowerShell。另一个 Two Code 双角色任务中，Claude 主手调用 `PowerShell` 得到5，Pi 副手调用 `powershell` 得到9，全程无 Bash 工具调用。
- Pi 与 Step 的原生 PowerShell 原先不一定在活动工具集，现仅在已有命令能力且原生工具确实存在时启用，不自造 PowerShell 执行器。Claude 保留原生工具，并添加 Windows 使用指导。
- ZCode 当前源码工具入口是 `Bash`，Windows shell resolver 提供 Git Bash/CMD，未发现独立原生 PowerShell 入口。本轮保持其原生链路，不把包装命令改名冒充原生能力。
- 增补权限通道断开时 fail-closed；Step/Pi 启动模型前验证工具扩展标记存在。原计划、编辑、确认和完全访问模式仍由 TwoCodeCoordinator 统一裁决。
- 安装包 UI 首轮发现草稿校验遗漏 step-code，刷新后回到默认配置；补齐并回归后，最终安装包四张底座卡、两个模型名称/值、主副手选择和刷新均通过，renderer 无异常。截图已目视检查。
- 55项 Two Code 针对性回归通过，typecheck 与架构检查通过，lint 为71项既有warning、0 error。构建和最终打包成功；首次打包因临时文件占用失败，重试后完成，失败包未部署。

证据目录：

- `D:/Apps/TwoCode/qa/step-1791682763263`：真实 Step 任务、续接、API离线路由。
- `D:/Apps/TwoCode/qa/shell-inventory-1791683052279`：原生工具目录。
- `D:/Apps/TwoCode/qa/shell-live-1791683165882`：Claude/Pi原生 PowerShell 任务。
- `D:/Apps/TwoCode/qa/step-ui-1791684001006`：最终安装包界面、选择和刷新。

发布目录为 `D:/Apps/TwoCode/releases/0.8.0/win-unpacked`。桌面 Two Code.lnk 已指向该目录；旧快捷方式备份在 `D:/Apps/TwoCode/backups/before-0.8.0`。现有运行窗口没有被强制退出，需重新打开应用加载新版本。没有修改各底座的原生账号配置，测试通过独立 QA 数据目录执行。

## 0.8.1 主副手三层联动验收（2026-10-11）

固定 Step Plan 主手与 Claude Code 的 DeepSeek 副手（请求 ID claude-sonnet-4-8，目录实际模型 deepseek-v4.1-flash，high）。没有使用 Step API 渠道，也没有切换到 DeepSeek Harness。

修复与优化：

- 修复 Pi/Step 状态通知误进权限队列，实测旧包一启动就弹出 setStatus，新包只有真实 Write/PowerShell 工具申请。
- 权限标题固定显示申请角色；写入参数不再以整段 JSON 重复显示，保留原生文件/命令预览。
- 注入实际共享目录、Windows 原生工具说明和主副手验收分工。副手已在明确限制的题面下做到 Write 一次、主手 read_file 核对；提示词改善行为，不视作安全边界。

真实证据：

- `D:/Apps/TwoCode/qa/step-claude-1791684478804`：布尔解析一次通过；错误输入首次失败、主手改为4、原副手第二次成功；两项记忆续问均复用副手且无额外工具。
- `D:/Apps/TwoCode/qa/step-claude-edges-1791684733778`：首轮中文路径、非阻塞取报告、提交去重、取消及续接。该轮 cancelMs 包含续接耗时，不能作为取消性能数据。
- `D:/Apps/TwoCode/qa/step-claude-edges-1791685640178`：最终代码复测中文/空格/方括号/美元路径、原生 PowerShell、去重、任务会话隔离、取消等待和迟到批准失效；取消返回耗时189ms，两角色原会话续接成功。
- `D:/Apps/TwoCode/qa/step-claude-ui-1791684873762`：旧包 setStatus 错误权限的原始复现。
- `D:/Apps/TwoCode/qa/step-claude-ui-1791685152076`、`1791685428213`、`1791685618170`：原题额外验证调用、提示优化及题面歧义记录。未记为完整通过。
- `D:/Apps/TwoCode/qa/step-claude-ui-1791685704119`：源码构建的界面发起、权限刷新、文件落地、记忆续接、真实进程树取消、原会话恢复。最后脚本错误按第三张可见卡定位，但成功轮次已折叠；已修正为停止状态定位。
- `D:/Apps/TwoCode/qa/step-claude-ui-1791685780005`：最终0.8.1安装包重复完成上述真实操作，首轮结果保留同一定位错误。`replay-results.json` 在重新打开原任务后以正确定位通过，`replayed.png` 目视确认历史停止和最新恢复成功；renderer errors为空，未重新调用模型来覆盖旧证据。

58项针对性测试、typecheck和架构检查通过；lint为71项既有warning、0 error。最终构建/打包通过。前一候选包出现一次Windows临时文件占用EPERM，重试成功，失败候选未切换快捷方式。最终安装目录为 `D:/Apps/TwoCode/releases/0.8.1/win-unpacked`，快捷方式备份至 `D:/Apps/TwoCode/backups/before-0.8.1`。保留用户原有运行窗口，新版本重开后生效。

未覆盖/未实现：原生select/input/editor交互尚未映射到Two Code问答UI，目前取消并明确报告不支持；自然语言工具限制仍依赖模型理解，本轮不宣称所有任务都不会追加验证。测试脚本只操作隔离的不可聚焦后台窗口，不使用物理鼠标。
