# 使用看板验证记录

## 2026-09-12：按用户追加要求统一样式与组件

用户要求“样式和组件改成和现有的风格一样”。本次调整只涉及前端呈现及组件组合，查询契约、后端聚合和真假零值规则沿用已确认规格。

- 原前端看板复用现有 `Select`（组合为多选）、`DataTable`、`Pagination`、`LoadingSpinner`、`Icon`，卡片、表单、按钮及页签直接使用既有 `card/input/btn/tabs/tab` 样式。窄屏结果沿用通用表格的卡片布局，保留排序入口。
- 新版前端复用 `AppButton`、`PageState`、`MonitorFilterMenu`，采用原有 `governance-card/resource-form-grid/resource-tabs/resource-table/resource-pagination`。为多选菜单增加搜索、空状态及底部插槽，默认调用方保持原行为。
- 图表沿用现有图表的字体、配色、网格及浮层提示样式，保留 API Key 系列、真实零值、灰色缺失标记和可聚焦时间段。修正了原前端深色选择器的作用域，确认图例、网格与缺失标记正确使用深色变量。

追加验证结果：

1. `pnpm --config.verify-deps-before-run=false --dir frontend test:run src/components/usage-board/__tests__ src/views/user/__tests__/UsageView.spec.ts src/views/admin/__tests__/UsageView.spec.ts`：25 项通过。
2. `pnpm --config.verify-deps-before-run=false --dir frontend2 test:run src/components/usage-board/__tests__ src/components/user/monitor/__tests__/monitor-panels.spec.ts src/views/user/__tests__/usage.spec.ts src/views/admin/__tests__/usage.spec.ts`：11 项通过，包含通用多选菜单原调用方回归。
3. 两套前端针对本次组件、页面、展示工具及 `MonitorFilterMenu.vue` 的 ESLint 检查均为 0 errors；`git diff --check` 通过。
4. 最终配色修正后，`pnpm_config_verify_deps_before_run=warn pnpm --dir frontend build` 和对应 `frontend2 build` 均成功。
5. 固定数据浏览器验证覆盖两个前端、普通用户/管理员四个入口：通用组件实际渲染、多密钥及分组选择、升序切换、每页 50 条、真假零值提示、明暗主题、375px 窄屏。原前端移动端的通用表格卡片和排序入口也已验证。
6. 最终深色复查确认原前端图例为 `rgb(229, 231, 235)`、网格为 `rgb(55, 65, 81)`、缺失标记填充为 `rgb(30, 41, 59)`；新版前端对应颜色从其既有主题变量取得。截图等待组件主题过渡结束，测试会话关闭了自动引导。

预览、结果和构建日志保存于 [usage-board-style-20260912](/Users/hhl/.codex/visualizations/2026/09/11/01a08fe2-fc1e-7e81-98a2-6d80b82f1d50/usage-board-style-20260912)。截图使用固定测试数据。

本轮没有重建或替换 13011/13012 对应的运行前端容器。此前冻结计划排除了为验证重建运行服务，同步运行容器仍需单独确认。

## 2026-09-12：独立用户菜单追加变更

用户追加要求普通用户只看使用看板，不看使用记录。已将看板设为独立菜单分组，并让普通用户旧 `/usage`、新版 `/app/usage` 兼容地址均渲染纯看板；管理员 `/admin/usage` 保留记录和看板。看板菜单不受 simple mode 隐藏条件影响。

追加验证：

