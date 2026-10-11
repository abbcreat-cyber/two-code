# 模型思考档位固定表

2026-10-11补充Step-5（API和订阅）：使用本机Step Code原生`get_available_models`能力快照，`step/step-5-preview`明确提供low/medium/high，默认medium；off会被原生收敛成low，max会被收敛成high，不能显示成真实支持关闭/最高。证据：`D:/Apps/TwoCode/qa/thinking-discovery/levels.json`。这条证据来自已安装底座，不能冒充已核对的在线厂商文档。

Step-5档位表、API/订阅配置投影和运行前归一使用同一domain事实源。旧off/none/disabled/minimal迁到low，xhigh/max/ultra迁到high，空值medium。冻结连接必须带原生thinkingLevelMap。用本机回环请求验证两个渠道的low/medium/high参数，以及同一原生会话切档；真实推理只使用Step Plan小任务。

同时纠正模型切换仅凭显示名归一的问题：主副手和自定义编辑器应携带catalog，通过realModel/别名识别档位。缺省模型通过catalog默认身份识别。组合列表用归一后的实际档位匹配和显示，旧组合不会因迁移失去当前选中标记。

```text
原生能力快照 → domain档位表 → UI选项/选择归一 → 组合保存
                                  ↓
                         任务准入 → 冻结配置 → 原生会话 → 请求参数
```

核对日期：2026-10-10。此表和代码一并提交本地 Git，启动时不联网查询；以后厂商变更时显式更新，不将某个脚手架的通用菜单当作模型能力。

| 模型                           | 官方有效控制值                           | 界面选项                          | 来源                                                                                                                                                                          |
| ------------------------------ | ---------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step-5 API、Step-5 订阅        | low / medium / high                     | 低 / 中 / 高                     | 已安装Step Code 0.1.2原生RPC能力快照（2026-10-11），两渠道回环请求参数验证 |
| GPT-6 Astra                    | low / medium / high / xhigh / max        | 低 / 中 / 高 / 极高 / 最高        | [OpenAI 模型页](https://developers.openai.com/api/docs/models/gpt-6-astra)                                                                                                    |
| GPT-6.1 Sol                    | low / medium / high / xhigh / max        | 低 / 中 / 高 / 极高 / 最高        | [OpenAI 模型页](https://developers.openai.com/api/docs/models/gpt-6.1-sol)                                                                                                    |
| GPT-6 Sol                      | none / low / medium / high / xhigh / max | 关闭 / 低 / 中 / 高 / 极高 / 最高 | [OpenAI 模型页](https://developers.openai.com/api/docs/models/gpt-6-sol)                                                                                                      |
| GPT-6 Luna                     | none / low / medium / high / xhigh / max | 关闭 / 低 / 中 / 高 / 极高 / 最高 | [OpenAI 模型页](https://developers.openai.com/api/docs/models/gpt-6-luna)                                                                                                     |
| GLM-5.3、GLM-5.3-Flash         | low / high / max                         | 低 / 高 / 最高                    | [智谱官方仓库 Note](https://github.com/zai-org/GLM-5#note)                                                                                                                    |
| DeepSeek V4.1 Flash            | none（关闭）/ low / high / max           | 关闭 / 低 / 高 / 最高             | [DeepSeek API 思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)                                                                                                  |
| MiMo V2.6 Pro、MiMo V2.6 Flash | thinking.type: disabled / enabled        | 关闭 / 开启                       | [小米思考模式](https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/text-generation/deep-thinking)、[Responses 兼容说明](https://mimo.mi.com/docs/en-US/api/chat/responses) |

实现规则：

- 全部移除“默认”选项。保留合法的已有选择；空值使用显式初始值：GPT 系列中、GLM 最高、DeepSeek 高、MiMo 开启。GPT-6 Astra 的“中”是应用选择的初始档，不把它标成已核实的厂商缺省值。
- GPT-6 Astra/6.1 Sol 不支持 none 或 minimal；旧 none/minimal 迁到 low。DeepSeek 兼容值按官方映射收敛：minimal→low、medium/xhigh→high、ultra→max。GLM 非法值采用其官方 max 缺省规则。
- MiMo 接口接受若干兼容 effort 字符串，但非 none 值效果一致，因此不展示虚假的强弱档；旧非关闭值归并为开启。
- DeepSeek 开源权重的 1–100 连续控制与官方托管 API 是不同接口能力。本应用当前采用官方托管 API 的档位表，不混用自托管模板档位。
- 本机网关名称先通过真实上游模型名匹配，再用已明确的别名匹配。未知模型（例如尚未确认上游的 TRAE 探针）显示“未收录”，不臆造档位。
- Pi 内部使用 off 表示关闭；MiMo 开启由 high 承载，但仅发送 thinking 开关，不传强度参数。已知模型同时生成精确 thinkingLevelMap，避免 max 被 Pi 自动收敛为 high。授权、模型请求 ID 和原生会话不因显示变化而修改。
- 代码唯一事实源：`packages/services/src/two-code/domain/thinking.ts`；前端选项与运行准入共同读取。不同接入服务能否完整透传仍取决于该服务。

2026-10-10首次收录仅进行静态检查和构建，没有运行模型调用、单元测试或UI验收。

2026-10-11，0.8.18验收：两渠道原生请求及会话复用证据`D:/Apps/TwoCode/qa/step-thinking-wire-rlgVjW`，共6项high/low/medium请求均与选择一致。最终安装包界面与真实任务证据`D:/Apps/TwoCode/qa/combinations-ui-1791717001641`：菜单三档、自定义组合档位保存、单模型调用、Step Plan低档搭配Claude DeepSeek高档、同主手原生会话切高档并回忆前轮内容、组合上限及草稿保护均通过，页面异常0。123项回归通过；typecheck通过；架构违规0；lint错误0，原有警告70。API渠道只做本机回环参数验收，真实模型推理使用Step Plan订阅。
