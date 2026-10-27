package usagestats

// ModelRankingPeriod selects the server-owned policy for a dashboard ranking.
type ModelRankingPeriod string

const (
	ModelRankingWeek     ModelRankingPeriod = "week"
	ModelRankingMonth    ModelRankingPeriod = "month"
	ModelRankingLifetime ModelRankingPeriod = "lifetime"
)

type ModelRankingOptions struct {
	MinimumTokens int64
	Limit         int
}

func (p ModelRankingPeriod) Options() (ModelRankingOptions, bool) {
	const limit = 10
	switch p {
	case ModelRankingWeek:
		return ModelRankingOptions{MinimumTokens: 1_000_000, Limit: limit}, true
	case ModelRankingMonth, ModelRankingLifetime:
		return ModelRankingOptions{MinimumTokens: 100_000_000, Limit: limit}, true
	default:
		return ModelRankingOptions{}, false
	}
}
