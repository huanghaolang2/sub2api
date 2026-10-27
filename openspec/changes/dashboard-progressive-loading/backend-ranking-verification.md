# 模型排行后端下沉验证记录

2026-10-26（Asia/Taipei）。依据已确认SQL、backend-ranking-spec.md与本阶段唯一backend-ranking-plan.md。此前前端筛选版本的验证记录为历史证据，本文件记录后端下沉后的实际结果。

## 最终行为

- `GET /api/v1/usage/dashboard/models` 可选`ranking_period=week/month/lifetime`；后端固定严格门槛分别为1,000,000 / 100,000,000 / 100,000,000，固定最多10条。
- 数据库按既有用户/日期/筛选聚合，执行HAVING，再按总Tokens降序及请求模型标识C排序升序，最后参数化LIMIT。Go只扫描返回的合格行；没有查询全量后在Go中筛选的回退。
- 参数省略/空值仍为完整模型统计；无效周期400，模型来源仍requested，隐藏account_cost，零费用与缓存口径不变。
- 前端周期枚举集中到api/usage.ts，DashboardPeriod重导出同一枚举；数据key含ranking_period，周/月日期重合时不会误合并不同策略。模型结果只映射服务端顺序，已删除前端门槛常量、filter、sort和slice。
- 无新SQL迁移、表字段或索引，未改API Key排行、管理员统计、frontend2、依赖文件或锁文件。没有提交、推送或线上发布。

## 代码与测试证据

| 范围 | 实际命令 | 结果 |
| --- | --- | --- |
| Go策略/服务/HTTP/仓储单元 | backend目录`go test -tags=unit ./internal/pkg/usagestats ./internal/service ./internal/handler ./internal/repository -run 'Test(ModelRanking\|UsageModelRanking\|UserDashboardModelRanking\|UsageLogRepositoryModelRanking\|UserUsageDashboardModels)' -count=1` | 4个包全部通过，退出0；策略、用户范围、缺少排行能力显式失败、无效周期、旧统计12项不截断、account_cost隐藏及SQL参数绑定 |
| PostgreSQL隔离集成 | backend目录`CI=1 SUB2API_TEST_POSTGRES_IMAGE=postgres:18.1-alpine3.23 go test -tags=integration ./internal/repository -run '^TestUsageModelRanking' -count=1 -v` | 实际运行通过，退出0，无skip；2个顶层测试、周/月/累计3个子场景 |
| 前端回归 | 根目录`pnpm --config.verify-deps-before-run=false -C frontend exec vitest run src/components/user/dashboard/__tests__/dashboardBoards.spec.ts src/components/user/dashboard/__tests__/dashboardData.spec.ts src/api/__tests__/dashboardRequests.spec.ts src/views/user/__tests__/DashboardView.spec.ts src/views/user/__tests__/UsageView.spec.ts src/composables/__tests__/useDashboardBoards.spec.ts` | 6个文件33项测试通过，退出0，22:58:06 |
| 前端Lint | frontend目录`pnpm --config.verify-deps-before-run=false exec eslint src/api/usage.ts src/components/user/dashboard/dashboardBoards.ts src/components/user/dashboard/__tests__/dashboardBoards.spec.ts src/components/user/dashboard/__tests__/dashboardData.spec.ts src/api/__tests__/dashboardRequests.spec.ts src/views/user/__tests__/DashboardView.spec.ts src/__tests__/fixtures/dashboardProgressivePreview.ts` | 退出0 |
| i18n/类型/构建 | frontend目录依次运行相同pnpm前缀的`run check:i18n`、`exec vue-tsc -b`、`exec vite build --outDir <专用/private/tmp目录>` | 全部退出0，i18n 3测试通过；Vite构建12.18秒，保留既有chunk/Browserslist等警告 |
| 后端构建 | backend目录`CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -tags embed -ldflags '-s -w -X main.Version=0.2.17 -X main.Commit=<当前短SHA>-model-ranking-local -X main.BuildType=release' -o <专用/private/tmp目录>/sub2api ./cmd/server` | 退出0；本地Go实际为1.27.2 |
| 格式与既有改动 | gofmt、git diff --check及新增文件检查 | 无格式错误；执行前已有7个网关/WebSocket文件逐一SHA-256保持一致 |

SQLMock仅证明查询形态和绑定；核心业务事实由真实PostgreSQL测试证明。第一轮隔离测试因样例缺少必填request_id失败，补齐样例后重新执行通过，没有为测试修改生产数据模型。

## 真实数据库结果与开销比较

使用TestMain创建的独立PostgreSQL/Redis容器和testEntTx隔离事务，不在业务库造数。验证包括：门槛下一单位、恰好门槛、上一单位；多条单次低用量合计入榜；缓存创建/读取与零费用；requested_model聚合和历史model回退；另一用户和结束日期边界排除；15个合格模型及并列稳定顺序；普通查询仍返回全量。

同一事务、同一数据、相同用户与日期范围的日志：

| 查询 | 返回行数 | 序列化字节 | 本次观察耗时 |
| --- | --- | --- | --- |
| 原全量聚合 | 18 | 3431 | 454.542µs |
| 数据库排行 | 10 | 1907 | 449.5µs |

