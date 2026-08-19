# frontend → frontend2 功能等价矩阵

> 状态只允许：`缺失`、`部分`、`待验证`、`已通过`。只有实现证据和有效验证证据同时存在时才能标记 `已通过`。

## 当前审计摘要（2026-08-18）

- `frontend`：55 个非测试 API 源文件、16 个管理员页面、20 个普通用户页面、12 个认证页面。
- `frontend2` 已完成共享 API、鉴权/权限、功能开关、旧路径兼容、公共/认证页、全部普通用户域和全部管理员业务域；早期通用查询页与临时适配器已经移除。
- P2～P8 的代码实现已收口；P9 正在完成本地验证。国际化按用户当前指示暂缓，真实 OAuth、邮件、Passkey/TOTP、支付沙箱和高风险管理写操作由用户在 test 环境验收。

## 公共、安装与认证

| 参考路由/能力 | frontend2 目标 | 当前状态 | 关键缺口 | 实现证据 | 验证证据 |
| --- | --- | --- | --- | --- | --- |
| `/setup` 安装向导 | 原路径兼容 | 已通过 | 无；数据库/Redis 测试、安装、重启等待和完成跳转均已迁移 | `views/public/SetupView.vue` | 公共流程测试；浏览器验证安装完成重定向与错误恢复 |
| `/home`、`/` 首页 | `/` + `/home` 兼容 | 已通过 | 无；公开设置、公告、品牌、自定义 HTML 和功能入口均已迁移 | `views/public/HomeView.vue` | 首页组件测试；匿名浏览器五档宽度验证 |
| `/model-plaza` | `/pricing` + 旧路径兼容 | 已通过 | 无；完整字段、筛选、价格解释和功能开关均复用现有契约 | `views/public/PricingView.vue`、`features/pricing/**` | 3 项价格字段测试；匿名浏览器验证 |
| `/key-usage` | 原路径兼容 | 已通过 | 无；公开 Key 查询、统计、每日明细和无效/受限状态均已迁移 | `views/public/KeyUsageView.vue` | 公共流程测试；匿名浏览器验证 |
| `/legal/:documentId` | 原路径兼容 | 已通过 | 无；动态协议、管理员合规内置文档、Markdown 净化、加载/空/错状态和公共返回入口均已迁移 | `views/public/LegalDocumentView.vue` | 2 项组件测试；浏览器验证服务条款与管理员合规深链 |
| `/custom/:id` | 原路径兼容 | 已通过 | 无；user/admin 可见性、排序入口、安全 SVG 图标、动态标题、Markdown/目录/图片/复制和参数化 iframe 均已迁移 | `views/user/CustomPageView.vue`、`components/layout/ConsoleShell.vue` | 3 项组件测试；浏览器验证桌面二级入口、Markdown、复制和 iframe 参数 |
| `/login` | `/login` | 待验证 | 代码已覆盖密码、三类验证码、OAuth、TOTP、Passkey、redirect 和异常恢复；真实提供商待 test 环境验收 | `views/auth/LoginView.vue`、`components/auth/**` | 认证组件测试；本地登录与服务端 `/auth/me` 身份校准验证 |
| `/register`、`/email-verify` | 原路径兼容 | 待验证 | 代码已覆盖注册开关、验证码、邀请/促销、邮箱策略与验证恢复；真实邮件待 test 环境验收 | `views/auth/{RegisterView,EmailVerifyView}.vue` | 6 项认证流程测试 |
| `/forgot-password`、`/reset-password` | 原路径兼容 | 待验证 | 代码已覆盖找回、签名链接、过期和重复使用恢复；真实邮件待 test 环境验收 | `views/auth/{ForgotPasswordView,ResetPasswordView}.vue` | 认证流程测试；生产路由构建通过 |
| `/auth/callback` 及 GitHub/Google | 原路径兼容 | 待验证 | 代码已覆盖登录/绑定分流、账户采用/创建和 redirect 恢复；真实 OAuth 待 test 环境验收 | `views/auth/OAuthProviderCallbackView.vue` | 3 项 OAuth 回调测试 |
| LinuxDo/微信/钉钉/OIDC 回调与补全 | 全部原路径兼容 | 待验证 | 代码已覆盖专项交换、邮箱补全和支付授权恢复；真实提供商待 test 环境验收 | `views/auth/{OAuthProviderCallbackView,WechatPaymentCallbackView}.vue` | OAuth/微信回调测试；全部旧路径兼容测试 |

## 普通用户

