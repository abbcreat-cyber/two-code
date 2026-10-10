# Two Code 本地交付验收 · 2026-10-10

源码：`D:/Projects/two-code`，分支 `two-code/main`。基于 ZCode 3.14.3 / `29628c9`；纯净副本 `D:/Projects/zcode-upstream` 保持干净。参考 Paseo 的 provider adapter 与持久会话边界，未改动其安装。

桌面入口为 **Two Code**。独立程序：`D:/Apps/TwoCode/releases/0.1.0/win-unpacked/Two Code.exe`；业务数据在 `D:/Apps/TwoCode/data`，Electron 状态在 `D:/Apps/TwoCode/state/electron`。上游自动更新关闭，deep link 为 `two-code`。保留上游许可证。

首次启动直接进入本地双角色工作台，不要求连接 ZCode 账号，不弹职业问卷。原生聊天和自愿账号/API配置入口保留。临时主手 Claude Code、副手 Pi，两边使用本机腾讯 DeepSeek 网关。兼容模型 ID 为 `claude-sonnet-4-8`；界面另外显示配置标签“腾讯 DeepSeek”。这只是本机偏好，模型和脚手架可独立更改。

| 验收项                       | 结果与证据                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude → Pi / Pi → Claude    | 两方向真实派工、写入 `impl.mjs`、运行断言、主手核对通过；`D:/Apps/TwoCode/qa/first-dual/results.json`                                                         |
| 两方向恢复上下文             | 原生会话ID不变，副手不使用工具即可复述前次结果；`first-dual/followup.json`                                                                                    |
| 安装包空白启动与真实界面操作 | 无账号门槛；批准Write、核对文件、派工、刷新后续接、切换新任务组合均通过；`D:/Apps/TwoCode/qa/desktop-1791624371297/ui-observation.json` 及同目录截图/任务文件 |
| 实际安装身份                 | 默认名字Two Code、独立数据路径、窗口标题正确；`D:/Apps/TwoCode/qa/installed-identity.json`。验收期间官方ZCode进程保持运行                                     |
| 真实停止                     | Claude/Pi运行延迟写文件脚本，停止后无延迟产物；`D:/Apps/TwoCode/qa/cancel-1791623212248/results.json`                                                         |
| 原生ZCode保留                | V4创建、发送及同一会话恢复均真实通过；`D:/Apps/TwoCode/qa/native-1791623861906/result.json`、`followup.json`                                                  |
| 自动化回归                   | 8项通过：持久副手、重复请求、取消与迟到结果、保存失败、权限取消、重启恢复、多Host租约、并发偏好保存                                                           |
| 工程检查                     | typecheck通过；architecture 0违规；lint 71条既有警告、0错误；改动文件已格式化                                                                                 |

本轮修复：首次登录门槛；bootstrap设置误读官方目录；Windows并发配置写入；Claude停止后工具子进程残留；原生ZCode混用两代创建协议；打包漏掉外置依赖。安装包再次实际执行任务后验收，不以构建成功代替启动成功。

范围边界：本轮真实重点为Windows本地运行。Pi沿用原生工具权限行为，工作目录不等于安全沙箱；运行中更换组合需新任务。当前不支持对忙碌副手静默追加任务。macOS/Linux、移动端、远程多Host和ZCode参与双角色组合未做完整真实验收；原生账号OAuth和上游云功能也未作为本轮验收目标。主手收到报告不等于产物正确，仍需核对任务的独立验收条件。

复跑入口：`scripts/two-code-smoke.ts`、`two-code-followup.ts`、`two-code-cancel-check.ts`、`two-code-native-check.ts`、`two-code-ui-check.mjs`、`two-code-install-check.mjs`。测试仅操作自建目录，后台窗口不接受焦点；不会动用户鼠标。模型凭据从本机配置读取，不进入Git。
