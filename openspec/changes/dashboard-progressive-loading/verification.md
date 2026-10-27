# 仪表盘按需加载与模型看板验证记录

日期：2026-10-26（Asia/Taipei）。基线为已确认并冻结的 Spec 与 Plan。以下结果仅证明注明的本地范围，不代表线上部署或生产数据验收。

## 实现与范围

展示和数据依赖同源，周/月趋势独立展示，Token排行使用完整series并复用对应请求。优先请求全部结束且nextTick提交渲染后，才加载累计密钥统计与三个模型周期。六个排行共用815px固定列表视口，完整渲染、不截断数组、可聚焦并使用键盘滚动。支持失败局部重试、名单补全、跨日期快照、取消与过期响应保护。

本次只改frontend及本需求文档，未改SQL、后端、frontend2、依赖清单或锁文件；未提交、未推送、未上线。执行前已有7个后端文件的SHA-256在验证后逐项一致。

## 已执行命令和实际结果

cwd均为`frontend`。本机pnpm 11首次执行前尝试自动install并因非TTY中止，其后所有pnpm调用均增加`--config.verify-deps-before-run=false`，使用现有依赖。下表中的命令均接在此前缀后。

| 对象 | 命令 | 最终有效结果 |
| --- | --- | --- |
| T1 | `exec vitest run src/components/user/dashboard/__tests__/dashboardBoards.spec.ts src/components/user/dashboard/__tests__/dashboardTrends.spec.ts` | 2文件13测试通过，退出0；含Intl不可用的UTC回退修正后验证，22:15:53 |
| T2 | `exec vitest run src/api/__tests__/client.spec.ts src/api/__tests__/usageBoard.spec.ts src/api/__tests__/dashboardRequests.spec.ts src/components/user/dashboard/__tests__/dashboardData.spec.ts` | 4文件39测试通过，退出0，22:11:24 |
| T3 | `exec vitest run src/components/user/dashboard/__tests__/UserDashboardTrends.spec.ts` | 1文件5测试通过，退出0 |
| T4 | `exec vitest run src/components/user/dashboard/__tests__/DashboardRankingSection.spec.ts src/components/user/dashboard/__tests__/UserDashboardStats.spec.ts src/components/user/dashboard/__tests__/UserDashboardModels.spec.ts` | 3文件8测试通过，退出0，22:15:13 |
| T5 | `exec vitest run src/composables/__tests__/useDashboardBoards.spec.ts` | 1文件7测试通过，退出0，22:10:50 |
| T6 | `exec vitest run src/views/user/__tests__/DashboardView.spec.ts` | 1文件3测试通过，退出0，22:17:02 |
| 兼容回归 | `exec vitest run src/views/user/__tests__/UsageView.spec.ts src/__tests__/integration/usage-reasoning-effort.spec.ts src/composables/__tests__/useUsageBoard.spec.ts` | 3文件18测试通过，退出0，22:18:55 |
| i18n | `run check:i18n` | 1文件3测试通过，退出0，22:18:57 |
| 类型检查 | `exec vue-tsc -b` | 退出0，无类型错误 |
| 构建 | `exec vite build --outDir /private/tmp/sub2api-dashboard-progressive-build.ic4ORJ` | 1089 modules transformed，12.41秒，退出0 |
| Lint | `exec eslint <Plan T7列出的26个TS/JS/Vue文件>` | 退出0；QA脚本修改后执行`exec eslint src/__tests__/browser/dashboardProgressive.qa.js`再次通过 |

最终共16个测试文件、96项测试通过，没有运行无关全库测试。tsconfig排除测试文件，因此实际Vitest执行和类型检查分别列证据。构建产物在上述专用临时目录，没有覆盖默认backend/internal/web/dist。

页面集成测试只替换AppLayout外壳与最终HTTP Adapter；真实composable、生产请求Adapter、趋势和排行均实际连接。首次发现AppLayout间接i18n Mock缺项后改为在模块入口替换外壳；错误样例使用真实code/message响应语义。先前失败不计入最终通过数。