| 参考路由/能力 | frontend2 目标 | 当前状态 | 关键缺口 | 实现证据 | 验证证据 |
| --- | --- | --- | --- | --- | --- |
| `/dashboard` | `/app/dashboard` + alias | 已通过 | 无；账户刷新、全部指标、实际/标准消费、平台归属/额度、日期/粒度、趋势、模型、近期调用、CSV 与快捷下钻均已迁移 | `views/user/DashboardView.vue`、`views/user/dashboard/**` | 4 项模型/页面测试；浏览器验证账户刷新、平台差额、额度停用/重置、日期/粒度、CSV 和快捷入口 |
| `/keys` | `/app/keys` + alias | 已通过 | 无；服务端查询/排序/分页、列配置、CRUD/复制/启停、分组/IP、总额与周期额度、到期/重置、批量用量和使用指引均已迁移 | `views/user/KeysView.vue`、`components/user/keys/**`、`features/user/keys/model.ts` | 6 项模型/页面测试；浏览器验证创建、全字段编辑、筛选/排序/分页、列配置、复制/启停/删除和用量详情 |
| `/usage` | `/app/usage` + alias | 已通过 | 无；日期/Key/模型/分组/请求/流式/计费筛选、服务端排序分页、统计/分布/趋势、列配置、CSV、错误列表与详情均已迁移 | `views/user/UsageView.vue`、`components/user/usage/**`、`features/user/usage/model.ts` | 6 项模型/页面测试；浏览器验证筛选、排序、分页、列配置、CSV、用量与错误详情 |
| 模型与价格（共享 `/model-plaza` 契约） | `/app/models` | 已通过 | 无；P3 用户态已完整展示全部已有计费字段、阶梯/档位、官方参考价、倍率和价格解释 | `views/user/ModelsView.vue`、`features/pricing/**` | 3 项字段零丢失测试；浏览器逐项核对筛选、展开、价格字段和倍率 |
| `/available-channels` | `/app/models/available` + alias | 已通过 | 无；可用分组/模型/平台、上下文能力、账号倍率、生效价格范围、筛选与价格详情均已迁移 | `views/user/AvailableChannelsView.vue`、`features/user/channels/model.ts` | 5 项模型/页面测试；浏览器核对筛选、分组展开和完整价格弹窗 |
| `/monitor` | `/app/monitor` + alias | 已通过 | 无；V1 的 7/15/30 天状态和详情、V2 的时间窗/自动刷新/趋势/矩阵/模型/错误/用户维度与下钻均已迁移 | `views/user/MonitorView.vue`、`components/user/monitor/**`、`features/user/monitor/model.ts` | 6 项模型/组件测试；浏览器分别验证 V1/V2 模式、筛选、缩放、错误展开和下钻 |
| `/batch-image`、`/docs/batch-image` | `/app/batch-image` + aliases | 已通过 | 无；能力 Key/模型选择、完整提交、跨 Key 作业查询、父子重试、取消、ZIP/单图下载、删除、预览和 Agent 指南均已迁移 | `views/user/BatchImageView.vue`、`components/user/batch-image/**`、`features/user/batch-image/model.ts` | 10 项模型/页面测试；浏览器验证提交、轮询、取消、失败项重试、恢复标识、预览、下载、删除和指南 |
| `/subscriptions` | `/app/subscriptions` + alias | 已通过 | 无；全部历史状态、有效期、分组/平台/倍率、高峰倍率、日周月窗口与续订入口均已迁移 | `views/user/BillingView.vue`、`features/user/billing/model.ts` | 4 项模型/页面测试；浏览器核对摘要、额度进度、状态与续订下钻 |
| `/purchase` | `/app/purchase` + alias | 已通过 | 无；余额/套餐、币种/换算、方式限额、费率、下单、二维码/跳转/弹窗、微信 JSAPI/OAuth、移动降级、轮询与恢复均已迁移 | `views/user/PaymentView.vue`、`features/user/payment/**`、`components/user/payment/**` | 11 项模型/页面/状态测试；浏览器创建真实模拟订单并验证二维码、倒计时、轮询和取消 |
| `/orders` | `/app/orders` + alias | 已通过 | 无；服务端状态筛选/分页、详情、继续支付、取消、可退款提供商和退款申请均已迁移 | `views/user/UserOrdersView.vue` | 2 项页面测试；浏览器验证筛选、详情、取消和退款入口 |
| `/payment/qrcode`、`result`、`stripe`、`airwallex`、`stripe-popup` | 全部原路径兼容 | 已通过 | 无；各提供商加载/确认、公共签名恢复、弹窗消息桥接、倒计时/轮询和成功/失败/取消路径均已迁移 | `views/user/{PaymentQRCodeView,PaymentResultView,StripePaymentView,AirwallexPaymentView,StripePopupView}.vue`、`views/auth/WechatPaymentCallbackView.vue` | 9 项结果/状态/微信回调测试；生产构建包含全部独立路由；真实提供商沙箱留在 P9 外部验证 |
| `/redeem` | `/app/redeem` + alias | 已通过 | 无；余额/并发/订阅兑换、账户刷新、完整结果、历史与管理员调整记录均已迁移 | `views/user/RedeemView.vue` | 2 项页面测试；浏览器验证记录、提交与反馈 |
| `/affiliate` | `/app/affiliate` + alias | 已通过 | 无；邀请码/链接复制、比例/冻结/可转余额、受邀用户和返利转账均已迁移 | `views/user/AffiliateView.vue` | 2 项页面测试；浏览器核对统计、列表、复制与转账 |
| `/profile` | `/app/profile` + alias | 已通过 | 无；旧页可见的头像、资料、通知邮箱/阈值、全部身份绑定、密码、TOTP 与 Passkey 管理均已迁移 | `views/user/ProfileView.vue`、`components/user/profile/**`、`features/user/profile/model.ts` | 7 项模型/组件测试；浏览器验证资料、通知、TOTP 完整启用及 Passkey 列表；全会话吊销仍按 FR-002 归 P8 |

### 模型与价格字段审计

| 数据能力 | 现有来源 | frontend2 当前消费 | 判定 |
| --- | --- | --- | --- |
| 分组、模型标识、平台、基础描述 | `/model-plaza` | 完整映射和筛选 | 已完整消费 |
| token/按次/图片/视频计费模式 | 渠道定价与分组定价 | 按后端计费模式分别展示 | 已完整消费 |
| 输入、输出、缓存写入、缓存读取、图片输入/输出、单次价格 | `channel_model_pricing` | 全字段保留并在价格详情中展示 | 已完整消费 |
| token 区间、按次/图片档位 | `channel_pricing_intervals` | 区间和档位完整展示 | 已完整消费 |
| 官方参考价与 1h 缓存写入参考价 | `/model-plaza.official_pricing` | 官方参考字段完整展示 | 已完整消费 |
| 用户专属倍率、图片独立倍率、高峰倍率、专属可见性 | `/model-plaza` 分组字段 | 分倍率语义和可见性完整展示 | 已完整消费 |
| 模型展示名、介绍、能力标签、展示排序和独立可见性 | 未发现稳定模型展示资料结构 | 未消费 | 真实契约缺口；仅在新版信息架构需要时按 FR-008 增加管理员配置 |
| 业务售价和计费解析 | Group → Channel → 官方目录 → fallback 的现有解析链 | 不应在前端重算来源优先级 | 必须复用，不新增第二套价格账本 |

## 管理员

