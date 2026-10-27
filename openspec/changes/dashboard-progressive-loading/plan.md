# 仪表盘按需加载与模型看板实施计划

状态：`PLAN_APPROVED`，已完成两遍自检；用户于 2026-10-26 明确要求执行，正文冻结。依据：[spec.md](./spec.md)，状态为 `SPEC_APPROVED`，用户于 2026-10-26 明确确认通过；无 SQL 变更。本文中标为新增的文件尚不存在，不在计划阶段创建占位实现。

## 执行约束与并行方式

- 本轮用户明确要求适合 Codex 并发并行开发。本计划确认后，允许仅在本任务范围内、同一原始 checkout 中对互不重叠的文件并行编码，作为对先前顺序写入默认要求的本轮调整；禁止 worktree、复制 checkout、后台新建 chat 或隐式创建隔离目录。
- 先完成 T1，确定共享 Interface，再开展 T2、T3、T4、T5。四项文件边界互斥，最多同时运行 3 个子代理和主代理；主代理处理加载调度关键路径和最终集成。当前仅编写计划，不派发代理或开始实现。
- 执行顺序：`T1 → (T2 ∥ T3 ∥ T4 ∥ T5) → T6 → T7 → T8`。并行任务不得修改对方文件、共享契约或计划。出现需要调整 Interface、文件范围或 Spec 的情况时停止对应任务，向主代理返回证据，由主代理提交用户决定；不得绕过契约增加兼容层。
- T6 必须等待 T2–T5 全部结束并核对实际差异及验证证据。完成后的相同验证不重复运行，除非后续改动影响其验证对象。全项目类型检查和构建只在集成完成后执行。
- T1 完成后，共享文件在并行阶段只读；并行任务在各自文件内实现约定的 Interface。各项范围中的路径均为仓库相对路径；派发时展开为完整路径。每项只交付范围内实际差异、执行过的验证结果及阻塞证据，不修改计划、Spec 或其他任务文件。
- 单独维护一份本 Plan；用户确认后正文冻结，只更新各任务状态。状态只使用「未开始 / 进行中 / 已完成 / 阻塞」。按实际执行标记状态，依赖未满足的任务保持未开始。
- 不修改 `backend` 源码、SQL、`frontend2`、依赖清单或锁文件。不提交、不推送、不部署。已有的 OpenAI/WebSocket 未提交改动保留，不能作为本任务的差异或验证对象。

## 已核实的环境与复用范围

- 当前工作目录为 `/Users/hhl/work/project/sub2api`，分支为 `release`。Node.js 为 `v26.5.0`、pnpm 为 `11.25.0`；`frontend/node_modules/.bin` 下已有 Vitest、vue-tsc、ESLint 和 Vite。使用 pnpm，不安装新依赖。
- 现有模块为 `frontend/src/views/user/DashboardView.vue`、`components/user/dashboard/UserDashboardTrends.vue`、`UserDashboardStats.vue`、`dashboardTrends.ts`，以及 `api/usage.ts`、`api/usageBoard.ts`、`api/client.ts`。
- `getUsageBoard(scope, query, signal?)` 已支持取消；`getDashboardStats()`、`getDashboardModels(params?)` 尚不支持取消。共享 GET 拦截器无条件覆盖 `params.timezone`，默认请求超时为 30 秒。
- `/usage/board` 的完整数据在 `series`，分页只影响 `rows`；`/usage/dashboard/stats` 的 `usage_board.ranking` 提供完整现存 API Key 名单；模型接口已经返回完整个人模型聚合。
- Vitest 使用 jsdom；`frontend/tsconfig.json` 排除测试文件，因此 vue-tsc 成功不能证明测试执行成功。现有 `components/__tests__/Dashboard.spec.ts` 测试的是自行重写的简化组件，不作为本次真实仪表盘验收证据。
- 标准 Vite 构建会清空并写入 `backend/internal/web/dist`。本次用等价构建步骤输出到新建的 `/private/tmp` 专用目录，避免覆盖当前嵌入前端产物；不修改 Vite 配置。
- 已核对已安装的 `vite-plugin-checker`：它在 build 时也会执行自身的 vue-tsc 检查。保留项目默认构建行为，不把这部分内置检查算成额外验证，也不再手工追加第三次 typecheck。
- 本机有 `playwright-cli`；规划检查时本地端口 13010 无监听。浏览器验证仅启动一个绑定 `127.0.0.1:13010` 的 Vite，使用 `--strictPort`，不停止或重配已有服务。启动时显式将 API base 设为 `/api/v1`、代理目标设为 `http://127.0.0.1:1`，防止本地环境变量指向外部接口；预览自身不调用业务接口。Vite 的公开配置注入取不到后端配置时沿用已有回退行为，不为预览搭建后端。浏览器尚未启动，浏览器启动与真实页面可用性不能视为已经验证。
- 目标线上网址此前跳转到登录页，缺少线上登录后验收证据。本地受控浏览器验证不连接数据库或生产接口。

