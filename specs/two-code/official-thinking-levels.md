# 官方思考档位固定表

核对日期：2026-10-10。此表和代码一并提交本地 Git，启动时不联网查询；以后厂商变更时显式更新，不将某个脚手架的通用菜单当作模型能力。

| 模型                           | 官方有效控制值                           | 界面选项                          | 来源                                                                                                                                                                          |
| ------------------------------ | ---------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
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
- 代码唯一事实源：`packages/services/src/two-code/domain/thinking.ts`；前端选项与运行准入共同读取。不同接入服务能否完整透传仍取决于该服务，本轮按用户要求不做实测。

本轮仅进行静态检查和构建，没有运行模型调用、单元测试或UI验收。
