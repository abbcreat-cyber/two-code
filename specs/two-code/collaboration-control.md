# 协作控制与回执一致性

常用协作第六组并行验证三个方向：两张同名但不同像素的图片经importImage/imageMessage附件通道交给两角色；完成首轮后应用另一套同底座组合继续编辑，思考档位更新而上下文不丢；同时运行两任务时只取消待审批任务，独立任务继续完成。每轮固定Step Plan/Claude DeepSeek，不以模型文风为目标；以附件身份、文件产物、原生session和任务状态验收，所有额外授权默认拒绝，仅测试自己创建的QA任务。

常用协作第四组：主副手独立读取同一图片；计划模式下写入请求被拒且不落盘，切至编辑后由原副手续接；同一副手依次处理两个不同文件，第二轮不得覆盖第一轮产物。以真实像素工具调用、实际文件副作用、拒绝事实、原生session和交接数量验收，不把模型措辞或审查结论质量当产品问题。隔离QA目录，Step Plan主手/Claude DeepSeek high副手，单轮最长150秒。

常用协作第三组：验证命令先失败→同一副手修复后成功→第三轮只回读已验证结果（不重跑），同时回归执行中连续补充、失败后续接和服务重开。保护验证脚本，以执行次数文件、退出码、分轮verification边界、原生session及实际产物判断配合正确性，不将失败验证本身误当协调器失败，不允许上轮成功替当前轮背书。文件与命令仅限隔离QA目录，单轮最长150秒。

实测原生Claude PowerShell失败回执以`Exit code 7`开头（无冒号），旧提取器只识别`Exit code: 7`或`EXITCODE=7`，造成正常命令退出码丢失。适配器增加原生空格格式，仍按完整行匹配，按第一个完整标记记录且只接受安全整数；不解析模型自述，不根据缺失值补0，也不根据stdout字符串改变原生成功/失败状态。后续交接仍按handoff边界隔离回执。首版夹具的FAIL_OLD/PASS_REPAIRED不属于受限摘要格式，已改为标准FAIL:/PASS:标记，未扩大产物摘要规则。

常用交接第二组：同一轮内两次顺序交接（首稿→主手读文件→同副手返工→主手验收）、非阻塞派工时主手读取独立规则文件再read_sidekick、待审批停止后续接，以及历史分叉隔离。验收关注报告与交接对应、工具结束先后关系、副手session复用、文件只改指定范围，不把模型措辞当适配错误。未完成非阻塞交接必须阻止任务被误标已完成。文件和模型运行均在隔离QA目录，各轮最长150秒，不使用鼠标。

2026-10-11常用任务回归：数据汇总、文档翻译、跨文件修改、命令warning回传；另测同任务关闭/恢复副手及缺文件后补充路径的连续交接。以实际工具执行、文件副作用、报告关联、原生session身份、最终状态为验收；不为改变模型写作或决策质量而修改角色提示词。命令计数按角色和原生completed/failed执行状态区分，not-executed拒绝回执不能算重复执行。输入和对照文件只在D盘隔离QA目录创建，真实模型固定Step Plan/Claude DeepSeek high，每轮最多150秒。

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

2026-10-11，0.8.18常用任务复验（6类、9轮真实模型任务）：

- `D:/Apps/TwoCode/qa/variety-common-data-1791717207858`：订单汇总CSV（中文、逗号、引号、金额）、README中文副本；副手执行与主手审查完成，原文件未被覆盖。
- `D:/Apps/TwoCode/qa/variety-common-code-1791717207806`：两文件函数更名/调用更新、一次原生PowerShell验证、warning回传。multi的旧断言将主手not-executed回执也算成实际执行，导致2≠1；原始失败记录保留，`multi-reviewed.json`按实际执行状态复核通过，只有副手执行1次。修正验收计数，未改变产品权限策略。
- `D:/Apps/TwoCode/qa/common-followup-1791717315514`：双模型修改→关闭副手让主手修改→重开副手追加字段，两个原生session保持不变，副手记住原交接标记且保留主手中间修改。缺文件只读错误被正常回传；新增夹具错误使用failed匹配tool_end（实际协议是error），已修正。恢复脚本在同一原任务补齐文件后续接成功，证据`missing-recovered.json`及`recovery-results.json`，原始失败不覆写。
- `D:/Apps/TwoCode/qa/receipts-ui-1791717470014`：安装包0.8.18后台回放成功、失败和本轮真实warning，原工具详情内显示正确，页面异常0。窗口在屏幕外且不可聚焦，不操作物理鼠标。

本轮未发现新的协调器/适配器运行时缺陷，未为改变模型回答质量修改提示词，产品仍为0.8.18；只新增常用连续任务回归并修正验收误判。typecheck、lint和架构检查通过，lint为0错误/原有70警告。跨文件任务中模型尝试了额外主手命令，被执行前正确拒绝，没有实际执行；这是保留的模型行为证据，不计成框架执行错误。