## 固定的模块 Interface

以下 Interface 在 T1 实现并测试后供后续任务使用；后续任务不得另行定义平行的数据类型或展示名单。

| Module / Seam | 固定 Interface 与约束 |
| --- | --- |
| 展示与数据定义：新增 `components/user/dashboard/dashboardBoards.ts` | 集中定义看板种类、周期、加载阶段、加载状态、数据种类和依赖角色的枚举。周期为 `week/month/lifetime`，阶段为 `priority/deferred`，状态为 `idle/loading/ready/error`；数据种类为趋势系列、累计密钥统计、模型统计；角色区分主体数据和名单补全数据。 |
| 展示定义 | 导出 `defaultDashboardSections: readonly DashboardSectionDefinition[]`。section 包含稳定 `id/title/description/kind/cards`，card 包含稳定 `id/title/caption/period/stage/dependencies`。依赖项由 `role` 与 `DashboardDependencyDefinition` 构成；后者用按种类区分的联合类型记录周期和趋势期数，不在模块加载时捕获日期。默认定义声明两个趋势卡片、三个 Token 排行卡片和三个模型排行卡片。周 4 期、月 3 期的依赖描述由趋势及对应 Token 卡片共同引用，不各自重复声明。渲染和请求使用这一份定义。 |
| 请求定义 | `DashboardDependency` 是已解析请求，为按数据种类区分的联合类型，包含稳定 `key` 和完整请求参数，由 `resolveDashboardDependencies` 从依赖定义及日期快照生成。趋势调用 `self` 范围的使用看板，累计密钥统计无日期参数，模型请求显式使用 requested 语义及日期区间。共享 key 由数据种类和全部影响响应的规范化参数生成；阶段来自消费者需求中的最早阶段，不进入数据身份。 |
| 查询与转换 | `dashboardBoards.ts` 提供 `createDashboardSnapshot(now, timezone)`、`resolveDashboardDependencies(definitions, snapshot)` 和 `buildDashboardSections(definitions, snapshot, resources)`。快照保存统计时区和对应自然日；按日历运算生成周一、月初、下一自然日等边界，不用固定毫秒运算。保留 `dashboardTrends.ts` 现有图表算法并复用其完整系列转换与排行逻辑，增加稳定项目 ID 和按周期定位的能力。 |
| 数据 Adapter：新增 `components/user/dashboard/dashboardData.ts` | 导出 `loadDashboardDependency(dependency, signal)`，实现 `dashboardBoards.ts` 中定义的 `DashboardDependencyLoader`：接收解析后的 dependency 与 `AbortSignal`，返回 `Promise<DashboardDependencyResult>`。result 为 `{ kind, data }` 的可辨识联合，data 分别为 `UsageBoardResponse / UserDashboardStats / ModelStatsResponse`，不可用未区分的三类响应或 any 代替。失败直接 reject。生产 Adapter 与可控 Promise 测试 Adapter 使用同一 Interface，不重新聚合或管理阶段。 |
| 资源与快照 | `DashboardSnapshot` 包含 `today`（`YYYY-MM-DD`）与 `timezone`；`DashboardResource` 按稳定 key 保存 dependency、加载状态、错误文字及成功 result。`resources` 是只读 key→resource 映射，加载 Module 持有可写状态，展示转换只能读取。结果和错误使用各自请求的版本校验后提交。 |
| 加载 Module：新增 `composables/useDashboardBoards.ts` | `useDashboardBoards(definitions, loader)` 的 definitions 为 `MaybeRefOrGetter<readonly DashboardSectionDefinition[]>`，loader 为 `DashboardDependencyLoader`；返回 `sections: ComputedRef<readonly DashboardSectionModel[]>` 与 `retry(dependencyKey: string): Promise<void>`。内部负责挂载、依赖去重、阶段推进、请求取消、过期响应、共享重试和卸载；时间快照在当前页面实例中只创建一次。生产页传入默认定义及生产 Adapter，测试从同一 Interface 控制请求，不替换调度算法。 |
| 展示模型 | `DashboardSectionModel` 按种类区分，保持定义顺序。趋势卡片包含 `id/title/caption/rangeLabel/state/error/points`；排行卡片包含 `id/title/rangeLabel/state/error/notice/items`。排行项为稳定 `id/name/usage`；每个卡片提供 `retryTargets`（依赖 key 和按钮文字），区分主体失败与名单补全失败。模型排行使用原始模型标识作为稳定 ID。 |
| 展示组件 | `UserDashboardTrends.vue`、`UserDashboardStats.vue` 和新增 `UserDashboardModels.vue` 统一接收对应类型的 `section`，发出 `retry(dependencyKey)`。组件不请求数据、不重新推断周期、不维护加载阶段。Token 与模型排行复用新增 `DashboardRankingSection.vue`。 |
| 可取消与显式时区请求 | `api/client.ts` 导出 `RequestTimezonePolicy` 枚举 `browser/explicit` 及 `DashboardRequestOptions`（`signal?: AbortSignal`、`timezonePolicy?: RequestTimezonePolicy`），通过 Axios 配置类型扩展接入内部 `timezonePolicy`，不发送为 HTTP 业务字段。省略策略时保持旧行为。explicit 时优先保留 URL 查询中的 timezone，否则保留 params.timezone，均为空则写入 UTC；不能追加第二个 timezone。`getDashboardStats(options?)` 与 `getDashboardModels(params?, options?)` 保留原调用方式；仪表盘 Adapter 为模型请求选择 explicit。`getUsageBoard` 保留原签名和 URL 重复 ID 编码，并始终选择 explicit 保护它已传入 URL 的时区。 |

