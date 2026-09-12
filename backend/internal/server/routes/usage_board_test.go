package routes

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/handler"
	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type boardRouteUsers struct {
	service.UserRepository
	users map[int64]*service.User
}

func (r *boardRouteUsers) GetByID(_ context.Context, id int64) (*service.User, error) {
	if u, ok := r.users[id]; ok {
		return u, nil
	}
	return nil, service.ErrUserNotFound
}
func (*boardRouteUsers) GetUserAvatar(context.Context, int64) (*service.UserAvatar, error) {
	return nil, nil
}
func (*boardRouteUsers) UpdateUserLastActiveAt(context.Context, int64, time.Time) error { return nil }

type boardRouteRepo struct {
	userID *int64
	calls  int
}

func (*boardRouteRepo) KeyOwners(context.Context, []int64) (map[int64]int64, error) {
	return map[int64]int64{}, nil
}
func (r *boardRouteRepo) Aggregate(_ context.Context, f service.UsageBoardFilter) ([]service.UsageBoardAggregate, error) {
	r.userID = f.UserID
	r.calls++
	return nil, nil
}

func TestUsageBoardRegisteredRoutesUseRealAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)
	users := &boardRouteUsers{users: map[int64]*service.User{
		1: {ID: 1, Email: "user@board.test", Role: service.RoleUser, Status: service.StatusActive},
		2: {ID: 2, Email: "admin@board.test", Role: service.RoleAdmin, Status: service.StatusActive},
	}}
	cfg := &config.Config{JWT: config.JWTConfig{Secret: "usage-board-test-signing-secret", ExpireHour: 1}}
	auth := service.NewAuthService(nil, users, nil, nil, cfg, nil, nil, nil, nil, nil, nil, nil, nil)
	userSvc := service.NewUserService(users, nil, nil, nil)
	userToken, err := auth.GenerateToken(context.Background(), users.users[1])
	require.NoError(t, err)
	adminToken, err := auth.GenerateToken(context.Background(), users.users[2])
	require.NoError(t, err)
	repo := &boardRouteRepo{}
	h := &handler.Handlers{Admin: &handler.AdminHandlers{}, UsageBoard: handler.NewUsageBoardHandler(service.NewUsageBoardService(repo))}
	r := gin.New()
	audit := middleware.AuditLogMiddleware(func(c *gin.Context) { c.Next() })
	stepUp := middleware.StepUpAuthMiddleware(func(c *gin.Context) { c.Next() })
	RegisterUserRoutes(r.Group("/api/v1"), h, middleware.NewJWTAuthMiddleware(auth, userSvc, nil, nil), audit, nil, nil)
	RegisterAdminRoutes(r.Group("/api/v1"), h, middleware.NewAdminAuthMiddleware(auth, userSvc, nil, nil), audit, stepUp, nil, nil)
	for _, tc := range []struct {
		name, path, token string
		status            int
		owner             *int64
	}{
		{"anonymous personal", "/usage/board", "", 401, nil},
		{"anonymous admin", "/admin/usage/board", "", 401, nil},
		{"ordinary user personal", "/usage/board", userToken, 200, new(int64(1))},
		{"ordinary user rejected by admin middleware", "/admin/usage/board", userToken, 403, nil},
		{"admin personal remains scoped", "/usage/board", adminToken, 200, new(int64(2))},
		{"admin management", "/admin/usage/board", adminToken, 200, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo.calls = 0
			w := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/v1"+tc.path+"?start_date=2026-09-07&end_date=2026-09-09", nil)
			if tc.token != "" {
				req.Header.Set("Authorization", "Bearer "+tc.token)
			}
			r.ServeHTTP(w, req)
			require.Equal(t, tc.status, w.Code, w.Body.String())
			if tc.status == 200 {
				require.Equal(t, 1, repo.calls)
				require.Equal(t, tc.owner, repo.userID)
			} else {
				require.Zero(t, repo.calls)
			}
		})
	}
}
