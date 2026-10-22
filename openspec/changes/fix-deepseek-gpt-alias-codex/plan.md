# DeepSeek GPT 别名 Codex 兼容实施计划

状态：`PLAN_APPROVED`，用户于 2026-10-22 明确审核通过，正文冻结。

依据：[spec.md](./spec.md)，状态为 `SPEC_APPROVED`，用户于 2026-10-22 明确审核通过。目标保持不变：保留 GPT 别名及下游配置，由 sub2api 根据已配置的真实 DeepSeek 映射完成能力声明和核心请求适配。

按任务 1 → 2 → 3 → 4 → 5 顺序执行。计划确认后正文冻结，仅更新任务状态；不得自行扩大文件范围、功能或验证范围。

## 已核实的依赖与边界

- 在当前原始 checkout `/Users/hhl/work/project/sub2api` 中执行，不创建 worktree、分支或子代理，不提交、推送或自动部署。
- `backend/go.mod` 要求 Go 1.27.2，该工具链已下载并成功运行定向测试。以下 Go 命令均在 `backend` 目录执行；本地服务测试只使用受控 HTTP/WS 上游和既有测试替身，不连接生产数据库或真实模型服务。
- 当前未提交的容量故障改动涉及 `openai_gateway_handler.go`、`openai_ws_forwarder_ingress.go`、`openai_ws_http_bridge.go`、`openai_ws_v2_passthrough_adapter.go` 及对应测试。本计划只在明确列出的重叠文件内作定点修改，保留这些既有差异；不改容量错误改写、故障转移和连接关闭语义。
- 本地目录构建已能使用映射后的模型；原生目录补全仍有按公开 `slug` 取默认值的分支。临时覆盖测试已复现 GPT 档位泄漏及映射到 DeepSeek 后 Lite 声明残留；这些测试将成为正式回归用例，不把临时文件加入仓库。
- 真实映射复用 `resolveOpenAIForwardMappedModels`、现有目录映射解析及 `isDeepSeekCatalogModel`。不新增按域名猜测供应商的配置，不对上游 URL 或协议配置作自动重写；透传模式下未生效的残留映射不能触发兼容处理。
- 工具适配复用 `apicompat.AdaptResponsesClientToolsWithInheritedMapping`、既有响应恢复和工具搜索发现逻辑。`additional_tools` 的提取与去重使用既有结构和冲突规则，不另建工具协议。
- WS HTTP Bridge 已有会话内完整输入回放、工具映射继承与结果收集。HTTP 状态存储中的 response-owner/account 绑定不包含完整历史，不能当作可恢复对话快照；本次不增加跨请求历史存储。
- 有限兼容状态和错误类别使用集中定义的类型/枚举；复用现有协议枚举和第三方协议字段，不新增业务布尔配置。
- 不涉及 SQL、迁移、前端、依赖升级、生成代码或真实模型调用。外部部署验收属于任务 5，不能用本地测试通过代替。

## 任务 1：让全部模型目录按真实 DeepSeek 目标声明能力

- **目标**：同一 GPT 别名在本地目录、标准模型列表转换、原生目录补全及缓存命中后呈现一致的真实能力。
- **范围**：修改 `backend/internal/service/openai_codex_models_service.go`、`openai_codex_model_metadata.go`；新增 `openai_deepseek_alias_compat.go` 中供目录和转发共用的有限目标识别逻辑；新增 `openai_codex_deepseek_alias_test.go`。目录默认 descriptor 按实际映射目标创建，再恢复公开 `slug` 和别名展示信息。有效目标能力快照优先于内置默认值，保持既有账号筛选、分组路由及多目标冲突规则。对已明确的 DeepSeek 目标，在最终目录合成阶段约束 `use_responses_lite=false`、清除 GPT 专有 `code_mode_only`，不从 GPT 别名补入推理/速度档位或其他能力；未知能力仍走保守回退。所有修正作用于客户端结果副本，保持共享缓存原始内容，并根据最终响应重新生成 ETag。
- **依赖**：Spec 已批准，现有目录生成、映射及能力快照实现可用。
- **验收条件**：A1、A2 通过。示例映射保留 `gpt-6.1-sol`，稀疏目录使用真实 DeepSeek 的默认档位；可信快照覆盖默认值，旧 Lite 声明被关闭。标准列表、本地目录和原生目录补全结果一致；缓存命中后修改映射/能力可影响最终目录与 ETag；其他分组、无映射账号、真实 GPT 和多目标冲突行为不被扩大。
- **验证方式**：执行 `go test -tags=unit ./internal/service -run '^(TestDeepSeekAliasCatalog|TestCompleteAPIKeyCodexModelsManifestForClientPreservesProviderMetadata|TestBuildCodexModelsManifestForGroupUsesSafeFallbackForConflictingAliasTargets|TestCodexAliasFailoverMappingHonorsModelRouting)' -count=1 -v`。新增用例统一以 `TestDeepSeekAliasCatalog` 开头，调用真实目录生成、获取/缓存和最终补全入口；检查返回字段、原始缓存副本及 ETag，不用自建 descriptor 仿制实现。成功信号为所有指定测试实际运行并 PASS，无 skip 或无匹配测试。
- **状态**：已完成

