# 使用看板 SQL 专项审查

状态：`SQL_CONFIRMED`。用户在确认全部 SQL 为只读查询后回复“没问题”，SQL 专项审核通过。本文保留已确认的读取契约，实现与隔离数据库验证结果见 [verification.md](./verification.md)。

对应规格：[spec.md](./spec.md)。统计维度为 API Key 展示名称和用量。

## 数据归属与变化范围

- `usage_logs` 是唯一用量事实来源；使用记录自身的 `user_id` 用于权限隔离，`api_key_id` 用于统计，`group_id` 用于历史分组筛选。
- `api_keys` 仅提供密钥名称和显式选中密钥的所属用户校验。密钥的当前分组不决定历史记录是否符合分组筛选。
- 不查询或关联负责人、平台、上游账号；不使用 `actual_cost > 0`、tokens 大于 0 或计费类型条件排除匹配记录。
- 本次无 DDL、DML、索引变更、迁移或回填，不修改字段类型、默认值、可空性及约束。新增查询只返回聚合数据和名称，不返回 `api_keys.key`。

## 权限与查询参数

服务端使用 `self/admin` 范围枚举。用户接口（包括管理员访问个人入口）将范围固定为 `self`，用户 ID 取自登录会话；管理接口通过现有管理员鉴权后使用 `admin`。客户端不能指定范围或用户 ID。

显式选择的所有密钥 ID 先去重，再读取现有密钥的 ID 和所属用户：

```sql
SELECT id, user_id
FROM api_keys
WHERE id = ANY($1::bigint[]);
```

对于个人范围，只有所有选中 ID 均存在且属于登录用户时才执行聚合，否则统一返回 403；不能去掉非法 ID 后继续查询。管理员选择不存在的 ID 返回 400。未显式选择时不执行这项查询。软删除但仍保存的密钥可以查询历史使用量；已经没有密钥实体的历史记录仍可在不显式筛选该密钥时纳入聚合并显示占位名称。

聚合参数如下，全部使用绑定参数：

| 参数 | 类型 | 语义 |
| --- | --- | --- |
| `$1` | text | 已校验的 `day/week/month` 枚举值 |
| `$2` | text | 已校验的 IANA 时区 |
| `$3` | timestamptz | 查询开始日期或月份首日的 00:00，含边界 |
| `$4` | timestamptz | 结束日期次日或结束月份次月首日的 00:00，不含边界 |
| `$5` | bigint 或 null | `self` 固定为登录用户 ID；仅已鉴权 `admin` 由服务端设为 null |
| `$6` | bigint[] | 选中的 API Key ID，空数组表示不限，不传 null |
| `$7` | bigint[] | 选中的分组 ID，空数组表示不限，不传 null |

日期转换采用日历加日/加月，不能用固定 24 小时秒数代替跨夏令时的自然日边界。时间段标签由规范化后的本地日历日期生成。

## 聚合查询

查询先根据权限、时间、密钥、分组过滤使用记录，再按时间段和密钥聚合。一个 SQL 语句返回图表及表格共用的全部稀疏结果，以及显式选中但没有匹配记录的密钥维度。

```sql
WITH aggregates AS (
    SELECT
        date_trunc($1::text, ul.created_at AT TIME ZONE $2::text)::date AS period_start,
        ul.api_key_id,
        COUNT(*)::bigint AS record_count,
        SUM(
            ul.input_tokens::bigint
            + ul.output_tokens::bigint
            + ul.cache_creation_tokens::bigint
            + ul.cache_read_tokens::bigint
        )::bigint AS total_tokens
    FROM usage_logs AS ul
    WHERE ul.created_at >= $3::timestamptz
      AND ul.created_at < $4::timestamptz
      AND ($5::bigint IS NULL OR ul.user_id = $5::bigint)
      AND (cardinality($6::bigint[]) = 0 OR ul.api_key_id = ANY($6::bigint[]))
      AND (cardinality($7::bigint[]) = 0 OR ul.group_id = ANY($7::bigint[]))
    GROUP BY period_start, ul.api_key_id
), key_dimensions AS (
    SELECT api_key_id FROM aggregates
    UNION
    SELECT k.id AS api_key_id
    FROM api_keys AS k
    WHERE k.id = ANY($6::bigint[])
      AND ($5::bigint IS NULL OR k.user_id = $5::bigint)
)
SELECT
    d.api_key_id,
    COALESCE(NULLIF(BTRIM(k.name), ''), 'API Key #' || d.api_key_id::text) AS api_key_name,
    a.period_start,
    COALESCE(a.record_count, 0)::bigint AS record_count,
    COALESCE(a.total_tokens, 0)::bigint AS total_tokens
FROM key_dimensions AS d
LEFT JOIN aggregates AS a ON a.api_key_id = d.api_key_id
LEFT JOIN api_keys AS k
    ON k.id = d.api_key_id
   AND ($5::bigint IS NULL OR k.user_id = $5::bigint)
ORDER BY d.api_key_id ASC, a.period_start ASC NULLS FIRST;
```

