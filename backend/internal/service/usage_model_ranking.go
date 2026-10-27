package service

import (
	"context"
	"fmt"
	"time"

	apperrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	"github.com/Wei-Shaw/sub2api/internal/pkg/usagestats"
)

type dashboardModelRankingRepository interface {
	GetModelRankingWithUsageFilters(context.Context, time.Time, time.Time, usagestats.UsageLogFilters, usagestats.ModelRankingOptions) ([]usagestats.ModelStat, error)
}

// GetDashboardModelRanking leaves aggregation, thresholding and Top N in SQL.
func (s *UsageService) GetDashboardModelRanking(ctx context.Context, start, end time.Time, filters usagestats.UsageLogFilters, period usagestats.ModelRankingPeriod) ([]usagestats.ModelStat, error) {
	options, valid := period.Options()
	if !valid {
		return nil, apperrors.BadRequest("MODEL_RANKING_INVALID_PERIOD", "Invalid ranking_period")
	}
	if filters.UserID <= 0 {
		return nil, apperrors.BadRequest("MODEL_RANKING_INVALID_USER", "Model ranking requires a user scope")
	}
	repo, ok := s.usageRepo.(dashboardModelRankingRepository)
	if !ok {
		return nil, fmt.Errorf("usage repository does not support database model ranking")
	}
	result, err := repo.GetModelRankingWithUsageFilters(ctx, start, end, filters, options)
	if err != nil {
		return nil, fmt.Errorf("get dashboard model ranking: %w", err)
	}
	return result, nil
}