## 任务 2：完成 HTTP/SSE 的 DeepSeek 别名请求与工具往返适配

- **目标**：Codex 沿用 GPT 别名和已有请求配置时，上游收到语义正确的 DeepSeek 请求，客户端收到原别名和可继续执行的工具事件。
- **范围**：扩展 `backend/internal/service/openai_deepseek_alias_compat.go`；修改 `openai_gateway_forward.go`、`openai_gateway_request_body.go`、`openai_gateway_passthrough.go`、`openai_gateway_responses_chat_fallback.go`；新增 `openai_gateway_deepseek_alias_test.go`。在实际目标已解析、通用 GPT 归一化可能改变语义之前确定本次兼容规则；只修改当前尝试的请求副本，不污染客户端原始请求和后续真实 GPT 故障转移请求。保留 `none` 关闭思考的语义，按 Spec 处理其他档位，避免 `minimal` 先被通用逻辑改成 `none`。对原生 Responses 路径，合并 `tools` 与 `input.additional_tools`，使用既有冲突检查及可逆工具适配，覆盖只有 namespace 的请求；保存映射供 JSON/SSE 回程恢复。仅在出站副本上清除 Lite 头和对应 WS 元数据标记，不重写 Base URL、API Key 或既有协议选择。现有 Responses → Chat Completions 分支继续使用原来的转换器；为明确映射到 DeepSeek 的第三方账号补齐对应的思考开关、推理内容回传和缺失值兼容处理，保留已有真实推理内容，不改变无映射第三方账号的行为。无状态请求在历史检查后再处理状态字段；HTTP 使用本次请求提供的显式历史，不把 response-owner 绑定或 `item_reference` 当成历史正文。只有不可恢复引用、悬空工具结果或无法转换的核心工具时，在发送上游前按 Spec 返回 400 `invalid_request_error`，标明 `param`；不伪造历史或静默丢掉工具。请求、计费模型、上游响应模型和客户端公开模型继续沿用既有分离记录。
- **依赖**：任务 1 已完成；现有工具适配、响应恢复、Chat Completions 转换及工具调用关联分析设施。
- **验收条件**：A3、A4 的 HTTP/SSE 部分、A5 的 HTTP 部分通过。受控上游看到真实 DeepSeek 名称、兼容的工具定义和正确思考选项；下游获得 GPT 别名、成对的 `call_id`、正确自定义工具与 namespace 事件。文本、流式/非流式工具调用及完整显式历史下的工具结果续接均成功；旧 Lite 标记不泄漏到 DeepSeek。未配 DeepSeek 映射的真实 GPT 对照请求保持原行为。缺失核心历史/不兼容工具在上游调用前失败，且原始请求未被改写。
- **验证方式**：执行 `go test -tags=unit ./internal/service -run '^(TestDeepSeekAliasHTTP|TestDeepSeek(Adaptive)?ResponsesForwardRestoresClientTools|TestForwardResponses_DeepSeekChatFallback|TestForwardResponses_NonDeepSeekChatFallback|TestOpenAIPassthroughAPIKeyRestoresClientTools|TestMappedGPT55LiteBuildersPreserveIngressForFailover|TestNormalizeDeepSeekResponsesRequestBodyAliasesInputImageURL)' -count=1 -v`。新增用例以 `TestDeepSeekAliasHTTP` 开头，通过实际 `Forward` 入口及受控上游交换完整请求/响应；包括 Responses 与已配置的 Chat Completions 分支、两轮工具往返、namespace-only、`additional_tools`、档位转换、无历史引用失败、真实 GPT 对照和原始请求不可变性。只替换外部 I/O，不 Mock 核心适配。成功信号为预期调用次数、请求字段、事件序列、错误状态及模型归属断言全部通过。
- **状态**：已完成