`api_keys.id` 为主键，聚合之后再关联名称，不产生一对多放大；不按名称合并不同密钥。不加软删除条件，以保留历史统计；名称实体不存在时，左连接保留已有使用记录。

`group_id` 为 null 的记录在未选择分组时正常纳入，显式选择分组时不匹配。每次查询只应用所选日期范围，`date_trunc('week', ...)` 仅确定周一开始的桶，不扩大查询日期。

## 补零、排序与读取一致性

- 返回 `period_start = null` 的行表示“显式选中但当前没有记录的密钥维度”，不是发生于空日期的使用记录。该维度仍需为查询范围内每个时间段补零。
- 服务端基于同一次聚合结果生成完整“时间段 × API Key”矩阵。有聚合行时使用其 `record_count` 和 tokens，状态为 `observed`；没有聚合行时计数和 tokens 均为 0，状态为 `missing`。
- 图表系列与表格行从同一矩阵产生。先得到完整图表，再对矩阵按 tokens 全局升序/降序及时间段、密钥 ID 稳定排序，最后按表格页码分页。查询不使用 Top N，也不在读取事实前分页。
- 没有任何密钥维度时，由服务端生成 `api_key_id = null` 的全局缺失占位，供两种图表和表格展示；不能把 null 当作真实密钥 ID。
- 图表和表格在一次响应中使用同一条 SQL 的读取视图。再次查询可能包含新到达的使用记录，这是新的结果，不拼接此前响应。
- 密钥校验之后如果发生并发删除，实际聚合仍受使用记录用户范围及名称关联的用户范围约束；查询失败返回错误，不使用补零掩盖异常。
- 取消、超时、数值溢出和数据库错误通过现有错误通道返回；不允许截断或溢出回绕后当作成功数据。

## 可观察结果示例

下面是审核用样例，不是已经执行通过的测试结果。查询日期为 `2026-09-07` 至 `2026-09-09`，个人用户为 U1，选中密钥 K1/K2/K3 和分组 G1。K1 与 K2 名称都为“项目接口”，K3 没有使用记录。

| 使用记录 | 日期 | 所属用户 | 密钥 | 历史分组 | 四项 tokens 合计 | 费用 |
| --- | --- | --- | --- | --- | ---: | ---: |
| R1 | 09-07 | U1 | K1 | G1 | 120 | 大于 0 |
| R2 | 09-08 | U1 | K1 | G1 | 0 | 0 |
| R3 | 09-07 | U1 | K2 | G2 | 70 | 大于 0 |
| R4 | 09-08 | U1 | K2 | G1 | 50 | 大于 0 |
| R5 | 09-07 | U2 | K4 | G1 | 999 | 大于 0 |

预期日结果：

| 日期 | 密钥 | 用量 | 状态 |
| --- | --- | ---: | --- |
| 09-07 | K1 | 120 | observed |
| 09-08 | K1 | 0 | observed，正常零值 |
| 09-09 | K1 | 0 | missing，无数据 |
| 09-07 | K2 | 0 | missing，G2 的记录不在筛选范围 |
| 09-08 | K2 | 50 | observed |
| 09-09 | K2 | 0 | missing，无数据 |
| 每个查询日 | K3 | 0 | missing，无数据 |

图表和完整表格总量均为 170，K1/K2 同名但分别显示。切换周聚合后标签为 `2026-09-07 ~ 2026-09-13` 并标记“部分日期”，K1/K2/K3 用量分别为 120/50/0，记录条数分别为 2/1/0。升降序和表格翻页均不能把 G2 或 U2 的记录纳入结果。

边界验收还需覆盖跨年周、闰年二月、结束日最后一秒、结束日次日零点和适用时区的夏令时转换。

## 审查结论与回退

静态数据语义检查已覆盖归属、关联基数、可空分组、时间边界、真假零值及全局排序；当前没有数据库执行或性能验证证据。现有 `created_at`、`user_id + created_at`、`api_key_id + created_at`、`group_id + created_at` 索引是否足以支持目标数据规模，需要实施阶段的隔离数据验证，不能凭索引存在就宣称通过。

本方案不变更持久化数据，回退对应功能代码即可，不执行反向数据迁移。SQL 专项与 Spec 总体审核均已通过，实施进度见 [plan.md](./plan.md)。