| 参考路由/能力 | frontend2 目标 | 当前状态 | 关键缺口 | 实现证据 | 验证证据 |
| --- | --- | --- | --- | --- | --- |
| `/admin/dashboard` | 原路径 | 已通过 | 无；规模/收入/账户健康/实时负载、时间范围、请求趋势、模型/用户/分组/Key 分布排行和用量下钻均已迁移 | `views/admin/DashboardView.vue` | 浏览器验证全部指标与排行加载、日期范围和下钻入口；共享 dashboard 请求日志 |
| `/admin/users` | 原路径专用页 | 已通过 | 无；服务端筛选/排序/分页、列配置、CRUD、属性、批量限额、分组与倍率、Key、余额/流水、平台额度和统计均已迁移 | `views/admin/UsersView.vue`、`components/admin/users/**`、`features/admin/users/model.ts` | 7 项用户管理单元/组件测试；管理员浏览器逐项读写与共享请求日志；普通用户直达及跨标签降权均无管理请求 |
| `/admin/groups` | 原路径专用页 | 已通过 | 无；CRUD/复制/启停/排序、模型候选与 Live 能力、完整定价、统计/Key、复合路由、盈利与用户倍率/RPM 覆盖均已迁移 | `views/admin/GroupsView.vue`、`components/admin/groups/**`、`features/admin/resources/group.ts` | 资源模型/组件/页面测试；浏览器验证创建编辑、候选模型、Live、详情、复合路由、用户覆盖和排序 |
| `/admin/channels`、`/admin/channels/pricing` | 专用页 | 已通过 | 无；渠道 CRUD/复制、平台协议、完整模型定价、目录参考价、模型同步、分组绑定和状态均已迁移 | `views/admin/ChannelsView.vue`、`components/admin/channels/**`、`components/admin/resources/ChannelPricingEditor.vue` | 资源模型/组件/页面测试；浏览器验证全字段编辑、模型同步、参考价和状态链路 |
| `/admin/channels/monitor` | 原路径 | 已通过 | 无；监控与模板 CRUD/复制/执行/历史/应用/关联及全部探测参数均已迁移 | `views/admin/ChannelMonitorView.vue`、`components/admin/monitor/**` | 资源组件/页面测试；浏览器验证监控、历史、立即执行、模板应用与编辑 |
| `/admin/accounts` | 原路径 | 已通过 | 无；多平台全字段 CRUD/复制/批量、创建与重授权 OAuth、RT/SSO/密码批量授权、测试/配额/用量/模型/定时测试、CRS/Codex/PAT、导入导出、Ollama、计费探测和运行时规则均已迁移 | `views/admin/AccountsView.vue`、`components/admin/accounts/**`、`features/admin/resources/account.ts` | 账号模型/组件/页面测试；浏览器验证编辑、OAuth、批量授权、工作台全部标签、CRS、PAT、批量编辑和规则库 |
| `/admin/proxies` | 原路径 | 已通过 | 无；CRUD/启停、完整回退与到期字段、URL 复制、关联账号/统计、单条与批量连接/质量检查、批量创建删除和导入导出均已迁移 | `views/admin/ProxiesView.vue`、`components/admin/proxies/**`、`features/admin/resources/proxy.ts` | 代理模型/页面测试；浏览器验证创建、回退、诊断、复制、批量建号/测试/质量和 1024px 布局 |
| `/admin/subscriptions` | 原路径专用页 | 已通过 | 无；服务端用户/状态/分组/平台筛选、排序分页、列配置、详情/进度、单人/批量发放、正负有效期调整、分窗口额度重置、撤销与恢复均已迁移 | `views/admin/SubscriptionsView.vue`、`features/admin/commerce/model.ts` | 商业化模型/组件 9 项测试；浏览器验证详情、批量发放、延期、日周窗口重置、撤销与恢复 |
| `/admin/orders/dashboard`、`/admin/orders`、`/admin/orders/plans` | 三个专用工作区 | 已通过 | 无；7/30/90 天统计、多维订单筛选分页/详情/审计、取消/重试/普通与强制退款、支付配置及渠道/Provider/计划完整 CRUD 均已迁移 | `views/admin/{PaymentDashboardView,OrdersView,PaymentSetupView}.vue`、`components/admin/commerce/**` | 商业化模型/组件 9 项测试；浏览器验证时间窗、订单全部状态动作、配置保存及三类资源创建/启停；1024px 布局通过 |
| `/admin/redeem`、`/admin/promo-codes` | 两个专用页 | 已通过 | 无；兑换码统计/生成/筛选/详情/复制/批量更新删除/过期/导出，以及促销码查询/CRUD/规则状态/注册链接/使用记录均已迁移 | `views/admin/{RedeemCodesView,PromoCodesView}.vue` | 浏览器验证生成结果、批量备注、CSV、促销码创建/停用和使用记录；完整 182 项测试与生产构建通过 |
| `/admin/affiliates/*` | 三类记录共享专用页 | 已通过 | 无；邀请/返利/转账服务端筛选排序分页、用户概览、专属用户查找/新增/编辑/清除与批量返利率均已迁移 | `views/admin/AffiliatesView.vue` | 浏览器验证三类记录、概览往返、用户新增编辑及批量费率；选择控件可访问标签通过 |
| `/admin/announcements` | 原路径 | 已通过 | 无；CRUD、OR/AND 定向、排期/状态、Markdown 预览、提醒方式和读取状态均已迁移 | `views/admin/AnnouncementsView.vue` | 治理组件测试；浏览器验证完整详情编辑、保存、预览与用户读取状态 |
| `/admin/ops` | 原路径 | 已通过 | 无；实时概览、请求/错误/日志、QPS、并发/可用性/Token 指标、告警规则/事件及全部运行设置均已迁移 | `views/admin/OpsView.vue` | 浏览器逐页加载，验证告警规则和通知/运行设置保存；共享 ops 请求日志 |
| `/admin/audit-logs` | 原路径 | 已通过 | 无；多维筛选、排序分页、详情、清理和全量筛选导出均已迁移 | `views/admin/AuditLogsView.vue` | 浏览器验证 PUT 方法服务端筛选、详情入口与 CSV 导出 |
| `/admin/usage` | 原路径 | 已通过 | 无；请求/错误/排行/清理四工作区、搜索建议、多维筛选、统计、详情、状态和全量导出均已迁移 | `views/admin/AdminUsageView.vue` | 浏览器验证模型服务端筛选、四页签、详情与 CSV 导出 |
| `/admin/risk-control`、`/admin/prompt-audit` | 原路径 | 已通过 | 无；内容风控全字段/Key 池/测试/状态/日志/清理，以及提示词事件/证据/端点池/策略/删除预览均已迁移 | `views/admin/{RiskControlView,PromptAuditView}.vue`、`features/admin/governance/model.ts` | 浏览器验证 Key 测试、风控保存、审计详情、策略修改/保存/恢复；治理模型测试 |
| `/admin/settings` | 原路径专用页 | 已通过 | 无；后端返回的全部可写字段动态分区，密文留空保留，SMTP/模板/Admin Key/可靠性/Beta/Web Search/账号自动化/系统更新回滚重启均有专用交互 | `views/admin/SettingsView.vue`、`features/admin/governance/model.ts` | 组件测试锁定只提交变更值；浏览器验证字段保存/恢复、模板预览与官方恢复；完整 182 项测试通过 |
| 备份/数据管理能力 | 对应管理入口 | 已通过 | 无；S3/图片存储、自动计划、手动备份、下载/删除/恢复，以及 Agent、Postgres/Redis/S3 profiles 和任务状态均已迁移 | `views/admin/DataManagementView.vue` | 浏览器验证存储与计划保存、连接测试、恢复表单、Agent 配置和任务列表 |