## 任务 3：使已启用的 WS HTTP Bridge 保持相同适配与续接语义

- **目标**：客户端继续使用原有 WebSocket 请求时，在现有桥接能力范围内完成 DeepSeek 的连续工具调用，不丢失上下文。
- **范围**：修改 `backend/internal/service/openai_ws_forwarder_ingress.go`、`openai_ws_http_bridge.go`，复用/扩展 `openai_deepseek_alias_compat.go`；新增 `openai_ws_deepseek_alias_test.go`。在现有 WebSocket 准入与显式关闭检查之后，根据已解析的 DeepSeek 目标选择已经允许的 HTTP Bridge：账号显式 `http_bridge`，或现有 HTTP Bridge 开关已开启时，不再以载荷大小决定该 DeepSeek 会话是否桥接。不打开关闭的 WS/桥接配置，不改调度资格或认证规则。每轮使用当前真实目标，不沿用上一轮模型的兼容判断；映射应用一次。历史回放在删除 `previous_response_id` 前完成，复用既有会话输入、工具映射和输出收集；工具定义省略时继承既有状态。对无法恢复的引用、悬空工具输出和无法转换的工具发送既有错误事件，并使用既有策略关闭语义结束错误轮次，不归类为容量故障。经过实际工具转换后删除 Lite 出站标记，回程恢复公开模型与工具事件。保持取消、断连、输出后不重放以及原有容量恢复行为。
- **依赖**：任务 2 已完成；现有 WS 准入、HTTP Bridge、会话回放和可逆工具映射。
- **验收条件**：A3、A4、A5 的 WS 部分通过。小载荷的已允许桥接 DeepSeek 会话也使用 HTTP 上游；同会话至少完成“工具调用 → 省略工具定义的结果回传 → 下一轮回答”。重建后的上游请求包含匹配的历史调用与结果，客户端事件仍携带 GPT 别名。新会话不继承其他会话的工具/历史，缺失历史明确报错；真实 GPT 对照、显式关闭模式和原有容量恢复测试保持通过。
- **验证方式**：执行 `go test -tags=unit ./internal/service -run '^(TestDeepSeekAliasWS|TestOpenAIWSHTTPBridgeAPIKeyReusesClientToolMappingWhenFollowupOmitsTools|TestOpenAIWSHTTPBridgeFullCustomToolHistoryWithoutPreviousResponseIDDoesNotReplay|TestOpenAIWSHTTPBridgeObjectToolOutputWithoutPreviousResponseIDReplaysMatchingCall|TestOpenAIWSHTTPBridgeKeepsContinuationFramesOnHTTPWithoutPreviousResponseID|TestOpenAIWSProtocolResolver_Resolve_ModeRouterV2|TestProxyOpenAIWSHTTPBridgeTurn.*FailoverSafety|TestProxyOpenAIWSHTTPBridgeTurnDoesNotReplayCapacityAfterSemanticOutput|TestProxyResponsesWebSocketFromClient_RewritesCapacityShedCodeForClient)' -count=1 -v`。新增用例以 `TestDeepSeekAliasWS` 开头，通过 `httptest` WebSocket 连接调用实际 `ProxyResponsesWebSocketFromClient`，再由受控 HTTP 上游验证请求；不能仅调用单轮 helper 代替跨轮验收。成功信号为完整往返、状态隔离、错误事件、关闭模式和故障转移断言全部通过。
- **状态**：已完成

## 任务 4：完成本地构建、交付证据与只读验收审计

