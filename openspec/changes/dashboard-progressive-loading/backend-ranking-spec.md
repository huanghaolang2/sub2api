# 模型排行筛选下沉后端

状态：`SPEC_APPROVED`，正文冻结。用户于 2026-10-26 先明确回复“SQL 无误”，随后明确回复“通过”，SQL 专项和补充 Spec 总体审核均已通过。实施与验证按本阶段唯一的 backend-ranking-plan.md 执行，原前端阶段计划保留为已完成历史。

## 目标、范围与现状

- 现有仪表盘从 `/api/v1/usage/dashboard/models` 取得完整模型聚合后，在 `dashboardBoards.ts` 中筛选、排序和截取。接口和仓储当前返回所选范围内的全部模型。
- 同一接口也被 `frontend/src/views/user/UsageView.vue` 用于模型统计和候选项，直接全局限制会影响旧功能。
- 本次将仪表盘模型排行的门槛、稳定排序和前10名限制下沉数据库查询，Go 只读取合格的至多10行，前端按返回顺序展示。
- 继续沿用已确认的个人权限、请求模型维度、四项 Tokens 口径、时间与时区、延后加载、重试取消和空状态。不改 API Key 排行。
- 不新增表、字段、索引或迁移，不写业务数据，不改费用规则和历史归属，不改管理员统计，不发布线上版本。保留工作区已有的网关/WebSocket 改动。

## 接口与数据契约

现有 GET `/api/v1/usage/dashboard/models` 新增可选参数 `ranking_period`，有限选项集中定义为 Go 与 TypeScript 枚举，稳定值为 `week / month / lifetime`。

| 输入 | 后端行为 |
| --- | --- |
| 未传或空值 | 保留现有完整模型统计，不新增门槛或数量限制，旧调用方继续工作 |
| `week` | 按当前请求日期范围聚合，单模型 `total_tokens > 1000000`，排序后至多10行 |
| `month` 或 `lifetime` | 按当前请求日期范围聚合，单模型 `total_tokens > 100000000`，排序后至多10行 |
| 其他值 | HTTP 400，不执行模型聚合查询 |

- 门槛和数量上限由后端固定策略确定，不接受客户端传入任意门槛或 limit。`ranking_period` 选择门槛，不替代现有日期参数；仪表盘仍以同一轮快照传入周一/月初/累计起始日期、结束日期和时区。
- 用户身份仍取登录上下文，不接受前端指定其他 user_id；现有日期和可选筛选条件继续按原接口校验、授权和参数化执行。
- 继续仅支持 requested 模型来源。历史缺少 `requested_model` 时回退 `model`；不转换为上游模型。
- 响应结构保持 `models / start_date / end_date`，models 的字段和费用信息可见范围不变。排行模式最多返回10项，空结果返回空数组；错误不能转换为成功空数组。
- 同用量按请求模型标识使用 PostgreSQL `C` 排序规则升序，排序后再限制数量，确保并列时结果稳定。
- 前端只传 `ranking_period`、映射响应，不再执行业务门槛过滤、排序或 `.slice(0,10)`。既有前端周期枚举与 API 新参数复用同一集中定义，避免两套枚举值漂移。
- 继续按当前用户使用记录的 `usage_logs.user_id` 归属统计，包含零费用但有 Tokens 的记录；不新增密钥 JOIN 或删除状态过滤，不改变此前已说明的模型/API Key 历史归属差异。

## SQL 专项审查

这是只读 SELECT 的变更，也须经过用户独立确认。排行模式复用现有模型聚合读取路径；普通统计模式保持原查询行为，不增加 HAVING 或 LIMIT。

以下为仪表盘未指定额外筛选条件时的完整查询语义。实际实现保留现有参数化筛选追加器；附加筛选加入 WHERE，门槛和 LIMIT 的占位序号随参数数量顺延，不拼接用户输入：

```sql
SELECT
    COALESCE(NULLIF(TRIM(requested_model), ''), model) AS model,
    COUNT(*) AS requests,
    COALESCE(SUM(input_tokens), 0) AS input_tokens,
    COALESCE(SUM(output_tokens), 0) AS output_tokens,
    COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
    COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
    COALESCE(SUM(
        input_tokens + output_tokens
        + cache_creation_tokens + cache_read_tokens
    ), 0) AS total_tokens,
    COALESCE(SUM(total_cost), 0) AS cost,
    COALESCE(SUM(actual_cost), 0) AS actual_cost,
    COALESCE(SUM(
        COALESCE(account_stats_cost, total_cost)
        * COALESCE(account_rate_multiplier, 1)
    ), 0) AS account_cost
FROM usage_logs
WHERE created_at >= $1
  AND created_at < $2
  AND user_id = $3
GROUP BY COALESCE(NULLIF(TRIM(requested_model), ''), model)
HAVING COALESCE(SUM(
    input_tokens + output_tokens
    + cache_creation_tokens + cache_read_tokens
), 0) > $4
ORDER BY
    total_tokens DESC,
    COALESCE(NULLIF(TRIM(requested_model), ''), model) COLLATE "C" ASC
LIMIT $5;
```