## 横切能力

| 能力 | 当前状态 | 缺口 |
| --- | --- | --- |
| 旧路径和深链兼容 | 已通过 | 兼容测试逐项比较旧 router；全部旧路径由页面、alias 或 redirect 承接 |
| token 自动刷新与并发请求恢复 | 已通过 | 直接复用既有 auth store、client 与 tokenRefresh；首次授权判断前由 `/auth/me` 校准身份 |
| API 唯一实现 | 已通过 | 所有业务请求复用 `frontend/src/api/**`；静态测试禁止重复 Axios 客户端和非白名单直连 |
| 功能开关/simple/backend mode | 已通过 | 菜单、路由、预取和页面共用同一功能判定；功能开关测试通过 |
| i18n/语言切换 | 待验证 | 按用户当前指示暂缓，不计入本轮“其他功能”完成范围 |
| 公告/Toast/全局确认/导航进度 | 已通过 | 全局 Store、对话框、焦点管理和导航进度已统一接入 |
| light/dark/system | 已通过 | 三态主题 Store 测试通过，light/dark 浏览器对比度检查通过 |
| 响应式与键盘可访问性 | 待验证 | 本地公共页五档、受保护页 1440/768 与键盘焦点已通过；完整五档由用户验收 |
| 运行时独立 | 已通过 | 旧 UI 组件依赖已移除；静态测试禁止旧 components/views/styles/assets 回流 |

## P0 路由契约台账

下表以 `frontend/src/router/index.ts` 为唯一基线。`新主路径` 是新版信息架构中的规范地址；`旧地址处理` 必须由 `frontend2` 自身完成，不能依赖旧站点或反向代理兜底。状态描述的是当前实现，不代表该路由可以跳过。

### 公共、安装与认证路由

| 旧路由 | 新主路径 | 访问/开关语义 | 页面与动作契约 | 归属 | 状态 |
| --- | --- | --- | --- | --- | --- |
| `/` | `/` | 匿名可访问；backend mode 下按旧白名单拦截 | 跳转/首页、公开设置、品牌、公告、登录/注册/模型广场入口 | P8 | 已通过 |
| `/home` | `/` | 匿名可访问；保留 `/home` alias | 同首页 | P8 | 已通过 |
| `/setup` | `/setup` | 匿名；已安装时按身份跳转 | 状态检测、数据库测试、Redis 测试、安装、错误恢复 | P8 | 已通过 |
| `/login` | `/login` | 匿名；已登录按角色跳转；backend mode 例外 | 密码登录、验证码、OAuth、TOTP、Passkey、redirect 恢复 | P8 | 待验证 |
| `/register` | `/register` | 注册开关、邮箱/验证码/邀请/促销策略 | 注册、发送验证码、校验邀请/促销、待完成 OAuth 账户创建 | P8 | 待验证 |
| `/email-verify` | `/email-verify` | 匿名/待认证会话 | 邮箱验证码确认、重发、成功跳转、失效恢复 | P8 | 待验证 |
| `/forgot-password` | `/forgot-password` | 密码重置与验证码开关 | 请求验证码、提交找回、限流/错误反馈 | P8 | 待验证 |
| `/reset-password` | `/reset-password` | 匿名签名链接 | token 校验、新密码、过期/重复使用恢复 | P8 | 待验证 |
| `/auth/callback` | `/auth/callback` | 匿名回调；alias `/auth/oauth/callback` | GitHub/Google 回调、登录/绑定分流、账户采用/创建、redirect 恢复 | P8 | 待验证 |
| `/auth/linuxdo/callback` | 原路径 | 匿名回调 | LinuxDo 交换、登录/绑定、补全与失败恢复 | P8 | 待验证 |
| `/auth/wechat/callback` | 原路径 | 匿名回调；open/mp 能力判断 | 微信登录/绑定、账户创建、模式恢复 | P8 | 待验证 |
| `/auth/wechat/payment/callback` | 原路径 | 匿名支付授权回调 | 恢复订单上下文并继续支付 | P4/P8 | 已通过 |
| `/auth/dingtalk/callback` | 原路径 | 匿名回调 | 钉钉登录/绑定、账户创建、邮箱补全分流 | P8 | 待验证 |
| `/auth/dingtalk/email-completion` | 原路径 | 待完成 OAuth 会话 | 邮箱、验证码、账户完成和异常恢复 | P8 | 待验证 |
| `/auth/oidc/callback` | 原路径 | 匿名回调 | OIDC 登录/绑定、账户创建和错误恢复 | P8 | 待验证 |
| `/key-usage` | `/key-usage` | backend mode 白名单 | Key 输入、公开用量查询、统计、无效/受限 Key 状态 | P8 | 已通过 |
| `/legal/:documentId` | 原路径 | 匿名；backend mode 白名单 | 按 ID 加载动态法律文档、404/加载错误 | P8 | 已通过 |
| `/model-plaza` | `/pricing` | `model_plaza_enabled`、可选强制登录、backend mode | 分组/平台/模型筛选、全部价格字段、说明与空错状态 | P3/P8 | 已通过 |
| `/payment/result` | 原路径 | 匿名、无需支付开关 | 公共订单校验、签名恢复、轮询、成功/失败/超时 | P4 | 已通过 |
| `/payment/stripe` | 原路径 | 匿名支付恢复页 | Stripe 加载、确认、返回结果、取消/失败 | P4 | 已通过 |
| `/payment/airwallex` | 原路径 | 匿名支付恢复页；backend mode 白名单 | Airwallex 加载、确认、回调、取消/失败 | P4 | 已通过 |
| `/payment/stripe-popup` | 原路径 | 匿名弹窗桥接页 | opener 消息、结果回传、关闭/失败 | P4 | 已通过 |
| `/:pathMatch(.*)*` | 原路径 | 全角色 | 品牌化 404、返回和角色首页入口 | P8 | 已通过 |