默认 Token 周/月卡片的主体依赖是对应趋势系列，名单补全依赖是累计密钥统计。累计 Token 卡片只依赖累计密钥统计。模型三个周期各自只依赖对应模型请求。这样累计名单失败只产生补全提示，不把成功的周/月主体数据变成失败。

依赖方向固定为：`dashboardBoards.ts → dashboardTrends.ts` 的纯函数、`dashboardData.ts → dashboardBoards.ts` 的类型、`useDashboardBoards.ts → dashboardBoards.ts`、展示组件 → 展示类型。`dashboardTrends.ts` 如需引用新类型仅使用 `import type`，不反向导入运行时枚举或默认定义，避免并行集成时引入循环初始化。

## T1：建立同源展示定义、查询与展示模型

- **目标**：形成可直接供并行任务使用、经过纯数据验证的统一 Interface。
- **范围**：新增 `frontend/src/components/user/dashboard/dashboardBoards.ts`、`frontend/src/components/user/dashboard/__tests__/dashboardBoards.spec.ts`；修改 `frontend/src/components/user/dashboard/dashboardTrends.ts`、`frontend/src/components/user/dashboard/__tests__/dashboardTrends.spec.ts`。实现上表定义、枚举、查询与规范化 key、展示模型转换。保留现有周/月趋势窗口、图表和 Tokens 口径；按完整 `series` 的周期起始日期定位当前周期。累计名单按 ID 合并零用量与同名显示，缺失时提供明确 notice；模型使用响应 `total_tokens`，按用量降序、标识字典序稳定排序，不重算服务端事实。累计起始日期保持字面量 `0001-01-01`，不经过 JavaScript 低年份 Date 构造。此任务不改请求层、调度或 Vue 组件。
- **依赖**：已审核 Spec；既有 `UsageBoardResponse`、`UserDashboardStats` 和 `ModelStatsResponse` 类型。
- **验收条件**：覆盖 AC-003/006/007/009/010 的定义、日期、数据变换部分；默认展示与依赖严格同源，重复数据 key 合并；移除趋势而保留排行后依赖仍存在且阶段变为延后；空优先列表可表达。包含跨年周、月初、UTC 回退、夏令时日期和累计范围；超过 1000 个单元且 `rows` 只有部分数据时结果完整，当前周期排行不误计整个窗口。所有共享 Interface 一次确定，后续任务无需自行补充字段。
- **验证方式**：在 `frontend` 执行 `pnpm exec vitest run src/components/user/dashboard/__tests__/dashboardBoards.spec.ts src/components/user/dashboard/__tests__/dashboardTrends.spec.ts`。成功信号是测试实际执行且通过，断言真实导出的转换函数输出、请求描述及完整结果；不通过快照或复制算法证明行为。
- **状态**：已完成