参数：`$1/$2` 为现有接口按时区解析后的左闭右开时间区间；`$3` 为登录用户 ID；`$4` 由排行周期选择为 1000000 或 100000000；`$5` 固定为10。

专项核对结果：

- 数据模型、字段类型、可空性、默认值、主外键和唯一约束均不变。SUM、COALESCE 和返回字段沿用当前聚合，门槛作用于每个请求模型的聚合总量。
- 阈值必须放在 HAVING。多条单次低用量请求合计超过门槛的模型应入榜；不能在 WHERE 中用单条记录的 Tokens 过滤。
- 不加 `actual_cost > 0`，避免排除免费用量；缓存创建和缓存读取计入总量，恰好等于门槛的模型排除。
- WHERE 先限定当前用户、日期及既有可选筛选，再聚合、HAVING、稳定排序、LIMIT。不能跨用户累计，也不能先取10个再过滤或排序。
- account_cost 仍仅用于兼容现有内部行扫描；用户响应转换继续不返回账号成本字段，不扩大数据可见性。
- SQL 只读、重复调用无写入副作用。无数据迁移和数据回滚；应用回滚恢复旧读取路径即可。
- 收益为至多10行传输、扫描返回结果和序列化，避免完整模型列表出库；不承诺减少所选范围的基础记录聚合扫描，不预设实际耗时下降比例。

SQL 门禁：已通过，依据用户于 2026-10-26 单独明确回复“SQL 无误”；后续“通过”已确认本补充 Spec 总体审核。

## 兼容、实施约束与切换

- 服务增加独立的排行读取方法，复用仓储当前参数化聚合构建；通过一个小型排行仓储接口接入，不扩大公共 `UsageLogRepository` 及其全部既有测试替身。
- 仓储排行方法必须执行 SQL 的 HAVING/LIMIT；不能降级为查询全量后在 Go 中过滤。仓储能力缺失时返回明确服务错误。
- 先更新后端支持可选参数，保留旧前端过滤；后端验证后再更新前端传参并移除过滤，防止新前端误连忽略参数的旧后端后显示全量模型。
- 本地后端构建使用当前原始 checkout，已有无关源码改动不回退、不提交、不归入本需求验证结论；运行更新时分别记录实际服务版本和本需求验证范围。

## 验收与验证边界

- BR-AC-001：真实数据库聚合覆盖门槛下一单位、恰好门槛和门槛上一单位；多条低用量记录合计达标、缓存 Tokens、零费用记录均按既有口径处理。
- BR-AC-002：至少15个合格模型时返回严格排序后的前10个，同用量标识顺序稳定；另一用户的高用量模型不进入当前用户结果。
- BR-AC-003：未传 ranking_period 的旧接口仍返回全量，现有使用记录页及模型候选项不被截断；无效周期为400且不进入排行仓储。
- BR-AC-004：前端周/月/累计请求均传正确周期；移除前端筛选后，真实页面直接展示后端返回的结果，延后加载、取消、失败重试和空状态不回归。
- BR-AC-005：本地后端与前端均更新后核对实际响应至多10项；以相同时间区间和数据量记录响应字节数、返回行数与请求耗时，准确区分出库减少和底层扫描成本。
- 单元验证覆盖周期策略、HTTP 校验、鉴权和参数传递；SQL 字符串 Mock 只证明绑定和查询形态，不能替代数据库聚合验收。
- 数据库验证复用现有 repository 集成测试的隔离事务和测试容器，不对生产数据造数、执行迁移或创建索引；启用 CI 模式防止缺少环境时跳过却宣称通过。
- 前端运行受影响请求、数据转换、页面集成与旧 UsageView 的最小回归；后端运行受影响 handler/service/repository 单元和数据库集成测试，再核对构建及本地服务状态。具体文件和命令在 SQL 与 Spec 门禁通过后的唯一实施 Plan 中确定。
- 生产数据规模的聚合扫描耗时及线上部署继续为外部待验证，不从本地小样本推出生产加速结论。