### 普通用户路由

| 旧路由 | 新主路径 | 一级任务域 / 二级入口 | 访问/开关语义 | 页面与动作契约 | 归属 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| `/dashboard` | `/app/dashboard` | 工作台 / 我的概览 | 登录用户 | 全部指标、账户刷新、时间范围/粒度、平台消费/额度、趋势、模型、近期记录、CSV 与下钻 | P3 | 已通过 |
| `/keys` | `/app/keys` | 开发接入 / API Key | 登录用户 | 服务端查询/分页/列配置、CRUD、复制、启停、分组、IP、额度/周期/到期/重置、使用指引、批量用量 | P3 | 已通过 |
| `/batch-image` | `/app/batch-image` | 开发接入 / 批量图片 | 登录、非 simple mode、账号能力允许；alias `/docs/batch-image` | Key/模型选择、批次提交、作业与项目查询、取消、下载、单图下载、删除、指南 | P3 | 已通过 |
| `/usage` | `/app/usage` | 用量与日志 / 用量明细 | 登录、非 simple mode | 日期/Key/模型/分组/请求/计费筛选、排序分页、统计、列配置、CSV、错误列表/详情 | P3 | 已通过 |
| `/available-channels` | `/app/models/available` | 开发接入 / 可用模型 | `available_channels_enabled`、非 simple mode | 可用分组/模型/平台/价格、筛选、价格解释 | P3 | 已通过 |
| `/monitor` | `/app/monitor` | 用量与日志 / 服务状态 | `channel_monitor_enabled`，v1/v2 模式 | 时间窗、自动刷新、状态卡、趋势、矩阵、错误、用户/模型维度、详情 | P3 | 已通过 |
| `/subscriptions` | `/app/subscriptions` | 账务与权益 / 我的订阅 | 登录、非 simple mode | 当前/历史订阅、额度进度、有效期、分组、汇总、状态 | P4 | 已通过 |
| `/purchase` | `/app/purchase` | 账务与权益 / 购买与充值 | `payment_enabled`、非 simple mode | 计划/金额、方式/渠道、费率/限额、下单、二维码/跳转、轮询和恢复 | P4 | 已通过 |
| `/orders` | `/app/orders` | 账务与权益 / 我的订单 | `payment_enabled`、非 simple mode | 服务端状态筛选/分页、详情、取消、继续支付、退款申请/查询 | P4 | 已通过 |
| `/payment/qrcode` | 原路径 | 账务与权益 / 支付进行中 | 登录、`payment_enabled` | 二维码、倒计时、轮询、取消和结果跳转 | P4 | 已通过 |
| `/redeem` | `/app/redeem` | 账务与权益 / 兑换码 | 登录、非 simple mode | 兑换、余额/订阅结果、历史、错误反馈 | P4 | 已通过 |
| `/affiliate` | `/app/affiliate` | 账务与权益 / 邀请返利 | `affiliate_enabled`、非 simple mode | 邀请链接/码、统计、记录、返利余额、转账和反馈 | P4 | 已通过 |
| `/profile` | `/app/profile` | 账户与安全 / 个人设置 | 登录用户 | 头像、用户名、密码、通知邮箱/阈值、身份绑定、TOTP、Passkey | P4 | 已通过 |
| `/custom/:id` | 原路径 | 动态入口 | 登录；按 `custom_menu_items.visibility/sort_order` | 动态标题/图标/内容、无权限/不存在状态、返回路径 | P4/P8 | 已通过 |

### 管理员路由

管理员主导航采用五个稳定任务域：`总览与运维`、`用户与访问`、`资源与调度`、`商业运营`、`安全与系统`。管理员的个人 Key、用量、订阅和资料进入头像菜单内的“个人工作区”，不与管理域混排。每个域的二级入口保留在上下文侧栏；1024px 左右转为横向滚动标签，900px 以下进入可搜索抽屉。

