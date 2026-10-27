package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/usagestats"
	"github.com/stretchr/testify/require"
)

type rankingUsageStub struct {
	UsageLogRepository
	options usagestats.ModelRankingOptions
	filters usagestats.UsageLogFilters
	calls   int
	err     error
}

func (r *rankingUsageStub) GetModelRankingWithUsageFilters(_ context.Context, _, _ time.Time, f usagestats.UsageLogFilters, o usagestats.ModelRankingOptions) ([]usagestats.ModelStat, error) {
	r.calls++
	r.filters = f
	r.options = o
	return []usagestats.ModelStat{{Model: "kept", TotalTokens: 100_000_001}}, r.err
}
func TestUsageModelRankingPolicyAndScope(t *testing.T) {
	r := &rankingUsageStub{}
	s := NewUsageService(r, nil, nil, nil)
	for _, p := range []usagestats.ModelRankingPeriod{usagestats.ModelRankingWeek, usagestats.ModelRankingMonth, usagestats.ModelRankingLifetime} {
		result, err := s.GetDashboardModelRanking(context.Background(), time.Time{}, time.Now(), usagestats.UsageLogFilters{UserID: 42, Model: "requested"}, p)
		require.NoError(t, err)
		require.Equal(t, "kept", result[0].Model)
		want, _ := p.Options()
		require.Equal(t, want, r.options)
		require.Equal(t, int64(42), r.filters.UserID)
		require.Equal(t, "requested", r.filters.Model)
	}
	_, err := s.GetDashboardModelRanking(context.Background(), time.Time{}, time.Now(), usagestats.UsageLogFilters{UserID: 42}, "invalid")
	require.Error(t, err)
	_, err = s.GetDashboardModelRanking(context.Background(), time.Time{}, time.Now(), usagestats.UsageLogFilters{}, usagestats.ModelRankingWeek)
	require.Error(t, err)
	require.Equal(t, 3, r.calls)
	r.err = errors.New("database unavailable")
	_, err = s.GetDashboardModelRanking(context.Background(), time.Time{}, time.Now(), usagestats.UsageLogFilters{UserID: 42}, usagestats.ModelRankingWeek)
	require.ErrorContains(t, err, "database unavailable")
}
func TestUsageModelRankingDoesNotFallBackToFullStats(t *testing.T) {
	s := NewUsageService(struct{ UsageLogRepository }{}, nil, nil, nil)
	_, err := s.GetDashboardModelRanking(context.Background(), time.Time{}, time.Now(), usagestats.UsageLogFilters{UserID: 42}, usagestats.ModelRankingWeek)
	require.ErrorContains(t, err, "does not support database model ranking")
}
