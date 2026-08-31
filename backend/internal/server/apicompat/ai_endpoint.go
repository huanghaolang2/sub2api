// Package apicompat provides the HTTP entry adapter for versioned AI aliases.
package apicompat

import (
	"context"
	"net/http"
	"strings"
)

const (
	aiEndpointVersionedPrefix = "/api/v1"
	aiEndpointLegacyPrefix    = "/api"
	aiEndpointInternalPrefix  = "/v1"
)

type aiEndpointRule struct {
	method   string
	template string
}

// aiEndpointRules is deliberately a closed list. The /api/v1 namespace is
// also used by the panel API, so a broad prefix rewrite would route panel
// requests through the AI gateway and could duplicate or bypass middleware.
var aiEndpointRules = []aiEndpointRule{
	{method: http.MethodPost, template: "/messages"},
	{method: http.MethodPost, template: "/messages/count_tokens"},
	{method: http.MethodGet, template: "/models"},
	{method: http.MethodPost, template: "/responses"},
	{method: http.MethodPost, template: "/responses/*subpath"},
	{method: http.MethodGet, template: "/responses"},
	{method: http.MethodPost, template: "/chat/completions"},
	{method: http.MethodPost, template: "/embeddings"},

	{method: http.MethodPost, template: "/images/generations"},
	{method: http.MethodPost, template: "/images/edits"},
	{method: http.MethodPost, template: "/images/generations/async"},
	{method: http.MethodPost, template: "/images/edits/async"},
	{method: http.MethodGet, template: "/images/tasks/:task_id"},
	{method: http.MethodPost, template: "/images/batches"},
	{method: http.MethodGet, template: "/images/batches"},
	{method: http.MethodGet, template: "/images/batches/models"},
	{method: http.MethodGet, template: "/images/batches/:id"},
	{method: http.MethodGet, template: "/images/batches/:id/items"},
	{method: http.MethodGet, template: "/images/batches/:id/items/:custom_id/content"},
	{method: http.MethodGet, template: "/images/batches/:id/download"},
	{method: http.MethodPost, template: "/images/batches/:id/cancel"},
	{method: http.MethodDelete, template: "/images/batches/:id"},
	{method: http.MethodDelete, template: "/images/batches/:id/outputs"},

	{method: http.MethodPost, template: "/videos"},
	{method: http.MethodPost, template: "/videos/generations"},
	{method: http.MethodPost, template: "/videos/edits"},
	{method: http.MethodPost, template: "/videos/extensions"},
	{method: http.MethodGet, template: "/videos/generations/:request_id/content"},
	{method: http.MethodGet, template: "/videos/edits/:request_id/content"},
	{method: http.MethodGet, template: "/videos/extensions/:request_id/content"},
	{method: http.MethodGet, template: "/videos/generations/:request_id"},
	{method: http.MethodGet, template: "/videos/edits/:request_id"},
	{method: http.MethodGet, template: "/videos/extensions/:request_id"},
	{method: http.MethodGet, template: "/videos/:request_id"},
	{method: http.MethodGet, template: "/videos/:request_id/content"},
}

type requestInfoContextKey struct{}

type requestInfo struct {
	originalPath string
	internalPath string
}

// Handler maps only explicitly supported AI aliases onto the existing /v1
// routes. The downstream Gin engine therefore executes the same route and
// middleware chain exactly once for old and new client paths.
func Handler(next http.Handler) http.Handler {
	if next == nil {
		next = http.NotFoundHandler()
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r == nil || r.URL == nil {
			next.ServeHTTP(w, r)
			return
		}

		internalPath, ok := mapPath(r.Method, r.URL.Path)
		if !ok {
			next.ServeHTTP(w, r)
			return
		}

		info := requestInfo{
			originalPath: r.URL.Path,
			internalPath: internalPath,
		}
		ctx := context.WithValue(r.Context(), requestInfoContextKey{}, info)
		clone := r.Clone(ctx)
		clonedURL := *r.URL
		clonedURL.Path = internalPath
		clonedURL.RawPath = ""
		clone.URL = &clonedURL
		next.ServeHTTP(w, clone)
	})
}

func mapPath(method, path string) (string, bool) {
	relativePath, ok := trimPrefix(path)
	if !ok {
		return "", false
	}
	for _, rule := range aiEndpointRules {
		if method == rule.method && matchTemplate(rule.template, relativePath) {
			return aiEndpointInternalPrefix + relativePath, true
		}
	}
	return "", false
}

func trimPrefix(path string) (string, bool) {
	switch {
	case strings.HasPrefix(path, aiEndpointVersionedPrefix+"/"):
		return strings.TrimPrefix(path, aiEndpointVersionedPrefix), true
	case strings.HasPrefix(path, aiEndpointLegacyPrefix+"/"):
		return strings.TrimPrefix(path, aiEndpointLegacyPrefix), true
	default:
		return "", false
	}
}

func matchTemplate(template, path string) bool {
	templateSegments, ok := splitPath(template)
	if !ok {
		return false
	}
	pathSegments, ok := splitPath(path)
	if !ok {
		return false
	}

	for i, templateSegment := range templateSegments {
		if strings.HasPrefix(templateSegment, "*") {
			return i == len(templateSegments)-1 && len(pathSegments) > i
		}
		if i >= len(pathSegments) {
			return false
		}
		if strings.HasPrefix(templateSegment, ":") {
			continue
		}
		if templateSegment != pathSegments[i] {
			return false
		}
	}
	return len(templateSegments) == len(pathSegments)
}

func splitPath(path string) ([]string, bool) {
	if path == "" || path[0] != '/' || strings.HasSuffix(path, "/") {
		return nil, false
	}
	segments := strings.Split(strings.TrimPrefix(path, "/"), "/")
	for _, segment := range segments {
		if segment == "" {
			return nil, false
		}
	}
	return segments, true
}

// RequestPaths returns the client path and, for a rewritten alias, its
// internal canonical path. Callers use this to keep observability tied to the
// path the client actually requested without changing downstream routing.
func RequestPaths(ctx context.Context, fallbackPath string) (string, string) {
	if ctx != nil {
		if info, ok := ctx.Value(requestInfoContextKey{}).(requestInfo); ok && info.originalPath != "" {
			return info.originalPath, info.internalPath
		}
	}
	return fallbackPath, ""
}