| 旧路由 | 一级任务域 / 二级入口 | 访问/开关语义 | 页面与动作契约 | 归属 | 状态 |
| --- | --- | --- | --- | --- | --- |
| `/admin` | 总览与运维 | 管理员；redirect `/admin/dashboard` | 保留 redirect 和 query | P1 | 已通过 |
| `/admin/dashboard` | 总览与运维 / 平台概览 | 管理员 | 时间范围、统计、实时指标、趋势、模型/分组/用户/Key 分布排行和下钻 | P7 | 已通过 |
| `/admin/ops` | 总览与运维 / 实时运维 | 管理员、`ops_monitoring_enabled` | 流量/并发/可用率、QPS 订阅、趋势/直方图/错误、日志、告警规则/事件/静默、通知与运行设置 | P7 | 已通过 |
| `/admin/users` | 用户与访问 / 用户管理 | 管理员、非 simple mode | 全部筛选/排序/分页/列配置、CRUD、批量限额、属性、Key、分组、余额、历史、额度、统计 | P2 | 已通过 |
| `/admin/groups` | 资源与调度 / 分组与定价 | 管理员、非 simple mode | CRUD/复制/启停/排序、模型范围、倍率/价格/RPM、复合路由、盈利控制、消息映射、统计与 Key | P5 | 已通过 |
| `/admin/channels` | 资源与调度 / 渠道与价格 | 管理员；redirect `/admin/channels/pricing` | 保留 redirect 和 query | P1/P5 | 已通过 |
| `/admin/channels/pricing` | 资源与调度 / 渠道与价格 | 管理员、非 simple mode | 渠道 CRUD、模型定价全字段、默认价、同步、分组/模型映射、状态和专项配置 | P5 | 已通过 |
| `/admin/channels/monitor` | 资源与调度 / 渠道监控 | 管理员、`channel_monitor_enabled` | 监控 CRUD/复制/执行/历史、模板 CRUD/应用/关联、完整指标与详情 | P5 | 已通过 |
| `/admin/accounts` | 资源与调度 / 上游账号 | 管理员 | 账号 CRUD/复制/批量、OAuth/重认证/刷新、测试、额度/用量、模型同步、导入导出、专项平台操作 | P5 | 已通过 |
| `/admin/proxies` | 资源与调度 / 代理资源 | 管理员 | CRUD/启停/测试/质量/关联账号、统计、批量、导入导出 | P5 | 已通过 |
| `/admin/subscriptions` | 商业运营 / 用户订阅 | 管理员、非 simple mode | 服务端筛选分页、详情/进度、发放/批量发放、延期、撤销/恢复、额度重置 | P6 | 已通过 |
| `/admin/orders/dashboard` | 商业运营 / 支付概览 | 管理员、支付开关 | 天数范围、收入/订单/方式/状态统计和趋势 | P6 | 已通过 |
| `/admin/orders` | 商业运营 / 订单管理 | 管理员、支付开关、非 simple mode | 多维筛选分页、详情、取消、重试充值、退款/强制退款/退款查询 | P6 | 已通过 |
| `/admin/orders/plans` | 商业运营 / 计划与支付 | 管理员、支付开关 | 支付配置、渠道/提供商/订阅计划 CRUD、排序/状态和依赖校验 | P6 | 已通过 |
| `/admin/redeem` | 商业运营 / 兑换码 | 管理员、非 simple mode | 查询/统计、生成、编辑/批量、过期、删除/批量删除、导出 | P6 | 已通过 |
| `/admin/promo-codes` | 商业运营 / 促销码 | 管理员、非 simple mode | 查询、CRUD、状态/规则、使用记录 | P6 | 已通过 |
| `/admin/affiliates` | 商业运营 / 联盟管理 | 管理员、`affiliate_enabled`；redirect invites | 保留 redirect 和 query | P1/P6 | 已通过 |
| `/admin/affiliates/invites` | 商业运营 / 邀请记录 | 同上 | 用户查找、记录筛选分页、用户概览和费率设置 | P6 | 已通过 |
| `/admin/affiliates/rebates` | 商业运营 / 返利记录 | 同上 | 返利筛选分页、批量费率、清除覆盖 | P6 | 已通过 |
| `/admin/affiliates/transfers` | 商业运营 / 转账记录 | 同上 | 转账筛选分页、用户概览 | P6 | 已通过 |
| `/admin/announcements` | 安全与系统 / 公告与内容 | 管理员 | 公告 CRUD、目标、时间、状态、预览和读取状态 | P7 | 已通过 |
| `/admin/usage` | 安全与系统 / 用量审计 | 管理员 | 用户/Key 搜索、多维筛选、排序分页、统计、错误详情、清理任务、导出 | P7 | 已通过 |
| `/admin/audit-logs` | 安全与系统 / 操作审计 | 管理员、非 simple mode | 筛选分页、详情、清理、导出 | P7 | 已通过 |
| `/admin/risk-control` | 安全与系统 / 内容风控 | 管理员、`risk_control_enabled` | 配置、状态、Key 测试、日志、解封、哈希清理 | P7 | 已通过 |
| `/admin/prompt-audit` | 安全与系统 / 提示词审计 | 管理员、`risk_control_enabled` | 运行概览、事件工作区/详情、策略、端点池、筛选删除 | P7 | 已通过 |
| `/admin/settings` | 安全与系统 / 系统设置 | 管理员；simple mode 仍可见 | 旧页全部分区/字段、敏感值策略、SMTP/模板/API Key/冷却/超时/整流/Beta/Web Search、更新回滚重启 | P7 | 已通过 |
| 备份与数据管理入口 | 安全与系统 / 数据与备份 | 管理员 | S3/图片存储、计划、备份列表/下载/删除/恢复；数据源配置、Agent 状态、备份任务 | P7 | 已通过 |

## P0 API 唯一实现与归属台账

以下 55 个非测试模块必须从 `frontend/src/api/**` 构建期复用。动作名是公开导出或对象方法的迁移检查清单；`frontend2` 不得重新实现同一路径。

### 公共与普通用户 API（22 个模块）

| 共享模块 | 必须承接的导出/动作 | 归属 |
| --- | --- | --- |
| `adminUIRequest.ts` | 管理/用户请求标记判断与 `ADMIN_UI_REQUEST_HEADER`、`USER_UI_REQUEST_HEADER` | P1 |
| `client.ts` | 唯一 Axios 客户端、认证头、locale/timezone、刷新协同、错误归一与一次重试 | P1 |
| `tokenRefresh.ts` | `refreshAuthTokens` 跨标签页刷新协议 | P1 |
| `url.ts` | `getAPIBaseURL`、`buildApiUrl`、`buildGatewayUrl` | P1 |
| `index.ts` | 公共 API barrel 兼容 | P1 |
| `announcements.ts` | `list`、`markRead` | P1/P8 |
| `auth.ts` | token 读写/清除、login/login2FA/register/logout/current user、public settings、验证码/邀请/促销、找回/重置、全部 OAuth 发起/交换/采用/绑定完成、会话吊销 | P1/P8 |
| `setup.ts` | `getSetupStatus`、`testDatabase`、`testRedis`、`install` | P8 |
| `passkey.ts` | 支持检测、login、register、list、rename、remove | P4/P8 |
| `totp.ts` | status、验证方式、验证码、setup、enable、disable、step-up | P4/P8 |
| `keys.ts` | list/get/create/update/delete/toggle | P3 |
| `usage.ts` | list/query/stats/date range/detail、dashboard stats/trend/models/snapshot/Key usage、错误列表/详情 | P3 |
| `groups.ts` | 用户可用分组、用户分组倍率 | P3 |
| `channels.ts` | 用户可用渠道 | P3 |
| `modelPlaza.ts` | 完整模型广场读取 | P3/P8 |
| `channelMonitor.ts` | v1 list/status | P3 |
| `channelMonitorV2.ts` | dimensions/snapshot/matrix/models/errors/users/config/update、错误分类 | P3/P5 |
| `batchImage.ts` | submit/get/list jobs/models/items、cancel、zip/单图下载、删除记录、保存 Blob | P3 |
| `subscriptions.ts` | 我的订阅、活跃订阅、进度、摘要、单订阅进度 | P4 |
| `payment.ts` | config/plans/checkout/limits、创建/查询/取消/校验订单、公共恢复、退款申请/可退款提供商 | P4 |
| `redeem.ts` | redeem、history | P4 |
| `user.ts` | profile/update/password、通知邮箱全流程、邮箱身份绑定、OAuth 绑定/解绑、联盟详情/转账、平台额度 | P4 |