0.8.19第二组常用交接：`D:/Apps/TwoCode/qa/common-review-1791717709339`的同轮首稿/返工两次交接与非阻塞派工通过，交接和报告数量及顺序正确，原文件未改；`D:/Apps/TwoCode/qa/control-common-stop-1791717641648`停止/原副手续接、重复提交抑制、迟到批准拒绝通过；`D:/Apps/TwoCode/qa/fork-1791717618942`原生双会话分叉、历史截断、原/分支上下文隔离、服务重开后幂等通过。分叉测试收尾暴露模型配置初始化/关闭竞态，修复与证据见provider-lifecycle.md。最终0.8.19包回放两次返工与非阻塞交接，确认每份报告仍在对应原工具详情内，再完成真实主副手文件读取与刷新验收，见`D:/Apps/TwoCode/qa/common-review-ui-1791718275672`。本轮不修改角色提示词或模型回答质量规则。

0.8.20第三组验收：

- `D:/Apps/TwoCode/qa/coordination-1791718706063`：执行中连续补充不重复派发、原命令撤回、失败后同副手续接、服务重开后继续均通过；旧回执和用量保持不变。
- `D:/Apps/TwoCode/qa/repair-cycle-1791718851090`：普通`node check.mjs`原生返回`Exit code 7`，旧适配器的verification只有failed而漏了reportedExitCode，真实复现本轮修复点。更早的`repair-cycle-1791718763261`因非标准摘要标记导致夹具断言失败，未算成产品问题。
- `D:/Apps/TwoCode/qa/repair-cycle-1791718928784`：修复后三轮真实Step Plan/Claude DeepSeek协作通过。先失败退出码7，沿用同一主副手session修复后成功，第三轮调用read_handoff_history回读不重跑；runs.log仅两次执行，check.mjs未修改，当前交接回执不包含旧失败。成功工具没有直接提供数字退出码时仍不补0。
- `D:/Apps/TwoCode/qa/receipts-ui-1791719684163`：0.8.20安装包原工具详情可见原生退出码7和修复后当前成功回执，页面异常0。早期UI夹具用父节点innerText读取，无法穿透CodeViewer的Shadow DOM，后改用可见文本定位器；另将模型合法对比旧结果的文字误当成结构化回执串位，已限制为当前回执文本验收，没有修改产品显示或角色提示词。

133项回归通过，typecheck通过，架构违规0，lint错误0/原有警告70。任务执行成功/失败继续由原生状态决定，新增退出码仅为原始证据字段。

0.8.20第四组常用协作验收（4项、6轮真实调用）：

- `D:/Apps/TwoCode/qa/vision-live-1791719847698`：Step Plan主手和Claude DeepSeek副手均调用真实view_image，独立读到首张图的7294、蓝圆和红三角。保留before-refresh.png后，同名probe.png替换为1568、红圆和绿三角；重开服务沿用两个原生session再调用view_image，双方识别新像素，未沿用旧图。第二轮证据image-refresh.json/image-refresh-results.json；两个session ID均保持。
- `D:/Apps/TwoCode/qa/common-boundaries-1791719859417`：计划模式下副手Write被明确记为notExecuted，requested.json不存在；配置切至edit后同一主副手session正常创建目标文件。另一并行任务连续处理one.json、two.json，产物各自保留FIRST/11与SECOND/22，第二次交接未覆盖one-result.json，两份输入逐字不变。

本组未发现新的协调/适配运行时缺陷，未更改模型提示词或产品行为，桌面继续使用0.8.20。新增常用边界和同名图片更新的真实回归脚本；typecheck、lint及架构检查通过，lint0错误/原有70警告。所有模型测试和图片夹具在D盘隔离目录中完成，没有操作用户鼠标或键盘。

0.8.20第五组真实协作复验：`D:/Apps/TwoCode/qa/fusion-live-1791720102775`在副手命令实际开始后提交修改要求，同一副手收到handoff_update，原工具回执interrupted，改用Write完成updated.txt；原脚本只启动一次，超过原定45秒后late.txt仍不存在。updateMs=47471包含等待迟到副作用的观察窗口，不是模型响应耗时。`D:/Apps/TwoCode/qa/fork-files-1791720114658`原任务/分支并发文件协作通过，细节见session-fork.md。本组未发现新的运行时缺陷，未改产品或提示词；typecheck、lint、架构检查通过，lint0错误/原有70警告。

0.8.20第六组并行验收：`D:/Apps/TwoCode/qa/parallel-scenarios-1791721193324`同时启动三方向真实小任务，均通过。

- 附件：两张同名截图经importImage产生不同内容地址，再经与前端一致的imageMessage进入任务；主副手各看两张，均识别3621/8459，原附件仍可预览。
- 组合续接：首轮副手修改stage为2，再保存/应用同底座“低档复核”组合续做checked:true；两角色session不变，任务配置均为low，原内容保留，全局默认组合未改变。
- 取消隔离：一项副手命令待审批时启动独立文件任务，再取消前者；另一任务继续完成UNRELATED_OK，副手session不同，迟到批准被拒、被取消脚本的unexpected.txt不存在。

前端附件草稿补验`D:/Apps/TwoCode/qa/vision-ui-1791721337255`：0.8.20隔离窗口上传+粘贴两张图片，刷新保留图片及文字；删除第一张后再刷新，仅保留第二张，任务数0，没有误发送，页面异常0。优化旧视觉UI夹具：移除对旧QA文件和0.8.6可执行文件的硬编码依赖，改为自建图片/可配置release，并增加不调用模型的草稿模式。本轮未发现新的产品运行时缺陷，新增回归且未改角色提示词；typecheck、lint和架构检查通过，lint0错误/原有70警告，桌面仍为0.8.20。