## T2：适配可取消、保留显式时区的真实请求

- **目标**：为加载 Module 提供可用的生产 Adapter，保持现有调用方兼容。
- **范围**：修改 `frontend/src/api/client.ts`、`frontend/src/api/usage.ts`、`frontend/src/api/usageBoard.ts`、`frontend/src/api/__tests__/client.spec.ts`、`frontend/src/api/__tests__/usageBoard.spec.ts`；新增 `frontend/src/api/__tests__/dashboardRequests.spec.ts`、`frontend/src/components/user/dashboard/dashboardData.ts`、`frontend/src/components/user/dashboard/__tests__/dashboardData.spec.ts`。按固定 Interface 实现时区策略和可选取消信号，由生产 Adapter 分派到三个现有 GET 接口。保留认证、翻译、刷新令牌、请求标记、30 秒超时及旧调用方式；不修改其他页面。Adapter 不创建额外重试、缓存或定时器。对请求层返回的普通对象错误保留其 message，不只识别 Error 实例。
- **依赖**：T1。
- **验收条件**：覆盖 AC-006/008 的传输部分。下层实际收到的时区等于显式值，获取时区异常/为空时为 UTC；取消信号到达 Axios Adapter。使用看板重复 ID 编码保持正确，最终服务端读取的时区没有歧义。旧调用未选择新策略时保持原有行为；接口路径、鉴权范围、日期和 requested 语义正确，无其他用户身份参数。
- **验证方式**：在 `frontend` 执行 `pnpm exec vitest run src/api/__tests__/client.spec.ts src/api/__tests__/usageBoard.spec.ts src/api/__tests__/dashboardRequests.spec.ts src/components/user/dashboard/__tests__/dashboardData.spec.ts`。时区与取消验收使用真实请求拦截器和 Axios 自定义 Adapter 检查最终配置/序列化地址，不能只 spy `apiClient.get` 或 Mock 掉待验证的生产分派函数。
- **状态**：已完成

## T3：按展示模型独立渲染趋势与失败恢复

- **目标**：让各趋势独立展示加载、结果和错误，取消组件内固定看板名单。
- **范围**：仅修改 `frontend/src/components/user/dashboard/UserDashboardTrends.vue`、`frontend/src/components/user/dashboard/__tests__/UserDashboardTrends.spec.ts`。消费 T1 的 section 与卡片状态，逐卡片渲染占位、图表、错误和重试入口；保留现有曲线、坐标轴、日期提示、键盘焦点、减少动画偏好和主题样式。标题及 aria 关联 ID 从 section/card 的稳定 ID 派生。移除当前组件的固定周/月配置及整组 loading 开关，不改纯数据函数或请求层。
- **依赖**：T1。
- **验收条件**：覆盖 AC-001/002/003/007 的趋势展示部分。周已完成而月仍加载时周图表可用；单卡片失败不遮挡其他卡片；卡片增删重排反映输入定义，重试事件指向正确依赖；原有悬浮及键盘日期提示可用。
- **验证方式**：在 `frontend` 执行 `pnpm exec vitest run src/components/user/dashboard/__tests__/UserDashboardTrends.spec.ts`。挂载真实组件、直接变化 section 状态并检查图表和交互，不能只检查标题存在或 Mock 图表主体。
- **状态**：已完成