构建保留项目既有的Browserslist陈旧、混用静态/动态导入、大chunk及Node弃用警告，没有构建错误，也未为消除警告升级依赖或扩大重构。

## 真实浏览器布局验证

使用已安装playwright-cli，真实composable和展示组件，注入25条受控数据，无后端业务调用。执行：

```text
VITE_API_BASE_URL=/api/v1 VITE_DEV_PROXY_TARGET=http://127.0.0.1:1 pnpm --config.verify-deps-before-run=false exec vite --host 127.0.0.1 --port 13010 --strictPort
PWTEST_DAEMON_SESSION_DIR=/private/tmp/sub2api-dashboard-playwright playwright-cli -s=dashboard-progressive open http://127.0.0.1:13010/src/__tests__/fixtures/dashboardProgressivePreview.html
PWTEST_DAEMON_SESSION_DIR=/private/tmp/sub2api-dashboard-playwright playwright-cli -s=dashboard-progressive run-code --filename=src/__tests__/browser/dashboardProgressive.qa.js
```

最终脚本退出0，返回passed=true、runtimeErrors=[]。首次浏览器启动受沙箱缓存/进程限制，改为临时会话目录并取得浏览器启动权限后完成。首次QA对End滚动等待不足，测得最终scrollTop=205后，将断言改为等待最大滚动位置，没有修改产品代码。

| 检查对象 | 实测结果 |
| --- | --- |
| 1440×1000 | 六个列表高度均815px；各25项，初始完整可见20行；scrollHeight=1020；End滚动至204–205，末项可达 |
| 390×844 | 六个列表高度均815px；换行后完整可见14行；scrollHeight=1420；End滚动至604–605，末项可达；无页面横向溢出 |
| 加载、空、错误、成功 | 两个宽度下六个列表高度始终815px |
| 明暗主题 | 实际切换根节点dark class，并检查计算背景色改变；两个宽度、两个主题均保存截图 |
| 键盘、运行时 | 六个区域可聚焦并以End滚到末项；无pageerror |

测量JSON与截图保存在仓库忽略目录`output/dashboard-progressive-loading/`：`browser-measurements.json`、`models-1440-light.png`、`models-1440-dark.png`、`models-390-light.png`、`models-390-dark.png`。CLI快照和日志已移入同目录的`playwright-traces/`，未留下frontend/.playwright-cli未跟踪目录。

本任务的浏览器会话与13010 Vite均已关闭；清理Vite时核对了监听PID和cwd，在沙箱阻止信号后取得权限再停止，没有停止其他服务。

## 本地运行环境更新

用户明确要求打开本地测试并执行实现，已同步到正在运行的`sub2api-frontend`：

- 本地页面`http://127.0.0.1:13011/dashboard`，后端健康检查`http://127.0.0.1:13000/health`。
- 该容器没有源码挂载，工作目录`/workspace/frontend`。先备份原src，再通过tar流只同步本次12个生产源码文件。没有改后端、数据库、镜像或环境配置。首次docker cp到tmpfs未被exec看到，改为stdin tar流后成功。
- 运行中的DashboardView编译模块已含UserDashboardModels与useDashboardBoards。已在用户真实浏览器确认「模型看板」以及当周、当月、累计三个标题，并将页面停在模型区域。
- 当前登录test1，没有模型用量；三栏为明确空状态，无可见请求错误，没有写入样例业务数据或切换用户。
- 这是本地运行容器同步，不是镜像重建或线上发布。重新创建容器时需从当前checkout正常构建。

## 外部待验证事项

- 当前本地用户无用量，尚未以真实非零业务记录对账缓存Tokens、零费用记录和历史数据归属。前端受控响应、现有SQL源码与真实数据库验收分别限定结论。
- 本地累计模型卡片正常进入空状态，未出现日期请求错误；生产数据库的日期绑定、生产数据量及并发查询竞争仍待验证。
- 未采集线上网络瀑布或生产耗时，不声称线上首屏提速百分比。
- API Key按现存密钥归属，模型按usage_logs.user_id归属，保留历史差异，不承诺两个累计总量相等。

本地运行源码备份：`/private/tmp/sub2api-dashboard-runtime-backup-ogzd7tao`。