字节比较针对相同内部ModelStat结构；不是生产HTTP体积或生产速度承诺。单次小样本耗时仅记录，不断言稳定更快。底层仍需聚合时间范围内的基础记录。测试容器已由测试设施清理，没有遗留本任务容器。

## 本地运行更新与实际HTTP验证

按先后端、后前端顺序执行：

1. 更新前只读检查业务库schema_migrations，296项均已应用，按runner的TrimSpace/SHA-256规则全部一致，没有待执行迁移。本需求没有添加迁移。
2. 将当前checkout交叉构建为linux/arm64，备份原/app/sub2api，以新路径落盘后原子替换，再仅重启sub2api。健康检查HTTP200，运行文件SHA-256与本次产物一致。
3. 后端单元/真实数据库/健康与运行hash验证后，同步前端api/usage.ts与dashboardBoards.ts到现有frontend容器。未改容器配置或镜像。
4. 已登录本地页面的真实网络请求均为HTTP200，参数分别为week、month、lifetime，累计起始日期0001-01-01；当前登录test1，三组均无模型数据，页面正常显示空状态。
5. 使用该页面既有认证会话只读验证旧/新接口和无效周期：无效ranking_period得到400，三个周期的普通与排行调用均200、0项、101字节。没有修改密码、写入样例记录或切换用户。初始化环境中的登录凭据一次尝试返回401后不再重试，改用用户已有会话；没有输出或持久化任何令牌。

实际浏览器样本（同一周期每对请求使用相同日期/时区）：

| 周期 | 全量 rows/bytes/ms | 排行 rows/bytes/ms |
| --- | --- | --- |
| week | 0 / 101 / 26.4 | 0 / 101 / 15.1 |
| month | 0 / 101 / 13.2 | 0 / 101 / 13.8 |
| lifetime | 0 / 101 / 17.8 | 0 / 101 / 11.8 |

以上是当前无数据用户的连接证据，不用其耗时宣称性能提升。浏览器临时Network观测已禁用，页面仍保留在本地仪表盘。

## 剩余边界

- 非零数据的门槛/排序/Top10/字节减少已在真实隔离数据库验证；当前本地用户没有用量，实际用户的非零HTTP对账仍待确认。
- 生产数据量下的聚合扫描、数据库竞争、网络体积和加载耗时仍需真实环境测量；不从本地小样本推断生产加速比例。
- 后端构建包含当前checkout原有网关/WebSocket修改，文件未被本需求更改，这些功能不属于本次验收结论。
- 本地采用运行容器内文件更新，没有重建镜像；容器重建应以当前源码构建。未上线、未提交或推送。

后端产物：`/private/tmp/sub2api-backend-ranking.jpH2HB/sub2api`。
运行SHA-256：`cf3ccdba8de06ef96180370eafadea4368ced470f36b52df2833cbe4bd572507`。
后端原文件备份：`/private/tmp/sub2api-ranking-live-2lyhb4on`。
前端备份：`/private/tmp/sub2api-ranking-frontend-live-2hma6ci5`。
前端构建产物：`/private/tmp/sub2api-ranking-frontend.uwNYM0`。


## 只读验收审计结果

结论：通过（本地交付范围）。仅核对冻结Spec/Plan、实际代码和已有证据；未在审计中改实现、派发代理或重复运行测试。本节为审计完成后的结果记录。

### 验收对照

| 验收项 | 实现证据 | 验证证据 | 判定 |
| --- | --- | --- | --- |
| BR-AC-001 | 后端周期策略、仓储聚合HAVING、既有四项Tokens与requested回退 | 真实PostgreSQL周/月/累计边界、合并请求、缓存及免费样例 | 通过 |
| BR-AC-002 | SQL按总量与模型标识C排序、参数化LIMIT10和用户范围 | 至少15个合格模型、并列顺序及跨用户隔离的真实DB测试 | 通过 |
| BR-AC-003 | handler可选参数分流，旧查询ranking=nil，无效值400 | handler旧接口12项、DB全量18项、本地旧/新HTTP200及无效400、UsageView回归 | 通过 |
| BR-AC-004 | 前端单一周期枚举、ranking_period进入请求/去重key，删除业务筛选 | 6文件33测试、真实页面三个正确周期请求均200、当前用户空状态 | 通过 |
| BR-AC-005 | 新二进制hash一致、后端先更新再同步前端、服务健康 | 同数据18→10行、3431→1907字节；真实登录用户三组接口行数/字节/耗时记录 | 本地通过 |

### 阻塞缺口

无本地阻塞。SQLMock未被当作数据库业务验收，客户端纯映射测试明确不承担后端策略证明；生产数据耗时不以样例微秒比较替代。

### Test 环境验证

目标环境有非零用量用户的完整HTTP对账、生产数据规模下的累计聚合扫描/并发/网络与首屏耗时，仍需真实环境确认。本地当前test1无用量，不能作为非零生产对账证据。

### 剩余风险

后端构建包含当前checkout既有网关/WebSocket修改，未对其业务链路作本任务验收。当前为本地运行容器文件更新，镜像重建需使用当前源码。尚未上线、提交或推送。
