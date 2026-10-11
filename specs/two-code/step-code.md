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
