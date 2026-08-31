package middleware

import (
	"context"
	"strings"

	"github.com/Wei-Shaw/sub2api/internal/pkg/ctxkey"
	"github.com/Wei-Shaw/sub2api/internal/pkg/logger"
	"github.com/Wei-Shaw/sub2api/internal/server/apicompat"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const requestIDHeader = "X-Request-ID"

// RequestLogger 在请求入口注入 request-scoped logger。
func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request == nil {
			c.Next()
			return
		}

		requestID, validRequestID := normalizeCorrelationID(c.GetHeader(requestIDHeader))
		if !validRequestID {
			requestID = uuid.NewString()
		}
		c.Header(requestIDHeader, requestID)

		ctx := context.WithValue(c.Request.Context(), ctxkey.RequestID, requestID)
		clientRequestID, _ := ctx.Value(ctxkey.ClientRequestID).(string)
		clientRequestID, _ = normalizeCorrelationID(clientRequestID)

		requestPath, canonicalPath := apicompat.RequestPaths(c.Request.Context(), c.Request.URL.Path)
		fields := []zap.Field{
			zap.String("component", "http"),
			zap.String("request_id", requestID),
			zap.String("client_request_id", strings.TrimSpace(clientRequestID)),
			zap.String("path", requestPath),
			zap.String("method", c.Request.Method),
		}
		if canonicalPath != "" {
			fields = append(fields, zap.String("canonical_path", canonicalPath))
		}
		requestLogger := logger.With(fields...)

		ctx = logger.IntoContext(ctx, requestLogger)
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	}
}
