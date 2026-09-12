package service

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	apperrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
)

type UsageBoardGranularity string
type UsageBoardScope string
type UsageBoardDataState string
type UsageBoardSortOrder string
type UsageBoardCoverage string

const (
	UsageBoardDay      UsageBoardGranularity = "day"
	UsageBoardWeek     UsageBoardGranularity = "week"
	UsageBoardMonth    UsageBoardGranularity = "month"
	UsageBoardSelf     UsageBoardScope       = "self"
	UsageBoardAdmin    UsageBoardScope       = "admin"
	UsageBoardObserved UsageBoardDataState   = "observed"
	UsageBoardMissing  UsageBoardDataState   = "missing"
	UsageBoardAsc      UsageBoardSortOrder   = "asc"
	UsageBoardDesc     UsageBoardSortOrder   = "desc"
	UsageBoardFull     UsageBoardCoverage    = "full"
	UsageBoardPartial  UsageBoardCoverage    = "partial"
)

type UsageBoardQuery struct {
	Granularity                                        UsageBoardGranularity
	StartDate, EndDate, StartMonth, EndMonth, Timezone string
	APIKeyIDs, GroupIDs                                []int64
	SortOrder                                          UsageBoardSortOrder
	Page, PageSize                                     int
}

// UsageBoardFilter is constructed by the service after validation and authorization.
type UsageBoardFilter struct {
	Granularity         UsageBoardGranularity
	Timezone            string
	Start, End          time.Time
	UserID              *int64
	APIKeyIDs, GroupIDs []int64
}

type UsageBoardAggregate struct {
	APIKeyID                 int64
	APIKeyName               string
	PeriodStart              *time.Time
	RecordCount, TotalTokens int64
}

type UsageBoardRepository interface {
	KeyOwners(context.Context, []int64) (map[int64]int64, error)
	Aggregate(context.Context, UsageBoardFilter) ([]UsageBoardAggregate, error)
}

type UsageBoardPeriod struct {
	Start    string             `json:"start"`
	End      string             `json:"end"`
	Label    string             `json:"label"`
	Coverage UsageBoardCoverage `json:"coverage"`
}

type UsageBoardPoint struct {
	PeriodStart string              `json:"period_start"`
	TotalTokens int64               `json:"total_tokens"`
	RecordCount int64               `json:"record_count"`
	DataState   UsageBoardDataState `json:"data_state"`
}

type UsageBoardSeries struct {
	APIKeyID   *int64            `json:"api_key_id"`
	APIKeyName string            `json:"api_key_name"`
	Points     []UsageBoardPoint `json:"points"`
}

type UsageBoardRow struct {
	UsageBoardPoint
	PeriodLabel string             `json:"period_label"`
	Coverage    UsageBoardCoverage `json:"coverage"`
	APIKeyID    *int64             `json:"api_key_id"`
	APIKeyName  string             `json:"api_key_name"`
}

type UsageBoardPagination struct {
	Page     int `json:"page"`
	PageSize int `json:"page_size"`
	Total    int `json:"total"`
	Pages    int `json:"pages"`
}

type UsageBoardResponse struct {
	Granularity UsageBoardGranularity `json:"granularity"`
	Timezone    string                `json:"timezone"`
	StartDate   string                `json:"start_date"`
	EndDate     string                `json:"end_date"`
	Periods     []UsageBoardPeriod    `json:"periods"`
	Series      []UsageBoardSeries    `json:"series"`
	Rows        []UsageBoardRow       `json:"rows"`
	Pagination  UsageBoardPagination  `json:"pagination"`
}

type UsageBoardService struct{ repo UsageBoardRepository }

func NewUsageBoardService(repo UsageBoardRepository) *UsageBoardService {
	return &UsageBoardService{repo: repo}
}

func usageBoardInvalid(message string) error {
	return apperrors.BadRequest("USAGE_BOARD_INVALID_QUERY", message)
}

