# Dashboard Feishu reporter

这个目录提供一个一次性执行的看板发送器。它会在服务器上打开已认证的 `/dashboard`，等待数据渲染，生成 PNG，再通过飞书发送摘要和截图。`FEISHU_TRANSPORT=app` 会上传到飞书并把图片内嵌进消息，`FEISHU_TRANSPORT=webhook` 则通过群 Webhook 发送 COS 截图链接。

真实 Webhook、成员 `open_id`、登录信息和 COS 参数只放在服务器的 `deploy/dashboard-reporter/.env.local`，不要提交到 Git。先复制 `.env.example`，再按注释填写。

## 飞书应用模式

要得到示例图中的内嵌截图，设置 `FEISHU_TRANSPORT=app`、`FEISHU_APP_ID`、`FEISHU_APP_SECRET` 和目标群 `FEISHU_CHAT_ID`。应用机器人需要先加入目标群，并开通发送消息和上传图片所需权限。`FEISHU_MENTION_OPEN_IDS` 使用成员 `open_id`，只影响消息中的 @。

## COS 上传契约

Webhook 模式默认使用 `COS_UPLOAD_MODE=presigned_api`。每次运行时发送：

```json
{"filename":"cyds-dashboard-2026-10-19.png","content_type":"image/png","size":12345}
```

接口需要返回：

```json
{"upload_url":"https://...presigned-put...","public_url":"https://.../cyds-dashboard-2026-10-19.png"}
```

发送器随后使用 `PUT upload_url` 上传 PNG，并把 `public_url` 放进飞书消息。若现有 COS 接口是 multipart 上传，可改为 `COS_UPLOAD_MODE=multipart`，并设置 `COS_PUBLIC_URL_FIELD` 指向返回 JSON 中的公开 URL 字段。

## 首次运行与定时

先构建并执行一次干跑，确认登录态和截图流程：

```bash
cd /path/to/sub2api
cp deploy/dashboard-reporter/.env.example deploy/dashboard-reporter/.env.local
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.dashboard-reporter.yml build dashboard-reporter
REPORT_DRY_RUN=true docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.dashboard-reporter.yml run --rm dashboard-reporter
```

服务器需要提供 `DASHBOARD_STORAGE_STATE` 指向 Playwright `storageState` 文件，或者填写登录邮箱和密码。启用 2FA 时，建议预先生成 storage state，不要把 TOTP 秘密写入配置。

确认干跑成功并配置飞书/COS 后，用服务器的 cron 每周一 08:00（UTC+8）执行：

```cron
CRON_TZ=Asia/Shanghai
0 8 * * 1 cd /path/to/sub2api && docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.dashboard-reporter.yml run --rm dashboard-reporter >> /var/log/sub2api-dashboard-reporter.log 2>&1
```

`FEISHU_MENTION_OPEN_IDS` 只控制消息中的 @；群内其他成员仍然可以看到群消息，这是飞书群消息的权限语义。
