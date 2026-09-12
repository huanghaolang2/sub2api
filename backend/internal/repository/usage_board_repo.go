package repository

import (
	"context"
	"database/sql"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/lib/pq"
)

type usageBoardRepository struct{ sql sqlExecutor }

func NewUsageBoardRepository(db *sql.DB) service.UsageBoardRepository {
	return &usageBoardRepository{sql: db}
}

func (r *usageBoardRepository) KeyOwners(ctx context.Context, ids []int64) (owners map[int64]int64, err error) {
	rows, err := r.sql.QueryContext(ctx, `SELECT id, user_id FROM api_keys WHERE id = ANY($1::bigint[])`, pq.Array(ids))
	if err != nil {
		return nil, err
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil && err == nil {
			owners = nil
			err = closeErr
		}
	}()
	owners = make(map[int64]int64)
	for rows.Next() {
		var id, userID int64
		if err := rows.Scan(&id, &userID); err != nil {
			return nil, err
		}
		owners[id] = userID
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return owners, nil
}

func (r *usageBoardRepository) Aggregate(ctx context.Context, f service.UsageBoardFilter) (result []service.UsageBoardAggregate, err error) {
	const query = `
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
ORDER BY d.api_key_id ASC, a.period_start ASC NULLS FIRST`
	rows, err := r.sql.QueryContext(ctx, query, f.Granularity, f.Timezone, f.Start, f.End, f.UserID, pq.Array(f.APIKeyIDs), pq.Array(f.GroupIDs))
	if err != nil {
		return nil, err
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil && err == nil {
			result = nil
			err = closeErr
		}
	}()
	result = make([]service.UsageBoardAggregate, 0)
	for rows.Next() {
		var a service.UsageBoardAggregate
		var date sql.NullTime
		if err := rows.Scan(&a.APIKeyID, &a.APIKeyName, &date, &a.RecordCount, &a.TotalTokens); err != nil {
			return nil, err
		}
		if date.Valid {
			a.PeriodStart = &date.Time
		}
		result = append(result, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}
