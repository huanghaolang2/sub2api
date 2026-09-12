# 使用看板实施计划

本计划基于用户已确认的 [spec.md](./spec.md)（`SPEC_APPROVED`）及 [sql-review.md](./sql-review.md)（`SQL_CONFIRMED`）建立，按当前任务授权进入实施。执行期间仅更新任务状态，范围或方法发生实质变化时先提交用户确认。

本计划按下列任务顺序执行，不派发编码子代理。文中未存在的使用看板文件均为本次拟新增文件。既有统计、使用记录、错误记录与管理功能沿用当前行为。

## 依赖与验证环境

- 已核实后端使用 Go、Gin、Ent 与 Wire；本机 Go 1.27.0 工具链可用，Docker Server 29.6.1 可访问。
- 仓库集成测试使用 `backend/internal/repository/integration_harness_test.go` 创建隔离数据库及 Redis，并应用项目已有迁移。使用本机已有的 `postgres:16-alpine`，Redis 按测试设施既有的 `redis:8.4-alpine` 镜像运行；镜像缺失时由测试设施获取。设置 `CI=1`，防止 Docker 不可用时跳过测试却返回成功。
- 两套前端均已安装依赖，使用 pnpm。`frontend2` 既有别名可复用 `frontend/src/api`、`composables` 和 `utils`；不新增请求客户端或图表依赖。
- `frontend` 的 `Select.vue` 为单选，不能直接承载多选；本次多选控件限定在看板模块内。`frontend2` 有自己的组件及样式，不引入旧前端 UI。
- 普通用户密钥候选复用 `/keys` 搜索分页；分组复用 `/groups/available`。管理员密钥候选复用 `/admin/usage/search-api-keys`，该接口最多返回 30 条，控件明确提示继续输入缩小搜索，不伪称完整列表；管理员分组复用支持分页和搜索的 `/admin/groups`。不新增候选项 SQL 或修改已确认的聚合语义。
- 当前尚无已验证的本功能真实角色登录与完整服务验收证据。浏览器交互验证和真实服务验收的边界见任务 5。

## 任务 1：实现完整的使用记录聚合与补零结果

- **目标**：通过一个后端看板模块返回准确、可对账的图表系列与表格分页数据。
- **范围**：新增 `backend/internal/service/usage_board.go`、`backend/internal/repository/usage_board_repo.go`；各自增加对应单元测试及 `usage_board_repo_integration_test.go`。定义粒度、数据状态、数据范围和排序方向的集中枚举；看板服务接收鉴权范围和查询参数，完成日期/月校验、时区与半开区间、周一分桶、所选密钥批量校验、全矩阵补零、名称去重展示、稳定排序和表格分页。仓储只实现已确认的两条读取查询，复用既有 `sqlExecutor` 和数据库连接，通过独立的小接口注入看板服务，不扩大已有 `UsageLogRepository` 接口及全部调用方。服务从同一批聚合结果构造完整图表及分页表格，保留零费用和零 tokens 记录。
- **依赖**：已通过的 Spec 和 SQL 专项；Go 1.27.0、Docker 及既有集成测试设施。
- **验收条件**：AC-002/003/004/005/006/007 中的时间、筛选、身份隔离、同名密钥、四项 tokens、零值、补零及分页行为通过；复现 SQL 审核样例总量 170，真实 0 的记录条数大于 0，缺失记录条数为 0。数据库测试还覆盖空分组、软删除密钥、跨年周、闰月及夏令时边界。排序先于分页，图表保持完整。
- **验证方式**：在 `backend` 执行 `go test -tags=unit ./internal/service -run '^TestUsageBoard' -count=1`；执行 `CI=1 SUB2API_TEST_POSTGRES_IMAGE=postgres:16-alpine go test -tags=integration ./internal/repository -run '^TestUsageBoard' -count=1 -v`，要求实际运行测试而非 skip。集成用例通过仓储及真实数据库记录验证结果，不用 SQL 字符串匹配代替聚合验收。
- **状态**：已完成

## 任务 2：接入普通用户与管理员读取接口

