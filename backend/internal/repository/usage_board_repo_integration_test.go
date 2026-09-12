//go:build integration

package repository

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/stretchr/testify/require"
)

func TestUsageBoardRecordsMatrixAndIsolation(t *testing.T) {
	ctx := context.Background()
	tx := testEntTx(t)
	client := tx.Client()
	u1 := mustCreateUser(t, client, &service.User{})
	u2 := mustCreateUser(t, client, &service.User{})
	g1 := mustCreateGroup(t, client, &service.Group{Name: "board G1"})
	g2 := mustCreateGroup(t, client, &service.Group{Name: "board G2"})
	k1 := mustCreateApiKey(t, client, &service.APIKey{UserID: u1.ID, Key: "board-k1", Name: "项目接口"})
	k2 := mustCreateApiKey(t, client, &service.APIKey{UserID: u1.ID, Key: "board-k2", Name: "项目接口"})
	k3 := mustCreateApiKey(t, client, &service.APIKey{UserID: u1.ID, Key: "board-k3", Name: "unused"})
	k4 := mustCreateApiKey(t, client, &service.APIKey{UserID: u2.ID, Key: "board-k4", Name: "other"})
	account := mustCreateAccount(t, client, &service.Account{Name: "board account"})
	loc, err := time.LoadLocation("Asia/Taipei")
	require.NoError(t, err)
	type input struct {
		day, hour, minute, second int
		user, key                 int64
		group                     *int64
		tokens                    int
	}
	inputs := []input{
		{7, 0, 0, 0, u1.ID, k1.ID, &g1.ID, 120},
		{8, 12, 0, 0, u1.ID, k1.ID, &g1.ID, 0},
		{7, 12, 0, 0, u1.ID, k2.ID, &g2.ID, 70},
		{8, 23, 59, 59, u1.ID, k2.ID, &g1.ID, 50},
		{7, 12, 0, 0, u2.ID, k4.ID, &g1.ID, 999},
		{10, 0, 0, 0, u1.ID, k1.ID, &g1.ID, 777},
		{6, 23, 59, 59, u1.ID, k1.ID, &g1.ID, 888},
		{9, 23, 59, 59, u1.ID, k1.ID, nil, 11},
	}
	for i, in := range inputs {
		builder := client.UsageLog.Create().SetUserID(in.user).SetAPIKeyID(in.key).SetAccountID(account.ID).SetRequestID(fmt.Sprintf("board-r%d", i)).SetModel("test").SetCreatedAt(time.Date(2026, 9, in.day, in.hour, in.minute, in.second, 0, loc))
		if in.tokens > 0 {
			builder.SetInputTokens(in.tokens - 3).SetOutputTokens(1).SetCacheCreationTokens(1).SetCacheReadTokens(1)
		}
		if in.group != nil {
			builder.SetGroupID(*in.group)
		}
		_, err := builder.Save(ctx)
		require.NoError(t, err)
	}
	// Historical records remain available after a key is soft-deleted.
	_, err = tx.ExecContext(ctx, "UPDATE api_keys SET deleted_at = NOW() WHERE id = $1", k1.ID)
	require.NoError(t, err)
	svc := service.NewUsageBoardService(&usageBoardRepository{sql: tx})
	q := service.UsageBoardQuery{Granularity: service.UsageBoardDay, StartDate: "2026-09-07", EndDate: "2026-09-09", Timezone: "Asia/Taipei", APIKeyIDs: []int64{k1.ID, k2.ID, k3.ID}, GroupIDs: []int64{g1.ID}, PageSize: 2}
	result, err := svc.Query(ctx, service.UsageBoardSelf, u1.ID, q)
	require.NoError(t, err)
	require.Equal(t, 9, result.Pagination.Total)
	require.Len(t, result.Series, 3)
	require.Equal(t, int64(120), result.Rows[0].TotalTokens)
	require.Equal(t, int64(50), result.Rows[1].TotalTokens)
	require.Equal(t, service.UsageBoardObserved, result.Series[0].Points[1].DataState)
	require.Equal(t, service.UsageBoardMissing, result.Series[0].Points[2].DataState)
	var sum int64
	for _, series := range result.Series {
		for _, point := range series.Points {
			sum += point.TotalTokens
		}
	}
	require.Equal(t, int64(170), sum)
	q.SortOrder = service.UsageBoardAsc
	q.Page = 5
	asc, err := svc.Query(ctx, service.UsageBoardSelf, u1.ID, q)
	require.NoError(t, err)
	require.Equal(t, result.Series, asc.Series)
	require.Equal(t, int64(120), asc.Rows[0].TotalTokens)
	q.Granularity = service.UsageBoardWeek
	q.Page = 1
	q.PageSize = 20
	week, err := svc.Query(ctx, service.UsageBoardSelf, u1.ID, q)
	require.NoError(t, err)
	require.Equal(t, "2026-09-07 ~ 2026-09-13", week.Periods[0].Label)
	require.Equal(t, service.UsageBoardPartial, week.Periods[0].Coverage)
	require.Equal(t, int64(2), week.Series[0].Points[0].RecordCount)
	require.Equal(t, int64(120), week.Series[0].Points[0].TotalTokens)
	q.Granularity = service.UsageBoardDay
	q.APIKeyIDs = nil
	q.GroupIDs = nil
	self, err := svc.Query(ctx, service.UsageBoardSelf, u1.ID, q)
	require.NoError(t, err)
	require.Len(t, self.Series, 2)
	var selfSum int64
	for _, s := range self.Series {
		for _, p := range s.Points {
			selfSum += p.TotalTokens
		}
	}
	require.Equal(t, int64(251), selfSum)
	admin, err := svc.Query(ctx, service.UsageBoardAdmin, u1.ID, q)
	require.NoError(t, err)
	require.Len(t, admin.Series, 3)
	q.APIKeyIDs = []int64{k1.ID, k4.ID}
	_, err = svc.Query(ctx, service.UsageBoardSelf, u1.ID, q)
	require.Error(t, err)
}

