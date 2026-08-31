package apicompat

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandlerRouteMatrix(t *testing.T) {
	t.Parallel()

	routes := []struct {
		method       string
		relativePath string
	}{
		{method: http.MethodPost, relativePath: "/messages"},
		{method: http.MethodPost, relativePath: "/messages/count_tokens"},
		{method: http.MethodGet, relativePath: "/models"},
		{method: http.MethodPost, relativePath: "/responses"},
		{method: http.MethodPost, relativePath: "/responses/compact/detail"},
		{method: http.MethodGet, relativePath: "/responses"},
		{method: http.MethodPost, relativePath: "/chat/completions"},
		{method: http.MethodPost, relativePath: "/embeddings"},
		{method: http.MethodPost, relativePath: "/images/generations"},
		{method: http.MethodPost, relativePath: "/images/edits"},
		{method: http.MethodPost, relativePath: "/images/generations/async"},
		{method: http.MethodPost, relativePath: "/images/edits/async"},
		{method: http.MethodGet, relativePath: "/images/tasks/task-123"},
		{method: http.MethodPost, relativePath: "/images/batches"},
		{method: http.MethodGet, relativePath: "/images/batches"},
		{method: http.MethodGet, relativePath: "/images/batches/models"},
		{method: http.MethodGet, relativePath: "/images/batches/batch-123"},
		{method: http.MethodGet, relativePath: "/images/batches/batch-123/items"},
		{method: http.MethodGet, relativePath: "/images/batches/batch-123/items/item-456/content"},
		{method: http.MethodGet, relativePath: "/images/batches/batch-123/download"},
		{method: http.MethodPost, relativePath: "/images/batches/batch-123/cancel"},
		{method: http.MethodDelete, relativePath: "/images/batches/batch-123"},
		{method: http.MethodDelete, relativePath: "/images/batches/batch-123/outputs"},
		{method: http.MethodPost, relativePath: "/videos"},
		{method: http.MethodPost, relativePath: "/videos/generations"},
		{method: http.MethodPost, relativePath: "/videos/edits"},
		{method: http.MethodPost, relativePath: "/videos/extensions"},
		{method: http.MethodGet, relativePath: "/videos/generations/request-123/content"},
		{method: http.MethodGet, relativePath: "/videos/edits/request-123/content"},
		{method: http.MethodGet, relativePath: "/videos/extensions/request-123/content"},
		{method: http.MethodGet, relativePath: "/videos/generations/request-123"},
		{method: http.MethodGet, relativePath: "/videos/edits/request-123"},
		{method: http.MethodGet, relativePath: "/videos/extensions/request-123"},
		{method: http.MethodGet, relativePath: "/videos/request-123"},
		{method: http.MethodGet, relativePath: "/videos/request-123/content"},
	}

	for _, prefix := range []string{aiEndpointVersionedPrefix, aiEndpointLegacyPrefix} {
		for _, route := range routes {
			name := route.method + "_" + strings.Trim(strings.ReplaceAll(prefix+route.relativePath, "/", "_"), "_")
			t.Run(name, func(t *testing.T) {
				t.Parallel()
				var gotPath string
				next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					gotPath = r.URL.Path
					w.WriteHeader(http.StatusNoContent)
				})
				handler := Handler(next)
				req := httptest.NewRequest(route.method, prefix+route.relativePath, nil)
				rec := httptest.NewRecorder()

				handler.ServeHTTP(rec, req)

				assertEqual(t, http.StatusNoContent, rec.Code)
				assertEqual(t, aiEndpointInternalPrefix+route.relativePath, gotPath)
			})
		}
	}
}

func TestHandlerLeavesUnlistedRequestsUntouched(t *testing.T) {
	t.Parallel()

	tests := []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/api/v1/messages"},
		{method: http.MethodPost, path: "/api/v1/messages/extra"},
		{method: http.MethodGet, path: "/api/v1/admin/users"},
		{method: http.MethodPost, path: "/api/v1/auth/login"},
		{method: http.MethodGet, path: "/api/v10/models"},
		{method: http.MethodGet, path: "/api/v1beta/models"},
		{method: http.MethodPost, path: "/api/v1/v1beta/models/gemini:generateContent"},
		{method: http.MethodPost, path: "/api/v1/tts"},
		{method: http.MethodPost, path: "/api/v1/web_search"},
		{method: http.MethodPost, path: "/api/v1/images/tasks/task-123"},
		{method: http.MethodGet, path: "/api/v1/images/tasks/task-123/extra"},
		{method: http.MethodGet, path: "/api/v1/imagesfoo/tasks/task-123"},
		{method: http.MethodPost, path: "/api/v1/messages/"},
		{method: http.MethodPost, path: "/v1/messages"},
		{method: http.MethodPost, path: "/messages"},
	}

	for _, tc := range tests {
		name := tc.method + "_" + strings.Trim(strings.ReplaceAll(tc.path, "/", "_"), "_")
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			var gotPath string
			var canonicalPath string
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotPath = r.URL.Path
				_, canonicalPath = RequestPaths(r.Context(), r.URL.Path)
				w.WriteHeader(http.StatusNoContent)
			})
			handler := Handler(next)
			req := httptest.NewRequest(tc.method, tc.path, nil)
			rec := httptest.NewRecorder()

			handler.ServeHTTP(rec, req)

			assertEqual(t, tc.path, gotPath)
			assertEqual(t, "", canonicalPath)
		})
	}
}

func TestHandlerPreservesRequestAndRunsNextOnce(t *testing.T) {
	t.Parallel()

	const body = `{"model":"gpt-image-2","prompt":"draw"}`
	var calls int
	var gotBody string
	var gotOriginalPath string
	var gotCanonicalPath string
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		data, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}
		gotBody = string(data)
		gotOriginalPath, gotCanonicalPath = RequestPaths(r.Context(), r.URL.Path)
		assertEqual(t, http.MethodPost, r.Method)
		assertEqual(t, "trace-123", r.Header.Get("X-Trace-ID"))
		assertEqual(t, "expand=usage", r.URL.RawQuery)
		assertEqual(t, "/api/v1/images/edits?expand=usage", r.RequestURI)
		assertEqual(t, "api.example.com", r.Host)
		w.WriteHeader(http.StatusAccepted)
	})
	handler := Handler(next)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/images/edits?expand=usage", strings.NewReader(body))
	req.Host = "api.example.com"
	req.Header.Set("X-Trace-ID", "trace-123")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	assertEqual(t, http.StatusAccepted, rec.Code)
	assertEqual(t, 1, calls)
	assertEqual(t, body, gotBody)
	assertEqual(t, "/api/v1/images/edits", gotOriginalPath)
	assertEqual(t, "/v1/images/edits", gotCanonicalPath)
	assertEqual(t, "/api/v1/images/edits", req.URL.Path)
}

func TestHandlerWithNilNextReturnsNotFound(t *testing.T) {
	t.Parallel()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/models", nil)
	Handler(nil).ServeHTTP(rec, req)

	assertEqual(t, http.StatusNotFound, rec.Code)
}

func assertEqual[T comparable](t *testing.T, want, got T) {
	t.Helper()
	if got != want {
		t.Fatalf("want %v, got %v", want, got)
	}
}