- `pnpm --config.verify-deps-before-run=false --dir frontend2 test:run src/authz/__tests__/navigation.spec.ts src/router/__tests__/compatibility.spec.ts src/views/user/__tests__/usage.spec.ts`：导航与用量入口测试通过；兼容性测试仍有既有 `/admin/plugins` 路由缺失基线失败，与本次无关。
- `pnpm --config.verify-deps-before-run=false --dir frontend test:run src/router/__tests__/title.spec.ts src/router/__tests__/guards.spec.ts src/views/user/__tests__/UsageView.spec.ts src/views/admin/__tests__/UsageView.spec.ts`：60 项通过。
- 两套前端最终构建均通过；Docker Compose 仅重建 `frontend`、`frontend2`，后端未重启，两个容器均为 `healthy`。
- `GET http://localhost:13011/usage`、`GET http://localhost:13012/usage` 均返回 200 `text/html`。实际运行模块核对确认 13011 用户页面包含 `UsageBoardPanel` 和 `usage-board-tab`，13012 导航模块包含“使用看板”和 `usage-board` 路由。
- 本地运行页未登录时会按现有认证流程跳转登录；尚未使用真实账号提交登录。登录后应从侧栏“使用看板”进入，普通用户旧“使用记录”菜单不会出现。

## 原始实现验证

本地实现与计划内自动验证已完成。普通用户和管理员的真实 test 环境登录及完整服务链路尚未执行，不能将下述浏览器固定数据检查视为真实服务验收。

## 交付范围

- 后端：独立使用看板仓储、服务与处理器，接入 `/api/v1/usage/board`、`/api/v1/admin/usage/board`，通过 Wire 装配。仅新增读取查询，无数据库迁移。
- 前端：共享 `usageBoard.ts` 请求契约、`useUsageBoard.ts` 交互状态和展示工具；两套前端分别实现看板、SVG 图表和搜索多选组件，接入各自用户及管理员 usage 页面。
- 页面图例及表格采用 API Key 展示名称；普通用户仅查看本人记录，管理员个人入口仍为本人范围，管理入口为管理范围。
- 保留真实零 tokens/零费用记录；用 `observed/missing` 区分真实零值和无数据补零。日期、分组和密钥改变后，图表和表格使用同一响应重新展示。

## 已执行命令与结果

以下列出实际执行及补充验证结果；曾失败的组合运行明确标注原因，相关修正后的验证均取得退出码 0。后端命令在 `backend` 目录执行，前端 `--dir` 命令在仓库根目录执行。