- **目标**：确认修改可编译、未破坏重叠路径的既有行为，并给出与冻结验收条件一一对应的本地证据。
- **范围**：新增 `openspec/changes/fix-deepseek-gpt-alias-codex/verification.md`，记录每项验证命令、结果、对应测试/代码及外部待验证事项。各任务在自身文件范围内完成 Go 格式化；本任务检查相关差异、执行服务入口回归和生产二进制构建，不启动应用。汇总任务 1–3 已有结果，不重复运行未受后续改动影响的测试；后续确实修改共享逻辑时，只重跑受影响任务已列出的命令。随后运行一次 `acceptance-audit`，只读对照冻结 Spec、Plan、实际差异和证据，不修改代码或计划、不派发子代理。保留原有用户改动，不将其计作本次成果；临时诊断覆盖文件只保留在临时目录，不加入交付差异。
- **依赖**：任务 1–3 已完成，全部对应测试具有有效运行结果。
- **验收条件**：A1–A5 有可核对的实现和测试证据，构建通过；没有以工具转换 helper 的成功冒充真实多轮链路成功，没有核心行为 Mock、跳过测试或无匹配测试。A6 明确列为外部待验证，尚未完成时不得宣称目标网站已经修复。审计未留下未处理的本次范围内问题。
- **验证方式**：在 `backend` 执行 `go test -tags=unit ./internal/handler -run '^TestOpenAIResponsesWebSocketCapacityRecovery$' -count=1 -v`，确认与已有容量改动交界的处理器行为；执行下面的构建命令，要求退出码为 0。回到仓库根目录执行 `git diff --check`，并检查本任务新增文件无尾随空白或冲突标记。审计核对全部 A1–A6，区分本地已验证、外部待验证和既有差异，不把构建成功视作真实模型调用证据。

  ```sh
  deepseek_alias_build_dir=$(mktemp -d /private/tmp/sub2api-deepseek-alias-build.XXXXXX)
  go build -o "$deepseek_alias_build_dir/server" ./cmd/server
  ```

- **状态**：已完成

## 任务 5：核对目标部署的真实 Codex 使用结果

- **目标**：确认修复在用户实际网站部署后，原 GPT 别名及原下游配置可以完成真实编程对话。
- **范围**：只在用户提供已部署修复的 test 环境结果或授权的访问条件后，执行/核对该环境的真实请求，并补充 `verification.md`。不由本计划自动修改部署、账号、模型映射、下游配置或密钥。记录测试部署所用代码版本、公开模型名、实际 DeepSeek 目标、请求 ID 和可观察结果，保持服务器状态与本地实现状态区分。
- **依赖**：任务 4 已完成；用户已将修复应用到目标 test 环境，并具备可核对的真实 Codex 会话和服务端映射记录。
- **验收条件**：A6 通过。原客户端配置下，GPT 别名能够完成文本响应、一次实际工具调用和收到工具结果后的继续回答；工具没有变成普通文本，模型路由实际落到已配置的 DeepSeek 目标。原有 WS 入口已启用桥接时，对应真实会话也完成同样续接；没有获得证据的传输方式明确保留为未验证。
- **验证方式**：在原 Codex 配置下刷新正常模型目录并新建测试会话，依次输入“只回复 OK”“使用命令工具输出当前工作目录，并在收到工具结果后告诉我目录名”“继续使用命令工具列出当前目录第一层最多五个文件名，再根据结果回答”。核对界面仍选择原 GPT 别名、第二/三步确实产生工具调用和结果回传，服务端记录显示实际 DeepSeek 目标。记录至少一个文本轮次和两个工具轮次的请求 ID、传输方式及结果。成功信号是这些可观察结果齐全；如果未提供目标环境证据，任务保持未完成，不以本地受控上游测试代替。
- **状态**：阻塞

## 验收追踪

| Spec 验收条件 | 实现/交付任务 | 证明方式 |
| --- | --- | --- |
| A1 真实能力与别名保留 | 任务 1 | `TestDeepSeekAliasCatalog*` 及目录对照测试 |
| A2 Lite、ETag、目录隔离 | 任务 1 | 实际目录完成/缓存路径的字段、ETag 与副本断言 |
| A3 请求与响应适配 | 任务 2、3 | `TestDeepSeekAliasHTTP*`、`TestDeepSeekAliasWS*` 的实际入口请求/响应检查 |
| A4 多轮工具与历史 | 任务 2、3 | HTTP 显式历史与 WS 会话回放的多轮工具测试 |
| A5 错误边界与 GPT 对照 | 任务 2、3、4 | 无上游调用的错误用例、GPT/关闭模式对照、已有容量恢复回归 |
| A6 目标环境真实 Codex | 任务 5 | 部署版本、原配置会话、请求 ID、实际目标及工具结果记录 |
