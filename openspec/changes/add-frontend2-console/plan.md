# frontend2 全量替换实施 Plan（已冻结）

计划基线：`spec.md` 的 FR-001～FR-008 与 AC-001～AC-011。计划正文冻结，只更新任务状态。

| 任务 | 状态 | 目标与文件范围 | 依赖 | 验收条件 | 验证方式 |
| --- | --- | --- | --- | --- | --- |
| P0 全量契约与差距矩阵 | 已完成 | 建立 `frontend2/docs/parity-matrix.md`；追踪 `frontend/src/router/index.ts`、`views/**`、`components/**`、`api/**`、stores、功能开关和 i18n 到 `frontend2` 的实现证据；模型与价格额外区分“已有但未消费”和“契约真实缺失” | Spec | AC-001、AC-002、AC-011 有逐项载体；当前缺口标记为 `缺失/部分`，不得用文件数量代替功能项 | 静态核对路由、API 导出、页面字段/事件；对照模型广场 DTO、渠道/分组定价结构与管理表单；审阅矩阵无未归属项 |
| P1 共享运行时与兼容骨架 | 已完成 | 在 `frontend2` 的 Vite/TS 配置建立现有 `frontend/src/api/**`、共享类型/常量的构建期复用；移除精简 API 重复实现，并补齐 stores、router、authz、i18n、通知/弹窗、feature flags、布局与旧路径 alias/redirect | P0 | FR-001、FR-002、FR-007；共享请求层唯一、会话刷新、权限、开关、语言和旧深链具备统一基线 | 共享 API 原测试 + frontend2 接入测试；静态检查无独立客户端或非白名单直连；浏览器验证三种身份与网络请求 |
| P2 管理员用户管理纵切 | 已完成 | 新建专用 `frontend2/src/views/admin/UsersView.vue` 和用户管理 UI/view model；直接消费共享 `frontend/src/api/admin/users.ts`，移除该路由对 `CollectionView` 的依赖 | P1 | FR-004 全部能力；服务端查询/分页/排序、列配置和全部写操作等价 | 复用 API 契约测试、组件交互测试；管理员浏览器逐项对照，普通用户无请求 |
| P3 普通用户 API 与用量 | 已完成 | dashboard、keys、usage/errors、models/available channels、monitor、batch image 的组件和页面；模型与价格完整消费共享 `/model-plaza` 契约 | P1 | FR-003、FR-008 对应能力，尤其 Key 全字段、用量服务端查询/导出/错误详情，以及模型价格现有字段零丢失 | API/组件测试；真实账号创建-编辑-Key、筛选-分页-导出和详情链路；模型价格响应字段对照测试 |
| P4 普通用户账务与账户 | 已完成 | subscriptions、purchase/payment providers、orders、redeem、affiliate、profile/security、custom/legal 页面与回调 | P1 | FR-002、FR-003、FR-007 对应能力；支付和 OAuth 不依赖旧入口 | 契约测试；测试环境完成支付沙箱/回调、兑换、身份绑定和安全设置 |
| P5 管理员资源管理 | 已完成 | groups、channels/pricing/monitor、accounts、proxies 的专用组件和页面；完整复用现有定价配置，承接 P0 已证明缺失的模型展示资料配置 | P1、P2 公共表格/表单 | FR-005、FR-008 对应资源全部读写与专项动作；新增模型字段只能来自 P0 缺口证据并具备管理员入口 | API 契约测试；管理员对照创建/编辑/批量/测试/导入导出/状态链路；模型字段迁移、回滚和未配置兼容测试 |
| P6 管理员商业化管理 | 已完成 | subscriptions、orders/dashboard/plans、redeem、promo、affiliates 三类记录 | P1、P2 公共表格/表单 | FR-005 商业化状态与写操作等价 | API/组件测试；浏览器对照筛选、分页、详情和状态流转 |
| P7 管理员治理与设置 | 已完成 | admin dashboard/ops、announcements、backup/data management、settings、audit、usage、risk-control、prompt-audit | P1、P2 公共表格/表单 | FR-006；系统设置不再是只读摘要，治理页面无旧端兜底 | 分区契约/组件测试；管理员浏览器逐页保存、恢复、筛选与导出验证 |
| P8 公共、安装与认证专项 | 进行中 | setup、home、model plaza、key usage、register/verify/reset、全部 OAuth 回调、TOTP/Passkey 登录态页面 | P1、P4 认证组件 | FR-001、FR-002、FR-007 全部公开和认证路由 | 路由/认证集成测试；匿名浏览器与各提供商测试环境验证 |
| P9 全量回归与切流准备 | 未开始 | 修复矩阵剩余项；响应式、主题、a11y、错误态、性能；仅生成本地部署切换候选配置 | P2～P8 | AC-001～AC-011 全部通过；矩阵 100%，无旧端运行时依赖 | 下述命令 + 两角色全路由 E2E + test 环境外部回调/支付验证 + acceptance-audit |

## 实施顺序

严格按 P0 → P1 → P2 执行；随后 P3/P4/P5/P6/P7/P8 按表中依赖推进；P9 最后执行。用户管理作为首个业务纵切，用于验证新的表格、筛选、表单、详情和危险操作模式，后续模块只复用通用交互基础，不复用被削弱的业务页面。

## 每个模块的完成定义

1. 矩阵中的字段、入口、读写动作、权限、状态和异常均有实现文件/符号。
2. 页面直接消费唯一共享 API 模块；旧认证页未公开函数的 OAuth 请求只可按冻结白名单调用共享 `apiClient`，其余页面不得新增 endpoint；路径、方法、参数、枚举和错误语义保持原实现。
3. 页面具备 loading、empty、error、权限拒绝、重复提交保护和必要确认。
4. 组件/契约测试覆盖核心行为；浏览器验证使用真实后端响应，不以静态渲染代替。
5. 对应矩阵项从 `缺失/部分` 更新为 `已通过`，并记录验证证据。

## 本地验证命令

```bash
pnpm --dir frontend2 run lint:check
pnpm --dir frontend2 run typecheck
pnpm --dir frontend2 run test:run
pnpm --dir frontend2 run build
git diff --exit-code -- frontend
```

## Test 环境验证边界

- 真实 OAuth 提供商回调、邮箱验证码、Passkey/TOTP、支付提供商沙箱及回调。
- 管理员账号的高风险写操作与生产相同权限策略。
- 旧域名/反向代理下的 SPA fallback、静态资源 base、回调 URL 和旧深链。

上述外部验证未完成前，P9 不得标记为 `已完成`，也不得宣称 `frontend2` 可以替代 `frontend`。