- **目标**：使两类入口使用相同看板结构，同时保持现有权限边界。
- **范围**：新增 `backend/internal/handler/usage_board_handler.go` 及对应测试；调整 `backend/internal/handler/handler.go`、`backend/internal/handler/wire.go`、`backend/internal/service/wire.go`、`backend/internal/repository/wire.go`，由 Wire 生成 `backend/cmd/server/wire_gen.go`。在 `backend/internal/server/routes/user.go`、`admin.go` 注册已冻结的 `/usage/board`、`/admin/usage/board`。同一看板处理器提供个人与管理读取入口，分别固定 `self/admin` 范围，复用现有会话、管理员鉴权、用户范围和面板限流；不允许客户端通过用户 ID 或范围参数提升权限。统一解析重复 ID 参数，映射 400/401/403/服务错误及取消行为。响应字段遵守 Spec，不返回密钥秘密值。
- **依赖**：任务 1 已完成。
- **验收条件**：AC-001/003/007/008 的接口部分通过；未登录、错误日期/月/时区、非法 ID、混合合法与越权密钥均产生对应错误；管理员个人入口仍限定本人，管理入口可查询管理范围；正常响应的图表和表格一致，取消与失败不变成缺失补零。
- **验证方式**：在 `backend` 执行 `go generate ./cmd/server`；执行 `go test -tags=unit ./internal/handler ./internal/server/routes -run 'UsageBoard' -count=1`；执行 `go build -o /tmp/sub2api-usage-board-server ./cmd/server`。处理器用例通过真实看板服务验证参数与结果，只替换数据访问边界；路由用例覆盖真实注册与权限中间件，不仅检查方法存在。
- **状态**：已完成

## 任务 3：实现共享请求与看板交互状态

- **目标**：两套前端使用一致的读取契约、筛选状态和过期请求处理。
- **范围**：新增 `frontend/src/api/usageBoard.ts`、`frontend/src/composables/useUsageBoard.ts`、`frontend/src/utils/usageBoard.ts`，以及对应 `__tests__/usageBoard.spec.ts`、`__tests__/useUsageBoard.spec.ts`。共享 API 文件定义请求/响应与跨接口枚举，使用已有 `apiClient` 和显式重复 ID 参数序列化；共享 composable 处理默认最近七日、日/周/月切换、日期有效性、多选和候选搜索、排序、分页、取消及最新请求提交。图表类型属于展示状态，切换仅重绘；页面模块选择使用集中枚举。复用已有密钥/分组请求函数，搜索状态和结果请求各自取消，保留已选对象的名称。工具模块承担纯展示转换、同名标签和 SVG 图表坐标及缺失标记数据，不在浏览器重新汇总使用记录。
- **依赖**：任务 2 已完成，接口契约可用。
- **验收条件**：AC-002/003/004/005/006/008 的状态行为通过；ID 数组按重复参数发送；粒度改变保留密钥/分组；无效日期不请求；旧响应和旧失败均不覆盖新结果；表格翻页或排序不丢失图表全量；图表类型切换不重置筛选或数据状态；候选项不会暴露密钥秘密值。
- **验证方式**：执行 `pnpm --dir frontend test:run src/api/__tests__/usageBoard.spec.ts src/composables/__tests__/useUsageBoard.spec.ts src/utils/__tests__/usageBoard.spec.ts`。通过延迟 Promise 验证请求竞争，通过实际序列化断言多选参数，通过真实展示转换断言名称、零点及缺失状态，不用静态文本匹配代替行为测试。
- **状态**：已完成

## 任务 4：接入两套前端的使用看板模块

- **目标**：普通用户和管理员在现有 usage 页使用相同能力，形成“查询条件 → 图表 → 表格”的独立模块。
- **范围**：在 `frontend/src/components/usage-board/` 与 `frontend2/src/components/usage-board/` 分别新增 `UsageBoardPanel.vue`、`UsageBoardChart.vue`、`UsageBoardMultiSelect.vue` 及相应测试。修改两套前端的用户 `views/user/UsageView.vue`、旧前端 `views/admin/UsageView.vue`、新前端 `views/admin/AdminUsageView.vue`，增加同级“现有统计 / 使用看板”入口，默认保留现有统计视图，看板首次进入时加载，切换后保留双方状态；管理员与普通用户入口不增加角色隐藏。两套 UI 分别遵循自身样式，复用任务 3 的请求和状态。图表使用原生 SVG，支持折线/柱状互斥切换、API Key 图例、可聚焦的零值/缺失标识和明确 tooltip；表格以密钥名称展示全量排序后的分页结果。旧前端文案补入 `frontend/src/i18n/locales/zh/misc.ts`、`en/misc.ts`。更新受影响的旧用量页测试，并新增新前端 `views/admin/__tests__/usage.spec.ts` 覆盖管理页面入口。
- **依赖**：任务 3 已完成。
- **验收条件**：AC-001 至 AC-008 的 UI 行为通过；同名密钥通过 ID 区分；真实 0 为正常系列色标识，缺失为灰色标识及“无数据”提示；无数据时图表与表格均保留时间段；出错提供重试，不显示伪造的成功补零；图表高于表格，默认日/折线/降序。窄屏保持字段和控件可访问，键盘可操作多选、切换和排序。旧统计、错误记录及导出保持原行为。
- **验证方式**：执行 `pnpm --dir frontend test:run src/components/usage-board/__tests__ src/views/user/__tests__/UsageView.spec.ts src/views/admin/__tests__/UsageView.spec.ts`；执行 `pnpm --dir frontend2 test:run src/components/usage-board/__tests__ src/views/user/__tests__/usage.spec.ts src/views/admin/__tests__/usage.spec.ts`。测试挂载实际看板与 SVG，不把核心图表组件替换成空壳。对以上新模块和四个修改页面运行各自项目的 `pnpm exec eslint`，对修改的共享 API、composable、utility 及中文/英文文案同步运行旧前端 ESLint。
- **状态**：已完成

