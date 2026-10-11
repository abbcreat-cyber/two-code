# GLM通过Claude Code接入与协作验收

使用TwoCodeConnections既有独立连接功能，在Claude Code底座增加智谱官方Anthropic兼容端点及glm-5.3、glm-5.3-flash两个独立模型。保留本机DeepSeek连接及已有组合。密钥仅由本机私有连接文件持有，不进入源码、提交、报告或页面可见状态。此次为配置接入，除实测发现缺陷外不新增执行通路。

组合为Step Code的step-plan/step-5-preview主手（medium）和Claude Code的glm-5.3副手（max）。通过既有档位能力、配置冻结和SDK effort参数执行，不以名称代替真实模型。两模型先分别取得官方接口响应，随后完整包离屏UI检查菜单与指定组合，真实主副手完成表单、历史、重绘及小代码任务。独立QA仅导入本次连接，权限与会话隔离沿用现有验收器，结束后清理所有所属临时任务及原生会话。

验证来源必须区分：接口探测证明认证和模型响应；真实Claude原生会话证明所用模型、工具调用和续接；max配置还需核查原生启动参数或请求级证据，不声称能观测厂商内部推理量。正式默认组合通过JsonPreferences保存，保留已有组合且遵守10套上限。

## 2026-10-11 验收

连接`claude:bigmodel-coding-plan`已通过既有配置服务保存到本机，两个独立ID分别为`glm-5.3`与`glm-5.3-flash`，使用`https://open.bigmodel.cn/api/anthropic`。两项接口探测均取得有效响应。新增默认组合`Step 5 + GLM max`，主手订阅medium、副手GLM-5.3 max；已有DeepSeek组合保留，当前共2套。产品版本仍为0.8.24，此次不修改运行时。

实际完整包报告：`D:/Apps/TwoCode/reports/embedded-browser-1791729842967`。菜单可分别选择两个GLM模型。三轮GLM-5.3 max浏览器协作114.6、104.3、109.4秒，服务端账本验证选择/勾选幂等/保存、历史URL回执及重绘旧ref拒绝和新ref续接。代码任务79.0秒、副手同会话续改47.0秒，独立执行验证非法记录过滤、trim、合并数量、字符串排序、__proto__键、输入不变及totalQty回归。Flash委派计算16.4秒，原生响应为glm-5.3-flash；代码原生响应为glm-5.3。共3个临时任务、6轮模型任务及菜单检查，页面异常0，全部所属QA目录与原生会话已清理。

脱敏进程证据`D:/Apps/TwoCode/reports/glm-claude-launch.json`确认Claude原生启动参数`--model glm-5.3 --effort max`。不把启动参数解释为可观测的厂商内部推理量。本轮一次select误用selector被schema拒绝后改为ref，实际动作只执行一次，未修改协议去接受错误字段；未发现新增适配/协作故障。仅覆盖上述本机测试页与小代码任务，不代表所有网站、视觉或长任务均验收。

常规typecheck、lint（原有70警告/零错误）、架构检查通过。私有凭据配置不入Git；本地仅提交可复用验收脚本和说明。正式窗口重启可见，继续使用0.8.24相同可执行文件。