## T4：实现固定高度的 Token 排行及模型排行

- **目标**：用同一套排行展示模块交付两组完整可滚动看板，避免复制样式和滚动逻辑。
- **范围**：新增 `frontend/src/components/user/dashboard/DashboardRankingSection.vue`、`frontend/src/components/user/dashboard/UserDashboardModels.vue`、`frontend/src/components/user/dashboard/__tests__/DashboardRankingSection.spec.ts`、`frontend/src/components/user/dashboard/__tests__/UserDashboardModels.spec.ts`；修改 `frontend/src/components/user/dashboard/UserDashboardStats.vue`、`frontend/src/components/user/dashboard/__tests__/UserDashboardStats.spec.ts`。固定外层列表视口可用高度为 `815px`（20 个含 padding 的 36px 行与 19 个 5px 间隙），加载、空、错误、成功状态共用视口；内部 ol 自然高度、无额外上下 margin/padding，单列、顶部对齐，不把少量行拉伸到铺满视口；外层使用 `overflow-y: auto`，标题在视口外。移除中等屏幕把同一排行改为两列的规则。窄屏允许行高随换行增长但视口仍固定。共享卡片主题、Tokens 格式、完整名称提示、键盘可聚焦滚动和重试事件，使用稳定项目 ID，并从 section/card ID 派生互不重复的标题及 aria 关联 ID，不截断数组。
- **依赖**：T1。
- **验收条件**：覆盖 AC-005/006/007/010 的排行展示部分。保留现有 Token 标题及顺序；模型看板有三个规定标题。25 项及零值项全部在真实列表中，状态切换保留同一视口结构；名单补全失败显示提示与独立重试，不遮挡成功排行。DOM 语义允许按名称找到并聚焦各滚动区域。真实行数、高度和末项滚动由 T7 浏览器证明，jsdom 不冒充布局验证。
- **验证方式**：在 `frontend` 执行 `pnpm exec vitest run src/components/user/dashboard/__tests__/DashboardRankingSection.spec.ts src/components/user/dashboard/__tests__/UserDashboardStats.spec.ts src/components/user/dashboard/__tests__/UserDashboardModels.spec.ts`。检查真实共享组件渲染出的全部项目、数值、状态、提示和重试事件，保留对同名项稳定身份的断言。
- **状态**：已完成

## T5：实现共享依赖的分阶段加载与取消

- **目标**：将动态依赖、优先展示、阶段推进及局部重试集中到一个加载 Module。
- **范围**：仅新增 `frontend/src/composables/useDashboardBoards.ts`、`frontend/src/composables/__tests__/useDashboardBoards.spec.ts`。接受 T1 的定义和 loader，按规范化数据 key 建立页面内资源状态，优先请求独立提交结果；全部优先请求结束后 `await nextTick()`，再次校验存活状态及依赖图版本，再启动延后依赖，空优先列表也须等一次渲染。初始加载和依赖集合/阶段变化各建立一个调度版本，单纯重排或失败重试不新建版本；每个版本只推进延后阶段一次。新版本等待当前依赖图内所有尚未结束的优先请求（包括复用中的在途请求）后，才启动新增的延后请求；不重复请求共享依赖，不撤回仍被使用的旧请求或已成功结果。资源另有独立请求版本，避免图更新使仍有效的共享请求失效；已无消费者的在途请求取消并使该请求版本失效。失败重试保留时间快照；retry 对无消费者、未知或已成功 key 不发请求，对加载中的 key 返回现有完成 Promise，对失败 key 只启动一次重试，并在内部记录错误以免事件调用产生未处理 rejection。错误文字优先读取 Error 或普通错误对象的非空 message，再使用对应依赖的失败说明；取消错误不展示为请求失败。卸载终止调度并取消请求。此任务不导入生产 Adapter、不改共享定义、请求或展示组件。
- **依赖**：T1；通过注入 loader 独立于 T2–T4 实施和验证。
- **验收条件**：覆盖 AC-001/002/003/004/007/008/009 的调度部分。两项优先未结束时延后调用为零；一项完成即可更新；成功、失败、超时均解除该项等待；空优先组可进入延后。共享请求只调用一次，动态移除/换周期的旧响应不覆盖新结果；已进入延后阶段后新增看板仍能加载，重排不重启请求。进入延后后重试优先数据不会再次启动其他延后请求；在 nextTick 前后卸载或改变定义均不会执行过期阶段推进，卸载后不再发起请求或提交响应。
- **验证方式**：在 `frontend` 执行 `pnpm exec vitest run src/composables/__tests__/useDashboardBoards.spec.ts`。在真实 Vue 挂载/卸载和响应式定义下运行真实 composable，用可控 Promise 逐一完成/拒绝 loader，检查每个阶段的调用记录、AbortSignal、sections 输出和渲染顺序；超时通过 loader 拒绝为超时错误验证，不真实等待 30 秒。禁止 Mock 掉 composable 或只等最终 `flushPromises` 后断言最终画面。
- **状态**：已完成