| 验证对象 | 实际命令 | 结果 |
| --- | --- | --- |
| 服务逻辑 | `go test -tags=unit ./internal/service -run '^TestUsageBoard' -count=1` | 通过；完整矩阵、全局排序/分页、真假零值、跨年周、闰月、夏令时、非法参数、越权及失败处理 |
| PostgreSQL 聚合 | `CI=1 SUB2API_TEST_POSTGRES_IMAGE=postgres:16-alpine go test -tags=integration ./internal/repository -run '^TestUsageBoard' -count=1 -v` | 两项集成测试实际执行通过，未跳过；审核样例总量 170，覆盖同名密钥、历史分组、软删除、空分组、权限和时间边界 |
| 处理器和真实认证路由 | `go test -tags=unit ./internal/handler ./internal/server/routes -run 'UsageBoard' -count=1` | 两个包通过；使用真实 JWT/Admin 中间件，验证 401/403、个人范围和管理范围；用户存储为测试替身 |
| 依赖装配 | `go generate ./cmd/server` | Wire 生成成功，只增加看板依赖 |
| 后端编译 | `go build -o /tmp/sub2api-usage-board-server ./cmd/server` | 通过；没有启动或替换现有服务 |
| 共享前端状态 | `pnpm --config.verify-deps-before-run=false --dir frontend test:run src/api/__tests__/usageBoard.spec.ts src/composables/__tests__/useUsageBoard.spec.ts src/utils/__tests__/usageBoard.spec.ts` | 8 项通过；重复 ID 参数、日期转换、组合筛选、取消与过期响应、错误重试、候选分页 |
| 旧前端原页面回归 | `pnpm --config.verify-deps-before-run=false --dir frontend test:run src/components/usage-board/__tests__ src/views/user/__tests__/UsageView.spec.ts src/views/admin/__tests__/UsageView.spec.ts` | 原用户页 7 项、管理页 14 项通过；初次新组件测试因测试环境未启用生产 JIT 翻译配置失败，补齐测试配置后按下行复验 |
| 旧前端最终看板及窄屏几何 | `pnpm --config.verify-deps-before-run=false --dir frontend test:run src/utils/__tests__/usageBoard.spec.ts src/components/usage-board/__tests__` | 最终修改后 6 项通过；挂载真实看板与 SVG，覆盖真假零值、多选、排序、月份、空结果和错误重试 |
| 新前端页面及看板 | `pnpm --config.verify-deps-before-run=false --dir frontend2 test:run src/components/usage-board/__tests__ src/views/user/__tests__/usage.spec.ts src/views/admin/__tests__/usage.spec.ts` | 用户页 3 项及看板 4 项通过；管理页的 detached DOM 可见性断言随后改为挂载到 document，按下行复验 |
| 新前端管理入口 | `pnpm --config.verify-deps-before-run=false --dir frontend2 test:run src/views/admin/__tests__/usage.spec.ts` | 1 项通过；真实看板按管理范围请求，切换到原统计时隐藏，切回保留月份条件 |
| 新前端最终看板 | `pnpm --config.verify-deps-before-run=false --dir frontend2 test:run src/components/usage-board/__tests__` | 窄屏修正后 4 项通过 |
| 两套前端构建 | `pnpm_config_verify_deps_before_run=warn pnpm --dir frontend build`；`pnpm_config_verify_deps_before_run=warn pnpm --dir frontend2 build` | 最终修改后均通过；包括 TypeScript 编译，旧前端包括 3 项国际化键完整性检查 |
| ESLint | 下方两条具体命令；窄屏几何修正后另运行 `pnpm --config.verify-deps-before-run=false exec eslint src/utils/usageBoard.ts src/utils/__tests__/usageBoard.spec.ts --quiet` | 0 errors；保留既有页面格式 warnings，不进行无关格式重写 |

在 `frontend` 执行：

```sh
pnpm --config.verify-deps-before-run=false exec eslint src/components/usage-board src/api/usageBoard.ts src/api/__tests__/usageBoard.spec.ts src/composables/useUsageBoard.ts src/composables/__tests__/useUsageBoard.spec.ts src/utils/usageBoard.ts src/utils/__tests__/usageBoard.spec.ts src/views/user/UsageView.vue src/views/admin/UsageView.vue src/i18n/locales/zh/misc.ts src/i18n/locales/en/misc.ts --ext .vue,.ts --quiet
```

在 `frontend2` 执行：

```sh
pnpm --config.verify-deps-before-run=false exec eslint src/components/usage-board src/views/user/UsageView.vue src/views/admin/AdminUsageView.vue src/views/admin/__tests__/usage.spec.ts src/views/user/__tests__/usage.spec.ts --ext .vue,.ts --quiet
```

pnpm 11 默认会在执行脚本前尝试自动重装依赖。本次只通过命令参数/环境变量关闭自动安装或设为警告，继续使用已安装依赖；没有执行依赖清理、锁文件升级或包管理配置变更。国际化测试启用与生产 Vite 相同的 JIT 标志，未为测试修改生产国际化架构。

构建日志存在既有提示：pnpm 的旧配置字段提示、Browserslist 数据版本提示及旧前端大 chunk 提示。这些提示不影响命令退出成功，不代表已经验证生产容量。

## 浏览器验证

通过独立 `playwright-cli` 会话验证两套生产构建产物。API 返回固定测试数据，未连接真实业务后端；真实 SQL 聚合和鉴权分别由上表数据库及中间件测试验证。

| 前端 | 入口角色与路径 | 已验证行为 |
| --- | --- | --- |
| frontend | 普通用户 `/usage` | 日/周/月、折线/柱状、两个密钥与分组组合筛选、全局升降序请求、真实 0 和缺失提示、错误后重试、模块切换保留状态 |
| frontend | 管理员 `/admin/usage` | 同上 |
| frontend2 | 普通用户 `/usage`（兼容 `/app/usage`） | 同上 |
| frontend2 | 管理员 `/admin/usage` | 同上 |

