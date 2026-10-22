# DeepSeek GPT 别名兼容修复验证记录

日期：2026-10-22。基线为已批准的 [Spec](./spec.md) 和 [实施计划](./plan.md)。

## 交付边界

已完成本地实现、定向测试和后端构建。公开 GPT 别名、下游配置、既有账号配置和数据库结构未变；实现验收阶段未提交、推送、部署或调用真实模型。后续授权的 Git 交付核验见文末。

目标网站的代码版本、运行配置、实际 Codex 请求与上游结果尚未取得，因此 A6 仍待外部验收，不能认定原始 request ID 对应的故障已经在该网站消失。

## 本次文件

- 新增兼容逻辑：`backend/internal/service/openai_deepseek_alias_compat.go`。
- 能力目录：`backend/internal/service/openai_codex_models_service.go`、`openai_codex_model_metadata.go`。
- HTTP/请求构造：`backend/internal/service/openai_gateway_forward.go`、`openai_gateway_request_body.go`、`openai_gateway_passthrough.go`、`openai_gateway_responses_chat_fallback.go`。
- WS：`backend/internal/service/openai_ws_forwarder_ingress.go`、`openai_ws_http_bridge.go`。
- 新增测试：`backend/internal/service/openai_codex_deepseek_alias_test.go`、`openai_gateway_deepseek_alias_test.go`、`openai_ws_deepseek_alias_test.go`。

原有容量故障改动单独保留。实现前保存了只读差异快照，最终检查确认 4 个本次未编辑文件的原有 diff 完全一致；2 个重叠文件中的原有新增逻辑仍保留。原有处理器、WS 透传适配器及容量测试不计入本次新增实现。

## 验证命令与结果

以下 Go 命令在 `backend` 目录执行，使用仓库要求的 Go 1.27.2。每条命令均实际运行指定测试，没有以无匹配测试或 skip 作为成功。

### 任务 1：能力目录

```sh
go test -tags=unit ./internal/service -run '^(TestDeepSeekAliasCatalog|TestCompleteAPIKeyCodexModelsManifestForClientPreservesProviderMetadata|TestBuildCodexModelsManifestForGroupUsesSafeFallbackForConflictingAliasTargets|TestCodexAliasFailoverMappingHonorsModelRouting)' -count=1 -v
```

最终结果：退出码 0，6 个顶层测试通过，`ok .../internal/service 1.292s`。此结果包含对透传残留映射的标准列表、原生目录、目标快照及本地目录对照，目录相关逻辑在该次验证后未再变更。

证明：稀疏原生目录、标准列表转换、本地 OpenAI/组合分组目录保持 GPT 别名并采用 DeepSeek 能力；Lite/私有工具模式与速度档位不会继承 GPT 默认值；真实目标快照优先；缓存命中时变更能力可更新最终 ETag，同一上游缓存的其他账号视图不受影响；透传模式残留映射不触发该适配。

### 任务 2：HTTP/SSE 与既有 Chat Completions 桥接

```sh
go test -tags=unit ./internal/service -run '^(TestDeepSeekAliasHTTP|TestDeepSeek(Adaptive)?ResponsesForwardRestoresClientTools|TestForwardResponses_DeepSeekChatFallback|TestForwardResponses_NonDeepSeekChatFallback|TestOpenAIPassthroughAPIKeyRestoresClientTools|TestMappedGPT55LiteBuildersPreserveIngressForFailover|TestNormalizeDeepSeekResponsesRequestBodyAliasesInputImageURL)' -count=1 -v
```

最终结果：退出码 0，16 个顶层测试通过，`ok .../internal/service 1.214s`。此结果产生于共享历史归一化和不兼容历史/工具选择边界全部完成后。

证明：调用真实 `Forward`，检查实际构造的上游请求和客户端 JSON/SSE。覆盖自定义工具两轮往返、仅 namespace 工具、`additional_tools` 提升、工具搜索后发现并调用新工具、明文推理保留、原始请求/请求头不变、推理档位映射、`none` 关闭思考、Chat 工具回传、真实 GPT 对照。缺失历史、悬空工具输出、私有压缩项及无法适配的工具/选择在发送上游前返回带 `param` 的 400。

### 任务 3：WebSocket 入口与 HTTP Bridge

```sh
go test -tags=unit ./internal/service -run '^(TestDeepSeekAliasWS|TestOpenAIWSHTTPBridgeAPIKeyReusesClientToolMappingWhenFollowupOmitsTools|TestOpenAIWSHTTPBridgeFullCustomToolHistoryWithoutPreviousResponseIDDoesNotReplay|TestOpenAIWSHTTPBridgeObjectToolOutputWithoutPreviousResponseIDReplaysMatchingCall|TestOpenAIWSHTTPBridgeKeepsContinuationFramesOnHTTPWithoutPreviousResponseID|TestOpenAIWSProtocolResolver_Resolve_ModeRouterV2|TestProxyOpenAIWSHTTPBridgeTurn.*FailoverSafety|TestProxyOpenAIWSHTTPBridgeTurnDoesNotReplayCapacityAfterSemanticOutput|TestProxyResponsesWebSocketFromClient_RewritesCapacityShedCodeForClient)' -count=1 -v
```

最终结果：退出码 0，12 个顶层测试通过，`ok .../internal/service 0.941s`。