## T6：集成真实仪表盘并验证完整加载链路

- **目标**：将独立完成的模块接入 `/dashboard`，交付完整可运行页面。
- **范围**：仅修改 `frontend/src/views/user/DashboardView.vue`、`frontend/src/views/user/__tests__/DashboardView.spec.ts`。移除本页以累计 stats 为条件的整页遮挡与重复加载逻辑，以及无页面数据消费者的 `authStore.refreshUser()`；认证仍由现有路由和 AppLayout 负责。将默认定义与 T2 Adapter 传给 T5，根据 section 种类和原顺序渲染 T3/T4，连接 retry 事件。不得在此重新定义请求列表、周期或手工等待时间。集成发现的问题返回所属任务，在其原文件边界内修复，并仅重跑受影响验证。
- **依赖**：T2、T3、T4、T5 全部已完成且差异和证据已核对。
- **验收条件**：覆盖 AC-001/002/004/006/007/008 的页面接线部分；默认先显示趋势结构，周/月请求独立完成后展示，累计及模型在阶段切换后才开始。至少验证正常延后加载、累计失败后补全重试、单个模型失败不遮挡其他区域及页面卸载；页面不增加资料刷新请求。AC-003/009/010 的完整定义、日期和大数据边界复用 T1/T5 证据，AC-005 的真实几何由 T7 验证，不声称 jsdom 已证明全部验收条件。
- **验证方式**：在 `frontend` 执行 `pnpm exec vitest run src/views/user/__tests__/DashboardView.spec.ts`。挂载真实 DashboardView、真实 composable、生产 Adapter 和真实趋势/排行子组件，只替换 AppLayout 外壳及最终 HTTP Adapter。受控 HTTP Promise 分阶段返回，断言请求日志与实际 DOM；不能把三个核心子组件 stub 成只显示文本的假组件。动态定义和细节边界复用 T1/T5 证据，不重复建立同一测试矩阵。
- **状态**：已完成

## T7：完成必要回归、构建和真实浏览器布局验证