func TestUsageBoardDatabaseCalendarBoundaries(t *testing.T) {
	ctx := context.Background()
	tx := testEntTx(t)
	client := tx.Client()
	user := mustCreateUser(t, client, &service.User{})
	key := mustCreateApiKey(t, client, &service.APIKey{UserID: user.ID, Key: "board-calendar", Name: "calendar"})
	account := mustCreateAccount(t, client, &service.Account{Name: "calendar account"})
	for i, stamp := range []string{"2025-12-31T12:00:00Z", "2026-01-04T23:59:59Z", "2026-01-05T00:00:00Z", "2024-02-29T23:59:59Z", "2024-03-01T00:00:00Z", "2026-03-08T05:00:00Z", "2026-03-09T03:59:59Z", "2026-03-09T04:00:00Z"} {
		when, err := time.Parse(time.RFC3339, stamp)
		require.NoError(t, err)
		_, err = client.UsageLog.Create().SetUserID(user.ID).SetAPIKeyID(key.ID).SetAccountID(account.ID).SetRequestID(fmt.Sprintf("board-calendar-%d", i)).SetModel("test").SetInputTokens(1).SetCreatedAt(when).Save(ctx)
		require.NoError(t, err)
	}
	svc := service.NewUsageBoardService(&usageBoardRepository{sql: tx})
	for _, tc := range []struct {
		q      service.UsageBoardQuery
		counts []int64
	}{
		{service.UsageBoardQuery{Granularity: service.UsageBoardWeek, StartDate: "2025-12-31", EndDate: "2026-01-06", Timezone: "UTC"}, []int64{2, 1}},
		{service.UsageBoardQuery{Granularity: service.UsageBoardMonth, StartMonth: "2024-02", EndMonth: "2024-02", Timezone: "UTC"}, []int64{1}},
		{service.UsageBoardQuery{Granularity: service.UsageBoardDay, StartDate: "2026-03-08", EndDate: "2026-03-08", Timezone: "America/New_York"}, []int64{2}},
	} {
		result, err := svc.Query(ctx, service.UsageBoardSelf, user.ID, tc.q)
		require.NoError(t, err)
		require.Len(t, result.Series, 1)
		require.Len(t, result.Series[0].Points, len(tc.counts))
		for i, count := range tc.counts {
			require.Equal(t, count, result.Series[0].Points[i].RecordCount)
		}
	}
}