## 只读验收审计结果

结论：通过（本地交付范围；外部真实数据验收独立保留）。此结果在只读审计结束后记录，审计没有修改实现或重复运行测试。

### 验收对照

| 验收项 | 实现证据 | 验证证据 | 判定 |
| --- | --- | --- | --- |
| AC-001 | DashboardView即时渲染sections、useDashboardBoards优先阶段 | T5调用顺序、T6真实DOM/HTTP日志 | 通过 |
| AC-002 | 各资源独立状态与增量提交 | T3独立卡片、T5单项完成、T6失败隔离 | 通过 |
| AC-003 | 同源定义、规范化key、响应式reconcile | T1依赖解析、T5移除/重排/新增和取消 | 通过 |
| AC-004 | 全优先结束后nextTick推进、空组处理 | T5失败/超时/空组、T6延后调用日志 | 通过 |
| AC-005 | 共享815px视口及全量items | T4真实DOM、T7两宽度高度/20行/末项测量 | 通过 |
| AC-006 | 模型请求日期/时区、原始total_tokens与稳定排序 | T1日期排序、T2最终HTTP配置、T4/T6展示、T7主题布局；既有模型聚合源码保留零费用记录，生产非零对账另待验 | 本地通过 |
| AC-007 | 共享retry、补全依赖与主体依赖分离 | T1按ID合并、T4事件、T5去重、T6失败补齐 | 通过 |
| AC-008 | AbortController、资源/调度版本、卸载保护 | T2真实在途信号、T5迟到响应、T6页面卸载 | 通过 |
| AC-009 | 一次日期快照、重试不重建范围 | T1时区日期、T5跨日与重试参数 | 通过 |
| AC-010 | 完整series及当前周期、稳定密钥ID | T1超过1000单元/分页rows、T4完整25项和零值 | 通过 |

### 阻塞缺口

无本地阻塞。没有用构建、简化假页面或被Mock掉的调度算法替代行为验收；浏览器受控数据仅证明交互与布局。

### Test 环境验证

登录目标部署版本，以真实非零用量核对请求模型、缓存和零费用Tokens、历史归属；测量真实网络瀑布、累计扫描耗时与查询竞争。当前本地test1空数据无法完成此业务对账。

### 剩余风险

本地容器源码同步不等于镜像重建，重建时应由当前checkout构建；生产尚未部署。现有构建警告不影响本次通过，但没有在本范围内处理。


## 追加验证：模型用量门槛和前10名（2026-10-26）

用户明确要求后，模型看板改为：周总Tokens严格大于1,000,000、月/累计严格大于100,000,000，筛选后按用量降序及模型标识稳定排序，各取前10名；空状态明确为无符合条件模型。该次规则覆盖前述初版模型展示全部25条的行为，API Key全量排行不变。

- `pnpm --config.verify-deps-before-run=false -C frontend exec vitest run src/components/user/dashboard/__tests__/dashboardBoards.spec.ts src/components/user/dashboard/__tests__/UserDashboardModels.spec.ts src/views/user/__tests__/DashboardView.spec.ts`：3文件12测试通过，退出0（22:37:06）。覆盖严格边界、每个模型独立门槛、排序后截取、零费用高用量模型及真实页面连接。
- 对本次7个受影响TS/JS/Vue文件执行ESLint，退出0。未重复执行全量构建，前述构建结果仅对应初版。
- 更新预览样例和QA脚本后，真实浏览器在1440与390两个宽度下均通过：API Key三个排行各保留25条，模型三个排行各10条；两主题、状态等高及运行时检查通过。原始结果：`output/dashboard-progressive-loading/model-threshold-measurements.json`。模型截图已更新为当前前10名规则。
- 模型定义及空状态两个生产源码文件已同步到现有13011容器；读取运行中编译模块确认存在新门槛常量、前10名限制及新说明文字。运行源码备份：`/private/tmp/sub2api-model-threshold-5neeqmrw`。
- 本次临时浏览器和13010预览服务已关闭，用户的13011服务保留运行。无SQL或接口变更，未推送或上线。