- **目标**：取得集成后的质量与布局证据，避免把单元测试或构建成功等同于完成。
- **范围**：新增测试专用 `frontend/src/__tests__/fixtures/dashboardProgressivePreview.html`、`frontend/src/__tests__/fixtures/dashboardProgressivePreview.ts`、`frontend/src/__tests__/browser/dashboardProgressive.qa.js`；新增 `openspec/changes/dashboard-progressive-loading/verification.md` 记录实际命令、退出结果、浏览器测量和截图位置。预览入口只在本地 Vite 直接访问，导入 `src/style.css`、真实 composable 和三个真实展示组件，注入 25 条数据及加载/空/失败场景；通过预览页按钮切换场景和 document 根节点的 dark class，不复制核心算法、不注册生产路由、不提供生产开关或凭据、不连接后端。浏览器脚本使用项目外已安装的 playwright-cli 执行，无新增依赖；脚本文件严格为单个 `async page => { ... }` 函数表达式，不使用 import/export/require 或不存在的全局 expect，断言失败须 throw Error，不能只返回 false。图片目录由执行脚本前的 shell 创建。
- **依赖**：T6。
- **验收条件**：相关回归通过，受影响文件 Lint 通过，类型检查与前端构建通过。1440×1000、100% 缩放和标准字号下，每个排行列表自身视口内初始完整可见 19–21 行，区域内可滚到第 25 项；加载/空/错误/成功的视口实测等高，不以整页可见行数代替列表内行数。390×844 下无页面横向溢出、末项可达、长名称和数值可读；明暗两种主题均核对，主题切换验证实际 dark class 和计算样式，不只模拟操作系统主题。滚动区域可 Tab 聚焦并通过键盘滚动。保留测量数值和截图，不只输出“通过”；检查页面运行异常，预期的本地公开配置回退提示单独记录。真实接口的数据正确性、累计日期绑定与大数据量耗时明确标为外部待验证。
- **验证方式**：以下命令均在 `frontend` 执行，独立的回归与 Lint 可并行，构建按子步骤顺序执行；T1–T6 已通过且实现未变化的测试不重复运行。
  1. 兼容回归：`pnpm exec vitest run src/views/user/__tests__/UsageView.spec.ts src/__tests__/integration/usage-reasoning-effort.spec.ts src/composables/__tests__/useUsageBoard.spec.ts`，要求实际执行且通过，保护共享请求改动影响到的旧入口。
  2. 受影响 Lint：`pnpm exec eslint src/api/client.ts src/api/usage.ts src/api/usageBoard.ts src/api/__tests__/client.spec.ts src/api/__tests__/usageBoard.spec.ts src/api/__tests__/dashboardRequests.spec.ts src/components/user/dashboard/dashboardBoards.ts src/components/user/dashboard/dashboardData.ts src/components/user/dashboard/dashboardTrends.ts src/components/user/dashboard/UserDashboardTrends.vue src/components/user/dashboard/DashboardRankingSection.vue src/components/user/dashboard/UserDashboardStats.vue src/components/user/dashboard/UserDashboardModels.vue src/components/user/dashboard/__tests__/dashboardBoards.spec.ts src/components/user/dashboard/__tests__/dashboardData.spec.ts src/components/user/dashboard/__tests__/dashboardTrends.spec.ts src/components/user/dashboard/__tests__/UserDashboardTrends.spec.ts src/components/user/dashboard/__tests__/DashboardRankingSection.spec.ts src/components/user/dashboard/__tests__/UserDashboardStats.spec.ts src/components/user/dashboard/__tests__/UserDashboardModels.spec.ts src/composables/useDashboardBoards.ts src/composables/__tests__/useDashboardBoards.spec.ts src/views/user/DashboardView.vue src/views/user/__tests__/DashboardView.spec.ts src/__tests__/fixtures/dashboardProgressivePreview.ts src/__tests__/browser/dashboardProgressive.qa.js`，不使用自动修复选项。
  3. 等价构建：先执行 `pnpm run check:i18n`，再执行 `pnpm exec vue-tsc -b`，最后创建专用目录 `DASHBOARD_BUILD_DIR=$(mktemp -d /private/tmp/sub2api-dashboard-progressive-build.XXXXXX)` 并执行 `pnpm exec vite build --outDir "$DASHBOARD_BUILD_DIR"`。三步各自记录退出结果和实际产物路径；任何一步失败都不能用后续成功覆盖，不另跑 typecheck 或默认 build。保留 Vite 插件随构建内置的类型检查。
  4. 本地预览：`VITE_API_BASE_URL=/api/v1 VITE_DEV_PROXY_TARGET=http://127.0.0.1:1 pnpm exec vite --host 127.0.0.1 --port 13010 --strictPort`，确认启动成功后执行 `mkdir -p /Users/hhl/work/project/sub2api/output/dashboard-progressive-loading`；使用 `playwright-cli -s=dashboard-progressive open http://127.0.0.1:13010/src/__tests__/fixtures/dashboardProgressivePreview.html`，再执行 `playwright-cli -s=dashboard-progressive run-code --filename=src/__tests__/browser/dashboardProgressive.qa.js`。脚本切换两个视口和主题，操作真实滚动/键盘，检查 bounding box、clientHeight、scrollHeight、scrollTop、完整行数与末项可见性，截图使用上述目录的绝对文件路径。仅有 CLI 零退出码不算通过，还须核对脚本断言结果及实际测量输出。结束后只关闭本任务会话及本任务启动的 Vite。端口占用或浏览器启动受阻时记录环境阻塞，不停止他人服务、不擅改固定端口或跳过布局验收。
  5. 在仓库根执行 `git diff --check`，并对新增文本文件执行 `git diff --no-index --check /dev/null <实际新增文件路径>`，确认已有无关改动未被本任务覆盖。命令失败要区分当前改动、既有基线和环境；记录证据，不扩大范围修复。