## 任务 5：构建、浏览器核对与交付审计

- **目标**：给出完整的代码验证证据，并明确真实服务验收边界。
- **范围**：执行两套前端生产构建，检查四个入口和缺失值视觉行为；将验证证据记录在 `openspec/changes/add-usage-board/verification.md`。浏览器验证使用本任务临时启动的前端预览；通过浏览器工具对受影响接口提供固定响应，验证真实页面渲染及交互，固定响应不算数据库或真实鉴权证据。检查用户与管理员页面、日/周/月、多个密钥/分组、升降序、两种图表、请求错误和重试；重点检查真实 0 与缺失补零的 tooltip、图例及表格文字。验证后停止本任务创建的服务器和容器，保留已有运行环境。实现及计划内验证完成后使用一次 `acceptance-audit`，只读对照冻结规格、计划、差异和已有证据。
- **依赖**：任务 1 至 4 已完成。
- **验收条件**：AC-009 的两套构建通过，AC-001/005/006/008 的浏览器视觉检查有证据；既有统计与新看板切换正常。审计覆盖 AC-001 至 AC-009，说明每项代码位置、有效证据和外部待验证项。未获得真实角色登录及完整服务请求证据前，不将模拟接口页面检查宣称为端到端验收。
- **验证方式**：执行 `pnpm --dir frontend build`、`pnpm --dir frontend2 build` 和 `git diff --check`。预览分别使用 `pnpm --dir frontend exec vite preview --host 127.0.0.1 --port 14311`、`pnpm --dir frontend2 exec vite preview --host 127.0.0.1 --port 14312`；以 1280px 和 375px 宽度进行浏览器交互与截图检查。真实登录链路单列为外部待验证：在用户 test 环境中用普通用户与管理员登录，验证相同查询的真实返回、入口与数据权限；不为此重建或修改当前开发/生产服务。审计后仅因新变化或明确失败重跑受影响验证，不重复已通过且未变化的测试。
- **状态**：已完成

## 任务 6：将使用看板独立为用户菜单

- **目标**：普通用户从独立菜单进入看板，不再从用户入口看到使用记录；管理员保留管理用量记录入口。
- **范围**：新增 `frontend/src/views/user/UsageBoardView.vue`、`frontend2/src/views/user/UsageBoardView.vue`；用户 `/usage`、`/app/usage` 路由改为纯看板并新增 `/usage-board`、`/app/usage-board` 兼容路径；修改两套用户导航、frontend2 `ConsoleSection`、相关导航文案和 onboarding 入口；保留 `/admin/usage` 记录/看板页面和管理员入口。移除看板菜单的 simple mode 隐藏条件，确保两类角色均可见；更新导航测试。后端、查询契约和管理员记录数据范围不变。
- **依赖**：任务 1 至 5 已完成，用户追加的 D-002 已明确。
- **验收条件**：普通用户导航只出现“使用看板”而没有“使用记录”，旧用户 usage 地址渲染纯看板；管理员仍能从 `/admin/usage` 查询记录；13011/13012 仅重建前端容器后健康运行。
- **验证方式**：执行 frontend2 导航/路由/用量入口测试、frontend 路由/用量回归测试；执行两套前端构建；使用 Docker Compose 仅重建 `frontend frontend2`，检查容器健康、13011/13012 返回 200 及实际 Vue 模块包含独立菜单/看板路由。
- **状态**：已完成