证明：通过真实本地 WebSocket 连接调用 `ProxyResponsesWebSocketFromClient`，分别覆盖 ctx_pool、passthrough、http_bridge 已允许桥接的模式；以远小于阈值的请求完成三轮交互。第二轮省略 model/tools，第三轮继续依赖前轮普通回答；工具定义、namespace、明文推理和消息历史均保留，映射每轮只应用一次。独立连接不能借用共享 owner 绑定恢复旧历史；无效请求返回错误事件和策略关闭。显式 off、现有 GPT 传输决策、容量错误改写、输出后不重放及故障转移对照测试保持通过。

首次 WS 验证发现缺失历史请求的 `param` 被提前的字符串数组检查错误地归为 `input`；已修正为先保留其文本含义，再给出 `previous_response_id` 错误。随后增加并通过了 additional_tools 与省略工具定义共同存在的继承场景，最终结果以上述运行记录为准。

### 任务 4：处理器与构建

```sh
go test -tags=unit ./internal/handler -run '^TestOpenAIResponsesWebSocketCapacityRecovery$' -count=1 -v

deepseek_alias_build_dir=$(mktemp -d /private/tmp/sub2api-deepseek-alias-build.XXXXXX)
go build -o "$deepseek_alias_build_dir/server" ./cmd/server
```

结果：处理器测试退出码 0，1 个顶层测试通过，`ok .../internal/handler 6.537s`；最终生产入口构建退出码 0，产物为 `/private/tmp/sub2api-deepseek-alias-build.v7OEIg/server`，未启动。处理器测试后仅补充 DeepSeek 不兼容输入的校验及目录隔离，未改动该测试覆盖的 GPT 容量恢复路径。

共 35 个顶层测试通过（另含各自子场景）。根目录 `git diff --check` 通过；本次新增文件的空白/冲突标记检查通过；本次 12 个 Go 文件执行 `gofmt -l` 无输出。

## 验收证据对应

| 条件 | 实现位置 | 有效证据 | 当前状态 |
| --- | --- | --- | --- |
| A1 | 目录补全的 `descriptorModel` 选择、真实目标能力快照、`constrainDeepSeekCodexCapabilities` | `TestDeepSeekAliasCatalogAllSources`、目标快照测试及既有冲突/分组路由对照 | 本地已验证 |
| A2 | 客户端目录副本与最终 ETag、DeepSeek Lite/工具模式约束 | `TestDeepSeekAliasCatalogSnapshotAndCachedSourceIsolation`、透传残留映射对照 | 本地已验证 |
| A3 | `Forward`、出站 Lite 头清理、可逆工具转换、WS HTTP Bridge | HTTP 原生 JSON/SSE、Chat 桥接及真实本地 WS 入口用例 | 本地已验证 |
| A4 | 显式 HTTP 历史校验、会话内工具原始声明和完整消息回放 | HTTP 两轮工具/发现调用；三种允许桥接模式的 WS 三轮交互和独立连接隔离 | 本地已验证 |
| A5 | `invalid_request_error`、现有 WS 策略关闭、真实 GPT 路由与关闭模式 | 无上游请求的失败用例、GPT 对照、off 模式、容量恢复/故障转移测试 | 本地已验证 |
| A6 | 目标 test 部署及用户实际 Codex | 尚无部署版本、实际请求 ID 与真实模型结果 | 外部待验证 |

测试仅替换外部模型 HTTP I/O，核心目录补全、路由入口、工具适配、事件恢复和会话回放均执行实际实现。WS 测试使用实际本地 socket。没有把固定的上游响应当成真实 DeepSeek 模型遵循工具定义的证据。

## 目标环境待验证事项

在目标 test 环境部署本次修复后，保持原 GPT 别名、服务地址、API Key 和下游配置，按计划任务 5 执行文本响应、命令工具调用和工具结果后的续接。正常刷新模型目录并新建测试会话，记录部署代码版本、公开模型、实际 DeepSeek 目标、传输方式和对应请求 ID。

本次没有访问该外部网站，也没有重新发起原始失败请求。仅当这些证据齐全时，才能将 A6 和计划任务 5 标记为完成。

## 已知边界

- 已关闭的 WS 或 HTTP Bridge 不会被本次修复开启；WS 适配使用既有 HTTP Responses 桥接能力，上游仍须支持其配置的接口。
- 无法展开的引用和私有压缩历史、无法转换的专有工具会明确报错；本次不实现 GPT 私有云端功能、不新增跨请求历史存储。
- 不改计费规则、价格配置或账号密钥；真实网站的模型行为、部署生效及整体恢复仍需外部验收。

## 提交范围独立验证

用户随后授权只提交并推送本次修复，保留其他未提交改动。提交范围为本次 12 个 Go 文件和 3 份规格、计划、验证文档；两个重叠文件中的原有容量改动已从暂存内容中排除，工作区中的原始文件保持不变。

使用 Git 暂存内容生成 Go `-overlay` 编译视图，将 6 个尚有其他未提交改动的文件虚拟替换为其暂存版本，并排除原有未跟踪的处理器容量测试。没有创建 checkout/worktree，也没有替换工作区文件。

对本记录任务 1–3 的相同服务测试命令加上 `-overlay /private/tmp/sub2api-deepseek-delivery.1qdc7zvt/overlay.json` 后运行，结果为目录 6 项、HTTP 16 项、WS 12 项，共 34 个顶层测试全部通过，无 skip。隔离后的 `go build -overlay /private/tmp/sub2api-deepseek-delivery.1qdc7zvt/overlay.json -o /private/tmp/sub2api-deepseek-delivery.1qdc7zvt/server ./cmd/server` 同样通过。

前述处理器容量恢复测试属于原工作区中的其他未提交改动，不包含在本次提交中；其结果保留为原工作区验证记录，不计入上述 34 项独立提交验证。外部 test 环境验收仍待用户部署后确认。
