# API 参考

## 地址与认证

默认 base URL 为 `https://api.chuangyedaosheng.net`。脚本会规范化为：

```text
https://api.chuangyedaosheng.net/v1
```

调用方从环境变量 `CDYS_API_KEY` 读取平台密钥。该 skill 不要求 Python、Node.js、SDK 或 `jq`；Codex 或 Claude 使用当前环境已有的 HTTP 能力即可，有 shell 时可直接使用 `curl`。

请求头使用：

```http
Authorization: Bearer <platform-api-key>
Content-Type: application/json
```

图生图的本地文件请求使用 `multipart/form-data`，由脚本自动生成 boundary。

## 文生图

```http
POST /v1/images/generations
```

最小请求：

```json
{
  "model": "gpt-image-2",
  "prompt": "A lighthouse during a winter storm"
}
```

常用可选字段：`size`、`quality`、`n`、`response_format`。`response_format` 可为 `url` 或 `b64_json`。平台实际可用模型和尺寸以账号分组配置为准；收到模型或能力错误时，应把服务端错误原样概括给用户并让用户选择可用模型。

## 图生图

### 本地文件（推荐）

```http
POST /v1/images/edits
Content-Type: multipart/form-data
```

表单字段：

- `model`：模型名称
- `prompt`：编辑指令
- `image`：一个或多个源图文件
- `mask`：可选遮罩文件
- `size`、`quality`、`n`、`response_format`：可选

### 远程图片 URL

当无法访问本地文件时，可使用 JSON：

```json
{
  "model": "gpt-image-2",
  "prompt": "Replace the background with a sunset beach",
  "images": [
    {"image_url": "https://example.com/source.png"}
  ],
  "mask": {"image_url": "https://example.com/mask.png"}
}
```

`mask` 是可选的；没有 mask 时删除整个字段。源图 URL 必须可被平台访问。

## 响应

成功响应遵循 OpenAI Images 形状：

```json
{
  "created": 1784092923,
  "data": [
    {"url": "https://..."}
  ]
}
```

每个 `data` 项通常包含 `url` 或 `b64_json`。调用方优先使用 URL；下载时不得携带平台 Authorization header。若只有 `b64_json`，使用当前环境已有的 base64 解码能力保存为图片，不要把完整 base64 输出到聊天或日志。

失败响应通常为：

```json
{
  "error": {
    "type": "invalid_request_error",
    "message": "..."
  }
}
```

常见处理：401/403 检查 key 和图片生成权限，400 检查模型、prompt、图片格式和参数，429 等待用户决定是否稍后重试，5xx 报告上游失败且不要自动重复提交。
