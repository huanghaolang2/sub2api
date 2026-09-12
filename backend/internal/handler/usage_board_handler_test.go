package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type usageBoardHandlerRepo struct {
	filter service.UsageBoardFilter
	calls  int
	err    error
}

func (r *usageBoardHandlerRepo) KeyOwners(context.Context, []int64) (map[int64]int64, error) {
	return map[int64]int64{11: 1, 12: 1, 22: 2}, nil
}
func (r *usageBoardHandlerRepo) Aggregate(_ context.Context, f service.UsageBoardFilter) ([]service.UsageBoardAggregate, error) {
	r.filter = f
	r.calls++
	when := time.Date(2026, 9, 7, 0, 0, 0, 0, time.UTC)
	return []service.UsageBoardAggregate{{APIKeyID: 11, APIKeyName: "项目接口", PeriodStart: &when, RecordCount: 1, TotalTokens: 0}}, r.err
}
func usageBoardTestRouter(repo *usageBoardHandlerRepo, role string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		if role != "" {
			c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 1})
			c.Set(string(middleware.ContextKeyUserRole), role)
		}
		c.Next()
	})
	h := NewUsageBoardHandler(service.NewUsageBoardService(repo))
	r.GET("/self", h.GetSelf)
	r.GET("/admin", h.GetAdmin)
	return r
}
func TestUsageBoardHandlerScopeAndRepeatedFilters(t *testing.T) {
	for _, scope := range []struct {
		path string
		user *int64
	}{{"/self", new(int64(1))}, {"/admin", nil}} {
		r := &usageBoardHandlerRepo{}
		router := usageBoardTestRouter(r, service.RoleAdmin)
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, scope.path+"?start_date=2026-09-07&end_date=2026-09-08&api_key_ids=11&api_key_ids=12&group_ids=4&group_ids=5", nil)
		router.ServeHTTP(w, req)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		require.Equal(t, scope.user, r.filter.UserID)
		require.Equal(t, []int64{11, 12}, r.filter.APIKeyIDs)
		require.Equal(t, []int64{4, 5}, r.filter.GroupIDs)
		var body struct {
			Data service.UsageBoardResponse `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		require.Equal(t, service.UsageBoardObserved, body.Data.Series[0].Points[0].DataState)
		require.Equal(t, service.UsageBoardMissing, body.Data.Series[0].Points[1].DataState)
		require.NotContains(t, w.Body.String(), `"key":`)
	}
}
func TestUsageBoardHandlerRejectsInvalidAccessAndInput(t *testing.T) {
	for _, tc := range []struct {
		role, path, params string
		status             int
	}{
		{"", "/self", "", 401}, {service.RoleUser, "/admin", "", 403},
		{service.RoleUser, "/self", "&api_key_ids=11&api_key_ids=22", 403},
		{service.RoleAdmin, "/admin", "&api_key_ids=999", 400},
		{service.RoleUser, "/self", "&api_key_ids=bad", 400},
		{service.RoleUser, "/self", "&group_ids=-1", 400},
		{service.RoleUser, "/self", "&user_id=2", 400},
		{service.RoleUser, "/self", "&scope=admin", 400},
		{service.RoleUser, "/self", "&page=0", 400},
		{service.RoleUser, "/self", "&timezone=No/Such", 400},
		{service.RoleUser, "/self", "&granularity=month&start_month=2026-02&end_month=2026-01", 400},
	} {
		t.Run(tc.path+tc.params+tc.role, func(t *testing.T) {
			r := &usageBoardHandlerRepo{}
			router := usageBoardTestRouter(r, tc.role)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, tc.path+"?start_date=2026-09-07&end_date=2026-09-08"+tc.params, nil))
			require.Equal(t, tc.status, w.Code, w.Body.String())
			require.Zero(t, r.calls)
		})
	}
}
func TestUsageBoardHandlerDatabaseFailure(t *testing.T) {
	r := &usageBoardHandlerRepo{err: errors.New("unavailable")}
	router := usageBoardTestRouter(r, service.RoleUser)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/self?start_date=2026-09-07&end_date=2026-09-08", nil))
	require.Equal(t, 500, w.Code)
	require.NotContains(t, w.Body.String(), `"series"`)
}
