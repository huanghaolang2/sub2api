# 模型排行后端下沉实施计划

依据已明确确认的 [backend-ranking-spec.md](./backend-ranking-spec.md)（SQL 与 Spec 均通过），按用户既有执行指令进入实施。此为本次新增后端范围的唯一计划，原 plan.md 已完成，不重写或并行维护原前端任务。正文冻结，仅更新任务状态；不创建 worktree，不提交或推送，不发布线上版本。

## 已核实的依赖与固定方法

- 当前原始 checkout 为 `/Users/hhl/work/project/sub2api`；backend 目录实际使用自动选择的 Go 1.27.2；pnpm运行使用`--config.verify-deps-before-run=false`，不自动安装或重整依赖。
- 复用现有模型仓储聚合及筛选追加器，不扩大 `UsageLogRepository`。Go 枚举和固定策略置于 `internal/pkg/usagestats/model_ranking.go`，新增 `ModelRankingPeriod`（week/month/lifetime）与 `ModelRankingOptions{MinimumTokens int64, Limit int}`，Options方法校验周期并产生后端固定门槛和10条限制。
- 新服务方法 `GetDashboardModelRanking(ctx,start,end,filters,period)` 只接受个人范围；通过小接口调用仓储 `GetModelRankingWithUsageFilters(ctx,start,end,filters,options)`，缺少能力时明确报错，不回退Go内存筛选。仓储调用原私有聚合构建器，新增可选ranking参数；普通路径传nil，排行路径追加已确认SQL的HAVING、C排序和LIMIT，原WHERE筛选不变。
- handler仅在非空且有效的ranking_period时进入新方法；无参数走原路径，无效值400，响应继续使用原用户转换器隐藏account_cost。
- TypeScript在api/usage.ts集中定义`UsageRankingPeriod`，dashboardBoards.ts以原`DashboardPeriod`名称重导出同一枚举；DashboardModelQuery及getDashboardModels增加ranking_period。前端移除门槛常量、过滤、排序和截取，直接映射返回序列。
- PostgreSQL 18.1与Redis 8.4测试镜像已存在。集成测试复用`testEntTx`隔离事务和现有TestMain创建的独立容器，使用CI=1防止静默skip。不得在当前业务库造数或执行迁移。
- 已只读核对本地业务库schema_migrations：296个迁移均已应用，按runner的TrimSpace规则校验全部一致。本需求不新增迁移；运行更新前再次核对无待执行项，不能隐式执行范围外SQL。
- 现有本地backend为linux/arm64、运行`/app/sub2api`，frontend工作目录`/workspace/frontend`；容器均可写。后端从当前checkout交叉构建，备份旧二进制后以新路径落盘并原子替换，重启仅sub2api并检查健康及运行文件hash；后端验证通过后才同步前端改动。已有网关/WebSocket源码不修改、不回退，构建包含当前checkout已有状态，验证结论仅限本需求。
- Go测试/构建使用已有工具链与依赖缓存；缓存或Docker受沙箱限制时申请对应工具权限，不改依赖或安全配置。前端构建输出新建/private/tmp目录，不覆盖嵌入前端dist。

## B1：实现后端固定策略、排行读取与兼容HTTP入口

- **目标**：仪表盘在数据库中完成聚合后门槛筛选、稳定排序和Top10，旧模型统计保持全量。
- **范围**：新增`backend/internal/pkg/usagestats/model_ranking.go`及`model_ranking_test.go`、`backend/internal/service/usage_model_ranking.go`及`usage_model_ranking_test.go`、`backend/internal/handler/usage_handler_model_ranking_test.go`、`backend/internal/repository/usage_log_repo_model_ranking_test.go`；修改`backend/internal/handler/usage_handler.go`、`backend/internal/repository/usage_log_repo_trend.go`。按固定方法接入已确认SQL；门槛不由客户端任意指定，用户ID来自既有鉴权。保留普通聚合查询和所有既有筛选参数。
- **依赖**：已通过SQL和Spec；Go1.27.2、既有SQLMock设施。
- **验收条件**：BR-AC-003以及BR-AC-001/002的策略与绑定部分；严格大于、固定10、无效周期400、不执行聚合、普通统计调用不截断；账号成本仍不向用户暴露，仓储能力缺失明确失败。
- **验证方式**：backend执行`go test -tags=unit ./internal/pkg/usagestats ./internal/service ./internal/handler ./internal/repository -run 'Test(ModelRanking|UsageModelRanking|UserDashboardModelRanking|UsageLogRepositoryModelRanking|UserUsageDashboardModels)' -count=1`，实际测试通过且无skip。使用gofmt处理本次Go文件；SQLMock只证明查询和绑定，聚合结果由B2证明。
- **状态**：已完成

## B2：用真实隔离数据库证明筛选、Top10与收益边界