### 管理员 API（33 个模块）

| 共享模块 | 必须承接的导出/动作 | 归属 |
| --- | --- | --- |
| `admin/index.ts` | 32 个管理模块统一 barrel；页面可按模块导入但不能替换实现 | P1 |
| `admin/compliance.ts` | 管理员合规状态与接受 | P1/P7 |
| `admin/users.ts` | list/get/create/update/delete、余额增减、并发/批量限制、启停、Key、用量、余额历史、替换分组、身份绑定、平台额度与窗口重置 | P2 |
| `admin/userAttributes.ts` | 属性定义 list/create/update/delete/reorder、用户值和批量值 | P2 |
| `admin/apiKeys.ts` | 管理员修改 Key 分组 | P2/P5 |
| `admin/groups.ts` | 全量列表/平台/能力/候选模型、CRUD/复制/启停/排序、统计/Key、复合路由、倍率/RPM、用量与容量摘要 | P5 |
| `admin/channels.ts` | list/get/create/update/remove、默认模型价、同步模型定价 | P5 |
| `admin/channelMonitor.ts` | monitor list/get/create/duplicate/update/delete/run/history | P5 |
| `admin/channelMonitorTemplate.ts` | template list/get/create/update/delete/apply/关联监控 | P5 |
| `admin/accounts.ts` | 账号 CRUD/复制/批量/状态/测试/错误恢复、OAuth/凭证、额度/用量/模型同步、导入导出、OpenAI/Grok/Spark/Ollama/上游账单专项动作 | P5 |
| `admin/antigravity.ts` | Antigravity OAuth 发起/交换/刷新 | P5 |
| `admin/gemini.ts` | Gemini OAuth 发起/交换/能力 | P5 |
| `admin/grok.ts` | Grok 能力、SSO/OAuth/密码授权、刷新、额度查询/重置、创建 | P5 |
| `admin/cnProviders.ts` | 国内提供商额度/余额查询 | P5 |
| `admin/scheduledTests.ts` | 账号定时测试 list/create/update/delete/results | P5 |
| `admin/proxies.ts` | list/get/CRUD/启停/测试/质量/统计/关联账号、批量创建删除、导入导出 | P5 |
| `admin/subscriptions.ts` | list/get/progress、assign/bulk assign、extend/revoke/restore/reset quota、按分组/用户查询 | P6 |
| `admin/payment.ts` | 支付配置、dashboard、订单筛选/详情/取消/重试/退款、支付渠道/计划/提供商 CRUD | P6 |
| `admin/redeem.ts` | list/get/generate/delete/batch delete/update/expire/stats/export | P6 |
| `admin/promo.ts` | list/get/CRUD/usages | P6 |
| `admin/affiliates.ts` | 用户列表/查找/设置/清除、批量费率、邀请/返利/转账记录、用户概览 | P6 |
| `admin/dashboard.ts` | stats/realtime/trends/models/groups/users/snapshot/Key 与用户趋势/排行/批量用量 | P7 |
| `admin/ops.ts` | 并发/可用率/实时流量/QPS、概览/趋势/直方图/错误/请求详情、告警规则/事件/静默、邮件/运行/日志/高级设置 | P7 |
| `admin/announcements.ts` | list/get/CRUD/read status | P7 |
| `admin/audit.ts` | list/get/clear | P7 |
| `admin/usage.ts` | list/stats、搜索用户/Key、清理任务 list/create/cancel | P7 |
| `admin/riskControl.ts` | config/status/API Key test/logs/unban/hash delete/clear | P7 |
| `admin/settings.ts` | 全部设置读写与 normalize/sanitize、SMTP/测试邮件、邮件模板、管理员 Key、过载/429/面板限流/流超时/整流/Beta/Web Search 配置与测试 | P7 |
| `admin/system.ts` | version/update check/update/rollback/restart | P7 |
| `admin/errorPassthrough.ts` | 规则 list/get/CRUD/toggle | P7 |
| `admin/tlsFingerprintProfile.ts` | TLS 指纹配置 list/get/CRUD | P7 |
| `admin/backup.ts` | S3/图片存储配置测试、计划、备份创建/list/get/delete/download/restore | P7 |
| `admin/dataManagement.ts` | Agent/配置/S3 测试、源与 S3 profile CRUD/启用、备份任务 create/list/get | P7 |

## P0 状态、组件与横切归属

### Store 与运行时状态（8 个 Store）

| 基线 | 必须保持的语义 | 归属 |
| --- | --- | --- |
| `stores/auth.ts` | `unknown → authenticated/anonymous` 初始化、token 用户、角色、simple mode、登录/登出/刷新和持久化 | P1 |
| `stores/app.ts` | 注入/异步公开设置、品牌、Logo、backend mode、侧栏/移动导航、功能默认值 | P1 |
| `stores/adminSettings.ts` | 管理开关、运维/支付、自定义管理员菜单的缓存与刷新 | P1/P7 |
| `stores/adminCompliance.ts` | 合规状态、423 截获、确认对话框 | P1/P7 |
| `stores/announcements.ts` | 公告加载、未读、弹窗和已读 | P1/P8 |
| `stores/subscriptions.ts` | 用户订阅、进度和刷新 | P4 |
| `stores/payment.ts` | 支付配置、计划、当前订单和轮询 | P4 |
| `stores/onboarding.ts` | 新手引导状态和完成记录 | P3/P9 |

### 功能开关与路由守卫