func usageBoardIDs(ids []int64) ([]int64, error) {
	unique := make(map[int64]struct{}, len(ids))
	result := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id <= 0 {
			return nil, usageBoardInvalid("IDs must be positive integers")
		}
		if _, exists := unique[id]; !exists {
			unique[id] = struct{}{}
			result = append(result, id)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result, nil
}

func normalizeUsageBoardQuery(q UsageBoardQuery) (UsageBoardQuery, UsageBoardFilter, error) {
	f := UsageBoardFilter{Granularity: q.Granularity, Timezone: q.Timezone}
	if f.Timezone == "" {
		f.Timezone = "UTC"
	}
	// "Local" is a machine setting, not a portable client timezone.
	if f.Timezone == "Local" {
		return q, f, usageBoardInvalid("Invalid timezone")
	}
	loc, err := time.LoadLocation(f.Timezone)
	if err != nil {
		return q, f, usageBoardInvalid("Invalid timezone")
	}
	layout, from, to := "2006-01-02", q.StartDate, q.EndDate
	switch q.Granularity {
	case UsageBoardDay, UsageBoardWeek:
		if q.StartMonth != "" || q.EndMonth != "" {
			return q, f, usageBoardInvalid("Use dates for day/week granularity")
		}
	case UsageBoardMonth:
		layout, from, to = "2006-01", q.StartMonth, q.EndMonth
		if q.StartDate != "" || q.EndDate != "" {
			return q, f, usageBoardInvalid("Use months for month granularity")
		}
	default:
		return q, f, usageBoardInvalid("Invalid granularity")
	}
	f.Start, err = time.ParseInLocation(layout, from, loc)
	if err != nil || f.Start.Format(layout) != from || f.Start.Year() < 1 {
		return q, f, usageBoardInvalid("Invalid start date/month")
	}
	end, err := time.ParseInLocation(layout, to, loc)
	if err != nil || end.Format(layout) != to || end.Year() < 1 {
		return q, f, usageBoardInvalid("Invalid end date/month")
	}
	if f.Start.After(end) {
		return q, f, usageBoardInvalid("Start must not be after end")
	}
	if q.Granularity == UsageBoardMonth {
		f.End = end.AddDate(0, 1, 0)
	} else {
		f.End = end.AddDate(0, 0, 1)
	}
	f.APIKeyIDs, err = usageBoardIDs(q.APIKeyIDs)
	if err != nil {
		return q, f, err
	}
	f.GroupIDs, err = usageBoardIDs(q.GroupIDs)
	if err != nil {
		return q, f, err
	}
	if q.SortOrder == "" {
		q.SortOrder = UsageBoardDesc
	}
	if q.SortOrder != UsageBoardAsc && q.SortOrder != UsageBoardDesc {
		return q, f, usageBoardInvalid("Invalid sort order")
	}
	if q.Page == 0 {
		q.Page = 1
	}
	if q.PageSize == 0 {
		q.PageSize = 20
	}
	if q.Page < 1 || q.PageSize < 1 || q.PageSize > 1000 {
		return q, f, usageBoardInvalid("Invalid pagination")
	}
	return q, f, nil
}

func usageBoardPeriods(ctx context.Context, f UsageBoardFilter) ([]UsageBoardPeriod, error) {
	start := f.Start
	if f.Granularity == UsageBoardWeek {
		start = start.AddDate(0, 0, -(int(start.Weekday())+6)%7)
	}
	periods := make([]UsageBoardPeriod, 0)
	for current := start; current.Before(f.End); {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		next := current.AddDate(0, 0, 1)
		switch f.Granularity {
		case UsageBoardWeek:
			next = current.AddDate(0, 0, 7)
		case UsageBoardMonth:
			next = current.AddDate(0, 1, 0)
		}
		p := UsageBoardPeriod{Start: current.Format("2006-01-02"), End: next.AddDate(0, 0, -1).Format("2006-01-02"), Coverage: UsageBoardFull}
		p.Label = p.Start
		if f.Granularity == UsageBoardWeek {
			p.Label = p.Start + " ~ " + p.End
		}
		if f.Granularity == UsageBoardMonth {
			p.Label = current.Format("2006-01")
		}
		if current.Before(f.Start) || next.After(f.End) {
			p.Coverage = UsageBoardPartial
		}
		periods = append(periods, p)
		current = next
	}
	return periods, nil
}

func (s *UsageBoardService) Query(ctx context.Context, scope UsageBoardScope, userID int64, query UsageBoardQuery) (*UsageBoardResponse, error) {
	q, filter, err := normalizeUsageBoardQuery(query)
	if err != nil {
		return nil, err
	}
	switch scope {
	case UsageBoardSelf:
		if userID <= 0 {
			return nil, apperrors.Unauthorized("USAGE_BOARD_UNAUTHENTICATED", "User not authenticated")
		}
		filter.UserID = &userID
	case UsageBoardAdmin:
	default:
		return nil, apperrors.Forbidden("USAGE_BOARD_FORBIDDEN", "Invalid usage scope")
	}
	if len(filter.APIKeyIDs) > 0 {
		owners, err := s.repo.KeyOwners(ctx, filter.APIKeyIDs)
		if err != nil {
			return nil, err
		}
		for _, id := range filter.APIKeyIDs {
			owner, exists := owners[id]
			if scope == UsageBoardSelf && (!exists || owner != userID) {
				return nil, apperrors.Forbidden("USAGE_BOARD_FORBIDDEN", "Not authorized to access selected API keys")
			}
			if !exists {
				return nil, usageBoardInvalid("Selected API key does not exist")
			}
		}
	}
	periods, err := usageBoardPeriods(ctx, filter)
	if err != nil {
		return nil, err
	}
	aggregates, err := s.repo.Aggregate(ctx, filter)
	if err != nil {
		return nil, err
	}
	result := &UsageBoardResponse{Granularity: filter.Granularity, Timezone: filter.Timezone, StartDate: filter.Start.Format("2006-01-02"), EndDate: filter.End.AddDate(0, 0, -1).Format("2006-01-02"), Periods: periods, Series: make([]UsageBoardSeries, 0), Rows: make([]UsageBoardRow, 0)}
	type cellKey struct {
		id     int64
		period string
	}
	cells := make(map[cellKey]UsageBoardAggregate, len(aggregates))
	names := make(map[int64]string)
	for _, a := range aggregates {
		name := strings.TrimSpace(a.APIKeyName)
		if name == "" {
			name = fmt.Sprintf("API Key #%d", a.APIKeyID)
		}
		names[a.APIKeyID] = name
		if a.PeriodStart != nil {
			cells[cellKey{a.APIKeyID, a.PeriodStart.Format("2006-01-02")}] = a
		}
	}
	ids := make([]int64, 0, len(names))
	nameCounts := make(map[string]int)
	for id, name := range names {
		ids = append(ids, id)
		nameCounts[name]++
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	appendSeries := func(id *int64, name string) error {
		series := UsageBoardSeries{APIKeyID: id, APIKeyName: name, Points: make([]UsageBoardPoint, 0, len(periods))}
		for _, p := range periods {
			if err := ctx.Err(); err != nil {
				return err
			}
			point := UsageBoardPoint{PeriodStart: p.Start, DataState: UsageBoardMissing}
			if id != nil {
				if a, ok := cells[cellKey{*id, p.Start}]; ok && a.RecordCount > 0 {
					point.TotalTokens, point.RecordCount, point.DataState = a.TotalTokens, a.RecordCount, UsageBoardObserved
				}
			}
			series.Points = append(series.Points, point)
			result.Rows = append(result.Rows, UsageBoardRow{UsageBoardPoint: point, PeriodLabel: p.Label, Coverage: p.Coverage, APIKeyID: id, APIKeyName: name})
		}
		result.Series = append(result.Series, series)
		return nil
	}
	for _, id := range ids {
		name := names[id]
		if nameCounts[name] > 1 {
			name = fmt.Sprintf("%s (#%d)", name, id)
		}
		if err := appendSeries(&id, name); err != nil {
			return nil, err
		}
	}
	if len(ids) == 0 {
		if err := appendSeries(nil, "—"); err != nil {
			return nil, err
		}
	}
	sort.SliceStable(result.Rows, func(i, j int) bool {
		a, b := result.Rows[i], result.Rows[j]
		if a.TotalTokens != b.TotalTokens {
			if q.SortOrder == UsageBoardAsc {
				return a.TotalTokens < b.TotalTokens
			}
			return a.TotalTokens > b.TotalTokens
		}
		if a.PeriodStart != b.PeriodStart {
			return a.PeriodStart < b.PeriodStart
		}
		return a.APIKeyID != nil && b.APIKeyID != nil && *a.APIKeyID < *b.APIKeyID
	})
	total := len(result.Rows)
	pages := max(1, (total+q.PageSize-1)/q.PageSize)
	page := min(q.Page, pages)
	offset := (page - 1) * q.PageSize
	result.Rows = result.Rows[offset:min(offset+q.PageSize, total)]
	result.Pagination = UsageBoardPagination{Page: page, PageSize: q.PageSize, Total: total, Pages: pages}
	return result, nil
}
