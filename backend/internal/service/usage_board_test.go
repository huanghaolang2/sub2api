package service

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	apperrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	"github.com/stretchr/testify/require"
)

type boardRepoStub struct {
	owners map[int64]int64
	rows   []UsageBoardAggregate
	err    error
	filter UsageBoardFilter
	called bool
}

func (r *boardRepoStub) KeyOwners(context.Context, []int64) (map[int64]int64, error) {
	return r.owners, nil
}
func (r *boardRepoStub) Aggregate(_ context.Context, f UsageBoardFilter) ([]UsageBoardAggregate, error) {
	r.called = true
	r.filter = f
	return r.rows, r.err
}
func boardQuery() UsageBoardQuery {
	return UsageBoardQuery{Granularity: UsageBoardDay, StartDate: "2026-09-07", EndDate: "2026-09-09", Timezone: "Asia/Taipei"}
}

func TestUsageBoardMatrixSortingAndMissing(t *testing.T) {
	day1, day2 := time.Date(2026, 9, 7, 0, 0, 0, 0, time.UTC), time.Date(2026, 9, 8, 0, 0, 0, 0, time.UTC)
	r := &boardRepoStub{rows: []UsageBoardAggregate{
		{APIKeyID: 1, APIKeyName: "项目接口", PeriodStart: &day1, RecordCount: 1, TotalTokens: 120},
		{APIKeyID: 1, APIKeyName: "项目接口", PeriodStart: &day2, RecordCount: 1, TotalTokens: 0},
		{APIKeyID: 2, APIKeyName: "项目接口", PeriodStart: &day2, RecordCount: 1, TotalTokens: 50},
		{APIKeyID: 3, APIKeyName: "未使用"},
	}}
	s := NewUsageBoardService(r)
	q := boardQuery()
	q.PageSize = 2
	result, err := s.Query(context.Background(), UsageBoardSelf, 42, q)
	require.NoError(t, err)
	require.Equal(t, int64(42), *r.filter.UserID)
	require.Equal(t, 9, result.Pagination.Total)
	require.Equal(t, []int64{120, 50}, []int64{result.Rows[0].TotalTokens, result.Rows[1].TotalTokens})
	require.Len(t, result.Series, 3)
	require.Equal(t, "项目接口 (#1)", result.Series[0].APIKeyName)
	require.Equal(t, "项目接口 (#2)", result.Series[1].APIKeyName)
	require.Equal(t, UsageBoardObserved, result.Series[0].Points[1].DataState)
	require.Equal(t, int64(1), result.Series[0].Points[1].RecordCount)
	require.Equal(t, UsageBoardMissing, result.Series[0].Points[2].DataState)
	for _, p := range result.Series[2].Points {
		require.Equal(t, UsageBoardMissing, p.DataState)
	}
	q.SortOrder = UsageBoardAsc
	asc, err := s.Query(context.Background(), UsageBoardSelf, 42, q)
	require.NoError(t, err)
	require.Equal(t, result.Series, asc.Series)
	require.Zero(t, asc.Rows[0].TotalTokens)
	q.Page = 5
	last, err := s.Query(context.Background(), UsageBoardSelf, 42, q)
	require.NoError(t, err)
	require.Len(t, last.Rows, 1)
	require.Equal(t, int64(120), last.Rows[0].TotalTokens)
}

func TestUsageBoardCalendarBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name        string
		q           UsageBoardQuery
		first, last string
		count       int
		coverage    UsageBoardCoverage
		hours       int
	}{
		{"cross-year week", UsageBoardQuery{Granularity: UsageBoardWeek, StartDate: "2025-12-31", EndDate: "2026-01-06", Timezone: "UTC"}, "2025-12-29 ~ 2026-01-04", "2026-01-05 ~ 2026-01-11", 2, UsageBoardPartial, 168},
		{"leap month", UsageBoardQuery{Granularity: UsageBoardMonth, StartMonth: "2024-02", EndMonth: "2024-02", Timezone: "UTC"}, "2024-02", "2024-02", 1, UsageBoardFull, 29 * 24},
		{"spring DST", UsageBoardQuery{Granularity: UsageBoardDay, StartDate: "2026-03-08", EndDate: "2026-03-08", Timezone: "America/New_York"}, "2026-03-08", "2026-03-08", 1, UsageBoardFull, 23},
		{"fall DST", UsageBoardQuery{Granularity: UsageBoardDay, StartDate: "2026-11-01", EndDate: "2026-11-01", Timezone: "America/New_York"}, "2026-11-01", "2026-11-01", 1, UsageBoardFull, 25},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := &boardRepoStub{}
			result, err := NewUsageBoardService(r).Query(context.Background(), UsageBoardSelf, 1, tc.q)
			require.NoError(t, err)
			require.Len(t, result.Periods, tc.count)
			require.Equal(t, tc.first, result.Periods[0].Label)
			require.Equal(t, tc.last, result.Periods[tc.count-1].Label)
			require.Equal(t, tc.coverage, result.Periods[0].Coverage)
			require.Equal(t, time.Duration(tc.hours)*time.Hour, r.filter.End.Sub(r.filter.Start))
			require.Nil(t, result.Series[0].APIKeyID)
			for _, row := range result.Rows {
				require.Equal(t, UsageBoardMissing, row.DataState)
			}
		})
	}
}

func TestUsageBoardInvalidAndUnauthorizedQueries(t *testing.T) {
	for _, change := range []func(*UsageBoardQuery){
		func(q *UsageBoardQuery) { q.StartDate = "2026-02-30" },
		func(q *UsageBoardQuery) { q.StartDate = "2026-09-10" },
		func(q *UsageBoardQuery) { q.Timezone = "Invalid/Zone" },
		func(q *UsageBoardQuery) { q.Granularity = "hour" },
		func(q *UsageBoardQuery) { q.APIKeyIDs = []int64{-1} },
		func(q *UsageBoardQuery) { q.StartMonth = "2026-09" },
		func(q *UsageBoardQuery) { q.SortOrder = "invalid" },
	} {
		q := boardQuery()
		change(&q)
		r := &boardRepoStub{}
		_, err := NewUsageBoardService(r).Query(context.Background(), UsageBoardSelf, 1, q)
		require.Equal(t, http.StatusBadRequest, apperrors.Code(err))
		require.False(t, r.called)
	}
	r := &boardRepoStub{owners: map[int64]int64{1: 42, 2: 99}}
	q := boardQuery()
	q.APIKeyIDs = []int64{1, 2, 1}
	_, err := NewUsageBoardService(r).Query(context.Background(), UsageBoardSelf, 42, q)
	require.Equal(t, http.StatusForbidden, apperrors.Code(err))
	require.False(t, r.called)
	_, err = NewUsageBoardService(r).Query(context.Background(), UsageBoardAdmin, 42, q)
	require.NoError(t, err)
	require.Nil(t, r.filter.UserID)
	require.Equal(t, []int64{1, 2}, r.filter.APIKeyIDs)
}

func TestUsageBoardFailureDoesNotBecomeZero(t *testing.T) {
	r := &boardRepoStub{err: errors.New("database unavailable")}
	result, err := NewUsageBoardService(r).Query(context.Background(), UsageBoardSelf, 1, boardQuery())
	require.Error(t, err)
	require.Nil(t, result)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result, err = NewUsageBoardService(r).Query(ctx, UsageBoardSelf, 1, boardQuery())
	require.ErrorIs(t, err, context.Canceled)
	require.Nil(t, result)
}