| 契约 | 旧语义 | 新版落点 | 归属 |
| --- | --- | --- | --- |
| `channel_monitor_enabled` | opt-out；控制用户/管理监控入口与页面 | 开发接入/资源调度二级入口 + 路由守卫 | P1/P3/P5 |
| `channel_monitor_mode` | `v1` 默认、`v2` 显式启用 | 同一路由选择专用实现 | P1/P3 |
| `available_channels_enabled` | opt-in | “可用模型”入口与路由 | P1/P3 |
| `model_plaza_enabled` / `model_plaza_require_auth` | opt-in + 可强制登录，失败时后端 404 兜底 | 公共“模型与价格”入口与守卫 | P1/P8 |
| `payment_enabled` | opt-out；用户支付与管理员商业入口 | “账务与权益/商业运营”入口与路由 | P1/P4/P6 |
| `risk_control_enabled` | opt-in | “安全与系统”风控/提示词审计入口与路由 | P1/P7 |
| `affiliate_enabled` | opt-in | 用户返利与管理员联盟入口 | P1/P4/P6 |
| `allow_batch_image_generation` | 用户/分组能力共同决定 | 批量图片入口、表单和请求前置校验 | P1/P3 |
| simple mode | 隐藏/阻止分组、用户、订阅、兑换等旧限制；管理员补 Key 与设置入口 | 菜单和路由使用同一决策函数 | P1 |
| backend mode | 管理员全量；匿名仅白名单；普通登录用户不可进入保护区 | 菜单、守卫、登录重定向统一 | P1 |
| `custom_menu_items` | user/admin 可见性、排序、SVG、动态标题 | 顶部域对应上下文菜单 + 移动搜索菜单 | P1/P4/P7 |

### 组件与视图文件归属（无未归属 glob）

| 基线文件集合 | 数量 | 新版用途 | 归属 |
| --- | ---: | --- | --- |
| `components/common/**` | 41 | 表格、分页、筛选、日期、输入、对话框、Toast、Skeleton、空态、导出、公告、语言等共享交互基线 | P1/P9 |
| `components/layout/**` | 9 | 布局、顶部任务域、上下文侧栏/标签、标题、导航进度 | P1 |
| `components/auth/**` + 根 Captcha 组件 | 15 | OAuth、验证码、TOTP 登录、待完成账户和协议 | P8 |
| `components/Guide/**` | 1 | 新手引导步骤 | P3/P9 |
| `components/icons/**` | 2 | 统一图标适配 | P1 |
| `components/charts/**` | 5 | 用户/管理看板趋势与分布 | P3/P7 |
| `components/keys/**` | 2 | Key 端点和使用弹层 | P3 |
| `components/channels/**` + `components/modelPlaza/**` | 8 | 可用模型、模型广场、价格行和筛选 | P3/P8 |
| `components/payment/**` | 18 | 金额、计划、方式、Provider、QR、状态、订单表 | P4/P6 |
| `components/user/*.vue` | 9 | 用户属性、并发、错误详情、平台额度等用户/管理员交叉展示 | P2/P3/P4 |
| `components/user/dashboard/**` | 4 | 用户看板 | P3 |
| `components/user/monitor/**` | 7 | 用户监控 | P3 |
| `components/user/profile/**` | 11 | 资料、头像、通知、身份、TOTP、Passkey | P4 |
| `components/admin/user/**` | 9 | 创建、编辑、Key、分组、余额、历史、批量限额 | P2 |
| `components/admin/group/**` + `components/admin/channel/**` | 7 | 分组和渠道专用配置 | P5 |
| `components/account/**` + `components/admin/account/**` | 44 | 上游账号通用/管理专项动作 | P5 |
| `components/admin/monitor/**` | 10 | 管理监控与模板 | P5 |
| `components/admin/proxy/**` | 1 | 代理关联账号 | P5 |
| `components/admin/payment/**` | 7 | 管理支付方式与提供商 | P6 |
| `components/admin/usage/**` | 6 | 管理用量筛选、详情和清理 | P7 |
| `components/admin/announcements/**` + `components/admin/*.vue` | 5 | 公告编辑、合规、错误透传、TLS 指纹 | P7 |
| `features/channel-monitor-v2/**` | 8 | v2 监控筛选、指标、趋势、矩阵、设置 | P3/P5 |
| `features/prompt-audit/**` | 10 | 提示词审计完整工作区 | P7 |
| `views/**`（84 个非测试 Vue 文件） | 84 | 由上方 58 个路由/入口逐项承接；`views/admin/ops/**` 内嵌子视图全部归 P7 | P2-P8 |
| `composables/**` | 21 | OAuth、刷新、批图访问、剪贴板、表单、搜索、白名单、导航、分页、Step-up、选择、表格加载 | 按调用域归 P1-P8 |
| `i18n/**` | zh/en 全量目录 | 共享 locale 加载、持久化和 document lang/title 已接入；新版业务文案迁移按用户当前指示暂缓 | P1；业务文案不计入本轮范围 |

计数校验：`components/**` 非测试文件 221 个，以上组件行合计 221；`features/**` 非测试文件 18 个；`views/**` 非测试 Vue 文件 84 个；`api/**` 非测试 TypeScript 模块 55 个；`composables/**` 非测试模块 21 个。所有集合均已有唯一或明确的联合任务归属，不存在“未盘点所以未迁移”的文件集合。

## P0 模型与价格缺口结论

1. 现有计费契约已经覆盖 token、按次、图片、视频、缓存写入/读取、区间、官方参考价、用户/图片/高峰倍率和专属可见性。`frontend2` 当前缺字段属于消费裁剪，P3/P5 必须直接补齐，不得修改后端。
2. 当前只确认“模型展示资料”可能真实缺失：展示名、介绍、能力标签、展示排序、独立展示可见性。该集合不参与计费，不覆盖模型 Key 和价格解析。
3. P5 只有在实现新版模型目录时再次以 DTO、迁移和管理员表单证明这些字段仍无法表达，才可新增管理员配置、向后兼容迁移和 `/model-plaza` 只读字段；否则不做后端变更。
4. 价格真值继续由现有 Group → Channel → 官方目录 → fallback 解析链产生，用户端只展示后端结果，不建立第二套账本或前端来源优先级。
