package repository

import (
	"context"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/Wei-Shaw/sub2api/internal/pkg/usagestats"
	"github.com/stretchr/testify/require"
)

func TestUsageLogRepositoryModelRankingSQL(t *testing.T) {
	db, mock := newSQLMock(t)
	repo := &usageLogRepository{sql: db}
	start := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 1, 0)
	query := `GROUP BY COALESCE(NULLIF(TRIM(requested_model), ''), model) HAVING COALESCE(SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens), 0) > $5 ORDER BY total_tokens DESC, COALESCE(NULLIF(TRIM(requested_model), ''), model) COLLATE "C" ASC LIMIT $6`
	mock.ExpectQuery(regexp.QuoteMeta(query)).WithArgs(start, end, int64(42), int64(9), int64(100_000_000), 10).WillReturnRows(sqlmock.NewRows([]string{"model", "requests", "input_tokens", "output_tokens", "cache_creation_tokens", "cache_read_tokens", "total_tokens", "cost", "actual_cost", "account_cost"}).AddRow("m", 1, 100_000_001, 0, 0, 0, 100_000_001, 0, 0, 0))
	options, _ := usagestats.ModelRankingMonth.Options()
	rows, err := repo.GetModelRankingWithUsageFilters(context.Background(), start, end, usagestats.UsageLogFilters{UserID: 42, GroupID: 9}, options)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, int64(100_000_001), rows[0].TotalTokens)
	require.NoError(t, mock.ExpectationsWereMet())
}
func TestUsageLogRepositoryModelRankingRejectsUnscopedQuery(t *testing.T) {
	db, mock := newSQLMock(t)
	repo := &usageLogRepository{sql: db}
	options, _ := usagestats.ModelRankingWeek.Options()
	_, err := repo.GetModelRankingWithUsageFilters(context.Background(), time.Time{}, time.Now(), usagestats.UsageLogFilters{}, options)
	require.Error(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}
