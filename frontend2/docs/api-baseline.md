# frontend2 API 与权限契约基线

`frontend2` 在构建期直接复用 `frontend/src/api/**`、共享 Store、类型与无 UI 业务工具；生产产物完成打包后不依赖旧站点入口。旧端页面、组件、样式和资源不得被导入。

## 认证契约

- 登录：`POST /api/v1/auth/login`。
- 当前用户：`GET /api/v1/auth/me`。
- 刷新：复用现有 refresh token 流程；持久化键保持 `auth_token`、`auth_user`、`refresh_token`、`token_expires_at`。
- 标准响应 envelope 为 `{ code, message, data }`，`code === 0` 时读取 `data`。
- 用户角色稳定值为 `user`、`admin`；在 `frontend2` 中用 `Role` 枚举表示。
- API 请求使用 `Authorization: Bearer <token>`、`Accept-Language`；GET 附带客户端 timezone。

## 用户能力来源

| 领域 | 现有前端契约位置 | frontend2 页面 |
| --- | --- | --- |
| 数据看板/用量 | `frontend/src/api/usage.ts` | `/app/dashboard`、`/app/usage` |
| API Key | `frontend/src/api/keys.ts` | `/app/keys` |
| 可用模型与价格 | `frontend/src/api/channels.ts` | `/pricing`、`/app/models` |
| 支付与订阅 | `frontend/src/api/payment.ts`、`subscriptions.ts` | `/app/billing`、`/app/subscriptions` |
| 个人资料与安全 | `frontend/src/api/user.ts`、`auth.ts`、`totp.ts`、`passkey.ts` | `/app/profile` |

## 管理员能力来源

| 领域 | 现有前端契约位置 | frontend2 页面 |
| --- | --- | --- |
| 管理看板 | `frontend/src/api/admin/dashboard.ts` | `/admin/dashboard` |
| 用户 | `frontend/src/api/admin/users.ts` | `/admin/users` |
| 分组 | `frontend/src/api/admin/groups.ts` | `/admin/groups` |
| 渠道/定价 | `frontend/src/api/admin/channels.ts` | `/admin/channels` |
| 订单/订阅 | `frontend/src/api/admin/payment.ts`、`subscriptions.ts` | `/admin/orders`、`/admin/subscriptions` |
| 设置 | `frontend/src/api/admin/settings.ts` | `/admin/settings` |

## 权限与兼容不变量

1. 公共路由不要求认证；GuestOnly 路由对已登录用户跳转角色首页。
2. Authenticated 路由要求当前用户；AdminOnly 同时要求 `Role.ADMIN`。
3. 普通用户访问 `/admin/*` 时不得发出管理 API 请求。
4. 数据范围由后端当前身份和管理员中间件决定，客户端不伪造用户 ID。
5. 401 最多刷新一次；403 不重试；退出登录清空会话和受保护缓存。
6. 除冻结规格允许的模型展示资料外不新增或修改后端 API；当前模型与价格已由既有契约完整表达，因此没有新增后端字段。
