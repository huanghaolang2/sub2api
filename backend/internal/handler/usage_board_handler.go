package handler

import (
	"strconv"

	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

type UsageBoardHandler struct{ service *service.UsageBoardService }

func NewUsageBoardHandler(s *service.UsageBoardService) *UsageBoardHandler {
	return &UsageBoardHandler{service: s}
}

func (h *UsageBoardHandler) GetSelf(c *gin.Context) { h.query(c, service.UsageBoardSelf) }

func (h *UsageBoardHandler) GetAdmin(c *gin.Context) {
	if _, ok := middleware.GetAuthSubjectFromContext(c); !ok {
		response.Unauthorized(c, "User not authenticated")
		return
	}
	role, _ := middleware.GetUserRoleFromContext(c)
	if role != service.RoleAdmin {
		response.Forbidden(c, "Admin access required")
		return
	}
	h.query(c, service.UsageBoardAdmin)
}

func (h *UsageBoardHandler) query(c *gin.Context, scope service.UsageBoardScope) {
	subject, ok := middleware.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not authenticated")
		return
	}
	params := c.Request.URL.Query()
	for _, field := range []string{"user_id", "scope"} {
		if params.Has(field) {
			response.BadRequest(c, field+" cannot be set on usage board queries")
			return
		}
	}
	q := service.UsageBoardQuery{
		Granularity: service.UsageBoardGranularity(c.DefaultQuery("granularity", string(service.UsageBoardDay))),
		StartDate:   c.Query("start_date"), EndDate: c.Query("end_date"),
		StartMonth: c.Query("start_month"), EndMonth: c.Query("end_month"),
		Timezone: c.Query("timezone"), SortOrder: service.UsageBoardSortOrder(c.Query("sort_order")),
	}
	for field, target := range map[string]*[]int64{"api_key_ids": &q.APIKeyIDs, "group_ids": &q.GroupIDs} {
		for _, raw := range params[field] {
			id, err := strconv.ParseInt(raw, 10, 64)
			if err != nil || id <= 0 {
				response.BadRequest(c, "Invalid "+field)
				return
			}
			*target = append(*target, id)
		}
	}
	for field, target := range map[string]*int{"page": &q.Page, "page_size": &q.PageSize} {
		if params.Has(field) {
			n, err := strconv.Atoi(params.Get(field))
			if err != nil || n <= 0 {
				response.BadRequest(c, "Invalid "+field)
				return
			}
			*target = n
		}
	}
	result, err := h.service.Query(c.Request.Context(), scope, subject.UserID, q)
	if c.Request.Context().Err() != nil {
		return
	}
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, result)
}