- **目标**：通过真实PostgreSQL验证业务聚合语义及减少返回量，不以Mock代替核心行为。
- **范围**：新增`backend/internal/repository/usage_model_ranking_integration_test.go`。通过`testEntTx`建两用户、请求模型/历史回退、多条记录与缓存/零费用样例；对三个周期验证边界、至少15个合格模型的Top10、并列顺序、日期与用户隔离；同一数据分别调用全量和排行查询，记录行数、JSON字节数、耗时，不断言小样本必然更快。
- **依赖**：B1；现有隔离测试容器和事务辅助函数。
- **验收条件**：BR-AC-001/002/005的数据库与同样本比较部分。门槛作用于模型总量，不作用于单次请求；免费和缓存用量纳入；普通接口仍返回全部，排行至多10，比较样例中返回字节明显减少；另一用户不混入。
- **验证方式**：backend执行`CI=1 SUB2API_TEST_POSTGRES_IMAGE=postgres:18.1-alpine3.23 go test -tags=integration ./internal/repository -run '^TestUsageModelRanking' -count=1 -v`，要求实际执行、真实数据库结果通过并记录输出，不接受skip。数据仅在隔离测试库创建，结束事务回滚及容器清理。
- **状态**：已完成

## B3：前端只传周期并直接展示后端结果

- **目标**：去除浏览器内的业务筛选与排序，继续兼容旧用量页和延后加载。
- **范围**：修改`frontend/src/api/usage.ts`、`frontend/src/components/user/dashboard/dashboardBoards.ts`及`__tests__/dashboardBoards.spec.ts`、`__tests__/dashboardData.spec.ts`、`frontend/src/api/__tests__/dashboardRequests.spec.ts`、`frontend/src/views/user/__tests__/DashboardView.spec.ts`、`frontend/src/__tests__/fixtures/dashboardProgressivePreview.ts`。枚举单点定义，三个周期传入正确ranking_period；映射保留响应次序，不再用前端门槛/排序/截取。预览Adapter按模拟后端契约返回Top10，明确仅是布局数据。其余UI和调度不改。
- **依赖**：B1、B2通过后实施，实际运行更新仍先后端。
- **验收条件**：BR-AC-004；传输参数含周期并进入去重key；客户端直接映射服务端输出，既有UsageView不传新参数，加载阶段/取消/错误语义不变。
- **验证方式**：frontend执行`pnpm --config.verify-deps-before-run=false exec vitest run src/components/user/dashboard/__tests__/dashboardBoards.spec.ts src/components/user/dashboard/__tests__/dashboardData.spec.ts src/api/__tests__/dashboardRequests.spec.ts src/views/user/__tests__/DashboardView.spec.ts src/views/user/__tests__/UsageView.spec.ts src/composables/__tests__/useDashboardBoards.spec.ts`；检查真实最终HTTP参数和未Mock掉的页面连接。成功信号为所有受影响测试实际通过，不复跑无关完整测试矩阵。
- **状态**：已完成

## B4：质量检查、构建并按顺序更新本地环境

- **目标**：交付可在13011测试的后端筛选版本，准确记录当前服务和验证边界。
- **范围**：对B1–B3涉及文件执行检查，不改其他源码。新增`backend-ranking-verification.md`记录证据。Go交叉构建至`/private/tmp`，保留当前VERSION、设置本地构建Commit标记；更新前核对迁移清单和runner规范化hash，确认无待执行变更。备份现有后端可执行文件，以不同文件名落盘后原子替换、重启sub2api，核对健康、hash和无效周期400；确认后再备份并同步本次前端生产文件，不改容器配置、数据库或镜像。读取真实页面及同时间范围接口，记录可访问用户的数据量/响应字节/耗时；用户无数据时不伪造非零对账。新服务异常时还原已备份二进制恢复本地服务，报告证据。
- **依赖**：B3。
- **验收条件**：BR-AC-003/004/005的构建与本地连接部分；旧接口无参数保持兼容、新入口至多10；当前服务运行的确为新二进制。无后端旧有改动丢失，无额外SQL。生产提速仍属外部待验。
- **验证方式**：frontend对本次TS/Vue测试与预览文件执行`pnpm --config.verify-deps-before-run=false exec eslint <B3实际修改文件>`，再依次执行`pnpm --config.verify-deps-before-run=false run check:i18n`、`pnpm --config.verify-deps-before-run=false exec vue-tsc -b`、`pnpm --config.verify-deps-before-run=false exec vite build --outDir <新建/private/tmp目录>`。backend执行`CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -tags embed -ldflags '<现有版本与本地Commit标记>' -o <新建/private/tmp目录>/sub2api ./cmd/server`；具体实际值和命令记入验证记录。`git diff --check`及新增文件格式检查通过。Docker健康、运行文件SHA-256与编译产物一致、真实HTTP响应和页面结果分别记录，不相互替代。
- **状态**：已完成

## B5：只读交付审计

- **目标**：核对数据库下沉目标、兼容性及验证证据，完成准确交付。
- **范围**：主代理使用一次acceptance-audit，仅读本补充Spec/Plan、实际差异及已有证据，不派发子代理、不改实现、不重复运行已通过测试。审计后再在审计之外记录结果和任务状态。
- **依赖**：B4完成。
- **验收条件**：BR-AC-001–005均能映射实现与有效证据；明确数据库已执行HAVING/LIMIT，前端已移除业务筛选，真实隔离DB测试无skip；未把少行返回等同于基础扫描减少或生产提速。剩余真实生产对账/性能事项单列。
- **验证方式**：按acceptance-audit输出结论、验收对照、阻塞缺口、Test环境验证与剩余风险。无本地缺口才标记本地完成，不因预算或耗时省略必要验证。
- **状态**：已完成
