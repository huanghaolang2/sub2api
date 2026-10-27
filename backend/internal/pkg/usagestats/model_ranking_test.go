package usagestats

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func TestModelRankingOptions(t *testing.T) {
	for _, tc := range []struct {
		period  ModelRankingPeriod
		minimum int64
	}{
		{ModelRankingWeek, 1_000_000}, {ModelRankingMonth, 100_000_000}, {ModelRankingLifetime, 100_000_000},
	} {
		options, valid := tc.period.Options()
		require.True(t, valid)
		require.Equal(t, tc.minimum, options.MinimumTokens)
		require.Equal(t, 10, options.Limit)
	}
	for _, period := range []ModelRankingPeriod{"", "all", "year"} {
		_, valid := period.Options()
		require.False(t, valid)
	}
}
