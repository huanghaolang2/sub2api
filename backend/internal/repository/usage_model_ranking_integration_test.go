//go:build integration

package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/usagestats"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/stretchr/testify/require"
)

func TestUsageModelRankingBoundariesAndAggregation(t *testing.T) {
	for _, period := range []usagestats.ModelRankingPeriod{usagestats.ModelRankingWeek, usagestats.ModelRankingMonth, usagestats.ModelRankingLifetime} {
		t.Run(string(period), func(t *testing.T) {
			ctx := context.Background()
			tx := testEntTx(t)
			client := tx.Client()
			u := mustCreateUser(t, client, &service.User{})
			other := mustCreateUser(t, client, &service.User{})
			key := mustCreateApiKey(t, client, &service.APIKey{UserID: u.ID, Key: fmt.Sprintf("ranking-%d", u.ID), Name: "ranking"})
			otherKey := mustCreateApiKey(t, client, &service.APIKey{UserID: other.ID, Key: fmt.Sprintf("ranking-%d", other.ID), Name: "other"})
			account := mustCreateAccount(t, client, &service.Account{Name: "ranking"})
			start := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
			end := start.AddDate(0, 1, 0)
			options, _ := period.Options()
			min := int(options.MinimumTokens)
			sequence := 0
			add := func(model, requested string, input, output, create, read int, user, apiKey int64, when time.Time) {
				sequence++
				_, err := client.UsageLog.Create().SetRequestID(fmt.Sprintf("ranking-boundary-%d-%d", u.ID, sequence)).SetUserID(user).SetAPIKeyID(apiKey).SetAccountID(account.ID).
					SetModel(model).SetRequestedModel(requested).SetInputTokens(input).SetOutputTokens(output).
					SetCacheCreationTokens(create).SetCacheReadTokens(read).SetCreatedAt(when).Save(ctx)
				require.NoError(t, err)
			}
			add("billing", "edge-below", min-1, 0, 0, 0, u.ID, key.ID, start)
			add("billing", "edge-equal", min, 0, 0, 0, u.ID, key.ID, start)
			add("billing", "edge-above", min-3, 1, 1, 2, u.ID, key.ID, start)
			add("upstream-a", "aggregate", min/2, 0, 0, 0, u.ID, key.ID, start)
			add("upstream-b", "aggregate", min/2+1, 0, 0, 0, u.ID, key.ID, start)
			add("legacy", "", min+2, 0, 0, 0, u.ID, key.ID, start)
			add("billing", "outsider", min*2, 0, 0, 0, other.ID, otherKey.ID, start)
			add("billing", "outside-date", min*2, 0, 0, 0, u.ID, key.ID, end)
			repo := &usageLogRepository{sql: tx}
			rows, err := repo.GetModelRankingWithUsageFilters(ctx, start, end, usagestats.UsageLogFilters{UserID: u.ID}, options)
			require.NoError(t, err)
			require.Len(t, rows, 3)
			require.Equal(t, []string{"legacy", "aggregate", "edge-above"}, []string{rows[0].Model, rows[1].Model, rows[2].Model})
			require.Equal(t, options.MinimumTokens+1, rows[1].TotalTokens)
			require.Equal(t, int64(2), rows[1].Requests)
			require.Equal(t, options.MinimumTokens+1, rows[2].TotalTokens)
			require.Zero(t, rows[2].ActualCost)
			require.Equal(t, int64(1), rows[2].CacheCreationTokens)
			require.Equal(t, int64(2), rows[2].CacheReadTokens)
		})
	}
}

func TestUsageModelRankingTopTenCompatibilityAndVolume(t *testing.T) {
	ctx := context.Background()
	tx := testEntTx(t)
	client := tx.Client()
	u := mustCreateUser(t, client, &service.User{})
	key := mustCreateApiKey(t, client, &service.APIKey{UserID: u.ID, Key: fmt.Sprintf("top-ranking-%d", u.ID), Name: "ranking"})
	account := mustCreateAccount(t, client, &service.Account{Name: "top ranking"})
	start := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 1, 0)
	options, _ := usagestats.ModelRankingMonth.Options()
	add := func(model string, tokens int) {
		_, err := client.UsageLog.Create().SetRequestID(fmt.Sprintf("ranking-top-%d-%s", u.ID, model)).SetUserID(u.ID).SetAPIKeyID(key.ID).SetAccountID(account.ID).
			SetModel(model).SetRequestedModel(model).SetInputTokens(tokens).SetCreatedAt(start).Save(ctx)
		require.NoError(t, err)
	}
	for i := 0; i < 15; i++ {
		add(fmt.Sprintf("rank-%02d", i), int(options.MinimumTokens)+1+i*100)
	}
	add("tie-b", int(options.MinimumTokens)+5000)
	add("tie-a", int(options.MinimumTokens)+5000)
	add("low", int(options.MinimumTokens))
	repo := &usageLogRepository{sql: tx}
	filters := usagestats.UsageLogFilters{UserID: u.ID}
	before := time.Now()
	full, err := repo.GetModelStatsWithUsageFiltersBySource(ctx, start, end, filters, usagestats.ModelSourceRequested)
	require.NoError(t, err)
	fullElapsed := time.Since(before)
	before = time.Now()
	ranked, err := repo.GetModelRankingWithUsageFilters(ctx, start, end, filters, options)
	require.NoError(t, err)
	rankingElapsed := time.Since(before)
	require.Len(t, full, 18)
	require.Len(t, ranked, 10)
	require.Equal(t, "tie-a", ranked[0].Model)
	require.Equal(t, "tie-b", ranked[1].Model)
	for i := 2; i < 10; i++ {
		require.Equal(t, fmt.Sprintf("rank-%02d", 16-i), ranked[i].Model)
	}
	fullJSON, err := json.Marshal(full)
	require.NoError(t, err)
	rankingJSON, err := json.Marshal(ranked)
	require.NoError(t, err)
	require.Less(t, len(rankingJSON), len(fullJSON))
	t.Logf("same transaction/data/range: full rows=%d bytes=%d duration=%s; ranking rows=%d bytes=%d duration=%s (timing observational only)", len(full), len(fullJSON), fullElapsed, len(ranked), len(rankingJSON), rankingElapsed)
}
