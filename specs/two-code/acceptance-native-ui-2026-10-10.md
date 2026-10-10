# Two Code 原生前端融合验收

本次纠正第一版的界面分离：删除独立双角色页面、第二份任务列表和常驻配置栏。入口回到原生「新建任务」，任务进入ZCode原生tasks-index、侧栏、分组/置顶/归档体系。

直接复用 `ConversationTimeline`、`ConversationHeader`、`ChatPromptEditor`（Lexical）、`ModelConfigSelect`、`PermissionDialog` 和原生空态组件。新增代码只负责脚手架配置、事件到原生消息行的展示转换，以及执行服务连接。主副手配置放在输入器下方；详细配置按需打开原生弹层。

执行状态仍由TwoCodeCoordinator拥有；原生任务索引拥有标题覆盖、置顶和归档等组织元数据。历史JSON不改写，启动时幂等生成索引。初始查询不能覆盖查询期间收到的流式/权限更新；原生标题缓存消费相同Controller元数据。

## 已实际验证

- 旧任务进入原生侧栏；选中后显示原生Markdown、复制按钮和时间线。
- 原生重命名、置顶、取消置顶、归档；刷新后保留名称和组织状态。
- 模型下拉里的「管理模型」可保存配置。
- 原生输入器提交真实任务 → 原生权限卡批准Write → 实际文件 `integration-proof.txt` 内容核对 → Claude主手/Pi副手派工 → 主手回复Markdown。
- 刷新后继续，同一对原生会话ID不变，主手记住暗号、副手记住上轮计算结果。
- 通过界面更改为Pi主手/Claude副手，真实反向派工得到156。
- 原生页面停止按钮令任务进入cancelled。
- 已安装版本的用户旧任务「你好」成功在新列表中打开；原任务JSON SHA-256与备份一致。

完整安装包实测证据：`D:/Apps/TwoCode/qa/integration-1791628143753/`（observation.json、截图及任务JSON）。用户旧任务截图：`D:/Apps/TwoCode/qa/installed-native-history.png`。自动化脚本：`scripts/two-code-integration-check.mjs`、`scripts/two-code-install-check.mjs`。

工程检查：typecheck通过；10项相关测试通过；architecture 0违规；lint 71条既有警告、0错误。

桌面快捷方式更新到 `D:/Apps/TwoCode/releases/0.2.0/win-unpacked/Two Code.exe`。用户数据备份：`D:/Apps/TwoCode/backups/native-ui-20261010-183117`。后台QA不再注册系统协议或Explorer菜单；正式菜单使用独立TwoCode键，避免覆盖其它分支。

## 范围

本轮验证Windows本地。双角色发送面为文本；附件/技能目录、编辑重跑、分叉、云分享和远程双角色尚未接通完整适配，不伪造这些能力；完整ZCode原生模式仍保留在模式菜单。当前任务固定脚手架组合，新任务可选择其他组合。模型没有硬绑定，腾讯DeepSeek只是本机临时默认配置。