四个入口均验证：默认日/折线、图表高于表格、7 日 × 2 密钥共 14 行、周 X 轴完整范围及部分日期提示、月输入值格式、503 错误不伪装成补零。

1280px 截图已检查。375px 首次检查发现单月柱子位于图表横向滚动区外；已调整共享图表几何，少量时间段使用实际可用宽度，长时间范围保留内部滚动。最终再次构建、执行相关组件/几何测试并复查四个入口：旧前端图表宽 309px，新前端 301px，两根月柱均在初始视野内，页面无横向溢出。响应式检查等待现有侧栏收起动画结束。

本机证据目录：[/Users/hhl/.codex/visualizations/2026/09/11/01a08fe2-fc1e-7e81-98a2-6d80b82f1d50/usage-board-validation](/Users/hhl/.codex/visualizations/2026/09/11/01a08fe2-fc1e-7e81-98a2-6d80b82f1d50/usage-board-validation)。包含 `browser-results.json`、浏览器检查脚本、构建日志、桌面截图及四个修正后的手机截图。

## 验收条件对照

| 条件 | 实现证据 | 有效验证证据 | 当前边界 |
| --- | --- | --- | --- |
| AC-001 入口与权限 | 四个 Usage 页面、用户/管理路由、`UsageBoardHandler` | 四入口浏览器检查、真实 JWT/Admin 中间件测试 | 真实 test 登录链路待确认 |
| AC-002 时间维度 | `normalizeUsageBoardQuery`、`usageBoardPeriods`、`useUsageBoard` | 服务与数据库边界测试、浏览器日/周/月检查 | 本地通过 |
| AC-003 多选与竞争 | 聚合 SQL 的密钥/分组条件、共享 composable | PostgreSQL 组合条件测试、延迟 Promise 竞争测试、浏览器多选 | 本地通过 |
| AC-004 用量与排序 | `UsageBoardService.Query`、tokens 列排序操作 | 数据库样例总量及分页测试、API 参数与页面测试 | 本地通过 |
| AC-005 名称与对账 | ID 分组、同名后缀、同一矩阵生成系列和行 | 同名密钥和全量对账测试、四入口图例检查 | 本地通过 |
| AC-006 真假零值 | `observed/missing`、SVG 标识、表格徽标 | 真实零费用数据库记录、缺失日期/全空组件测试、浏览器两类标记及 tooltip | 本地通过 |
| AC-007 越权隔离 | 服务端范围固定、选中密钥归属校验 | 混合合法/越权 ID、真实 JWT 角色路由、数据库用户过滤 | 真实 test 账号交叉访问待确认 |
| AC-008 错误与重绘 | 最新响应保护、图表类型枚举、错误重试区 | 请求竞争/取消、组件两种图表、四入口浏览器 503 与重试 | 本地通过 |
| AC-009 编译与兼容 | 共享请求层、独立 UI、最小 Wire/路由扩展 | 两套最终构建、受影响回归测试、ESLint | 本地通过 |

## 清理与外部待验证

- 两个临时预览监听进程已停止，14311/14312 均无监听；独立浏览器会话已关闭。
- 本任务集成测试创建的 PostgreSQL、Redis 和 Ryuk 容器均已清理，未停止原有服务。
- 没有提交、推送、部署或修改业务数据库；本地生成的临时后端二进制未作为服务运行。
- 需在用户 test 环境中部署对应代码后，用普通用户与管理员真实登录四个入口，核对自身/管理范围、真实密钥与分组、实际使用记录对账及错误恢复。
- 未进行生产规模性能测量。管理员密钥候选沿用最多 30 条的现有搜索接口，页面明确提示缩小搜索；聚合结果不做 Top N 截断。
