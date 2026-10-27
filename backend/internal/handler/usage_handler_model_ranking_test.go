package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/usagestats"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type dashboardRankingCapture struct {
	userUsageRepoCapture
	options usagestats.ModelRankingOptions
	filters usagestats.UsageLogFilters
	calls   int
}

func (r *dashboardRankingCapture) GetModelRankingWithUsageFilters(_ context.Context, _, _ time.Time, f usagestats.UsageLogFilters, o usagestats.ModelRankingOptions) ([]usagestats.ModelStat, error) {
	r.calls++
	r.filters = f
	r.options = o
	return []usagestats.ModelStat{{Model: "ranked", TotalTokens: 200_000_000, ActualCost: 0, AccountCost: 9}}, nil
}
func rankingRouter(repo *dashboardRankingCapture) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: 42})
		c.Next()
	})
	h := NewUsageHandler(service.NewUsageService(repo, nil, nil, nil), nil, nil, nil)
	r.GET("/models", h.DashboardModels)
	return r
}
func TestUserDashboardModelRankingPolicies(t *testing.T) {
	for _, period := range []usagestats.ModelRankingPeriod{usagestats.ModelRankingWeek, usagestats.ModelRankingMonth, usagestats.ModelRankingLifetime} {
		t.Run(string(period), func(t *testing.T) {
			repo := &dashboardRankingCapture{}
			router := rankingRouter(repo)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/models?ranking_period="+string(period)+"&start_date=2026-10-01&end_date=2026-10-26&timezone=UTC&limit=999&minimum_tokens=0", nil))
			require.Equal(t, 200, rec.Code)
			require.Equal(t, 1, repo.calls)
			want, _ := period.Options()
			require.Equal(t, want, repo.options)
			require.Equal(t, int64(42), repo.filters.UserID)
			require.Contains(t, rec.Body.String(), `"model":"ranked"`)
			require.NotContains(t, rec.Body.String(), "account_cost")
		})
	}
}
func TestUserDashboardModelRankingInvalidAndLegacy(t *testing.T) {
	repo := &dashboardRankingCapture{}
	repo.modelStats = make([]usagestats.ModelStat, 12)
	for i := range repo.modelStats {
		repo.modelStats[i] = usagestats.ModelStat{Model: "legacy", TotalTokens: 1}
	}
	router := rankingRouter(repo)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/models?ranking_period=year", nil))
	require.Equal(t, 400, rec.Code)
	require.Zero(t, repo.calls)
	for _, query := range []string{"", "?ranking_period="} {
		rec = httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/models"+query, nil))
		require.Equal(t, 200, rec.Code)
		require.Equal(t, 12, len(repo.modelStats))
		require.Contains(t, rec.Body.String(), `"total_tokens":1`)
		var response struct {
			Data struct {
				Models []usagestats.ModelStat `json:"models"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &response))
		require.Len(t, response.Data.Models, 12)
	}
	require.Zero(t, repo.calls)
}