- **状态**：已完成

## T8：执行一次只读交付验收审计

- **目标**：对照冻结 Spec、Plan、实际差异与已有验证证据给出准确的交付结论。
- **范围**：主代理执行一次 `acceptance-audit`，读取本 Plan、Spec、实际实现差异及 T1–T7 证据；不启动子代理，不改代码、测试、文档或任务状态，不重复已经通过的测试。审计完成后再由主代理在审计之外更新任务完成状态，并在最终交付中列出证据与外部待验证事项。
- **依赖**：T7 完成；所有实现任务和计划内本地验证有实际证据。
- **验收条件**：AC-001 至 AC-010 均可追踪到实现和有效验证；识别浅层断言、Mock 核心算法、只检查存在性、跳过测试和无关成功命令。交付严格区分本地通过、线上未部署、真实接口待验证；不得仅凭构建成功宣称线上优化完成。
- **验证方式**：按 `acceptance-audit` 的只读流程输出「结论、验收对照、阻塞缺口、Test 环境验证、剩余风险」。结论允许为通过、不通过或证据不足；有本地缺口时不能标为全部完成。外部验证未执行时单独记录为待确认，不伪造响应或耗时。
- **状态**：已完成

## 验收追踪

| Spec 验收项 | 实现任务 | 有效验证来源 |
| --- | --- | --- |
| AC-001 首屏结构与禁止提前请求 | T3、T5、T6 | T5 可控请求顺序与 T6 真实页面 DOM/HTTP 日志 |
| AC-002 独立显示与失败隔离 | T3、T5、T6 | T3 单卡片状态交互、T5 增量提交、T6 页面集成 |
| AC-003 定义驱动与共享依赖 | T1、T5、T6 | T1 依赖解析、T5 增删重排与取消、新需求请求日志 |
| AC-004 阶段切换及空优先组 | T5、T6 | T5 渲染前后请求顺序、失败/超时/空优先组测试 |
| AC-005 固定高度与全部可滚动 | T4、T7 | T4 完整 DOM 列表；T7 两个视口实测行数、高度和末项可达 |
| AC-006 模型排行、日期与时区 | T1、T2、T4、T6、T7 | T1 日期/排序，T2 最终 HTTP 配置，T4 真实展示，T7 浏览器；实际零费用记录与累计日期绑定另列真实接口待验证 |
| AC-007 局部重试与名单补全 | T1、T3、T4、T5、T6 | T1 按 ID 合并，T3/T4 错误和提示交互，T5 重试去重，T6 失败恢复链路 |
| AC-008 卸载取消与过期响应 | T2、T5、T6 | T2 信号传递，T5 卸载及迟到响应测试，T6 页面退出后的 HTTP 调用记录 |
| AC-009 同轮查询周期一致 | T1、T5、T6 | T1 日期快照，T5 跨日完成及重试参数检查；不承诺数据库事务快照 |
| AC-010 全量系列与当前周期 | T1、T4、T6 | T1 超过 1000 单元与分页 rows 样例、同名与零值，T4 完整列表，T6 连接真实转换逻辑 |

## 外部待验证事项

- 登录目标部署版本后，确认真实请求先后、个人权限和请求模型口径；不以本地模拟响应代替。
- 对真实保留数据核对模型总 Tokens 含缓存和零费用使用；明确 API Key 所属人与模型日志所属人的历史差异可能导致总量不等。
- 确认累计模型请求 `0001-01-01` 经实际数据库驱动正常绑定；记录真实数据量下优先与延后请求的耗时，确认延后查询不会在后续操作中产生不可接受的竞争。本次不预设没有实测依据的性能数值。
- 本计划不执行线上部署；上线后仍须核对实际版本、明暗主题、窄屏和排行滚动。外部验收结果不从 Git、测试或构建状态推断。
