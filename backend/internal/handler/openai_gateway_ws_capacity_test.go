package handler

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	coderws "github.com/coder/websocket"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

// Exercise the real handler, scheduler, retry loop and websocket transports.
// Only authentication/storage and the remote model service are replaced.
func TestOpenAIResponsesWebSocketCapacityRecovery(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const overload = `{"type":"error","error":{"type":"service_unavailable_error","code":"server_is_overloaded","message":"Our servers are currently overloaded. Please try again later."}}`
	const failed = `{"type":"response.failed","response":{"id":"resp_failed","status":"failed","error":{"code":"server_is_overloaded","message":"Our servers are currently overloaded. Please try again later."}}}`
	const completed = `{"type":"response.completed","response":{"id":"resp_ok","model":"gpt-5.1","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"ok"}]}],"usage":{"input_tokens":2,"output_tokens":1}}}`

	for _, mode := range []string{service.OpenAIWSIngressModeCtxPool, service.OpenAIWSIngressModePassthrough, service.OpenAIWSIngressModeHTTPBridge} {
		for _, scenario := range []string{"recovers", "failed_only", "exhausts", "metadata_then_overload", "after_text", "after_tool_call", "later_turn"} {
			t.Run(mode+"/"+scenario, func(t *testing.T) {
				var attempts, secondAttempts atomic.Int32
				payloads := make(chan string, 10)
				eventsFor := func(payload []byte) []string {
					attempt := attempts.Add(1)
					payloads <- string(payload)
					shouldFail := attempt == 1 || scenario == "exhausts"
					if scenario == "later_turn" {
						shouldFail = strings.Contains(gjson.GetBytes(payload, "input").Raw, "second") && secondAttempts.Add(1) == 1
					}
					events := []string{`{"type":"response.created","response":{"id":"resp_pending"}}`}
					if !shouldFail {
						return append(events, completed)
					}
					if mode != service.OpenAIWSIngressModeHTTPBridge &&
						(scenario == "recovers" || scenario == "failed_only" || scenario == "exhausts") {
						events = nil
					}
					if scenario == "failed_only" {
						return append(events, failed)
					}
					switch scenario {
					case "after_text":
						events = append(events, `{"type":"response.output_text.delta","delta":"partial"}`)
					case "after_tool_call":
						events = append(events, `{"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_once","name":"write","arguments":"{}"}}`)
					}
					return append(events, overload, failed)
				}
				upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if mode == service.OpenAIWSIngressModeHTTPBridge {
						body, err := io.ReadAll(r.Body)
						if err != nil {
							return
						}
						w.Header().Set("Content-Type", "text/event-stream")
						for _, event := range eventsFor(body) {
							_, _ = fmt.Fprintf(w, "data: %s\n\n", event)
						}
						return
					}
					conn, err := coderws.Accept(w, r, nil)
					if err != nil {
						return
					}
					defer conn.CloseNow()
					for {
						_, payload, err := conn.Read(r.Context())
						if err != nil {
							return
						}
						for _, event := range eventsFor(payload) {
							if err := conn.Write(r.Context(), coderws.MessageText, []byte(event)); err != nil {
								return
							}
						}
					}
				}))
				defer upstream.Close()

				router := newOpenAIWSCapacityTestRouter(t, upstream.URL, mode)
				server := httptest.NewServer(router)
				defer server.Close()
				ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
				defer cancel()
				client, _, err := coderws.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/v1/responses", nil)
				require.NoError(t, err)
				defer client.CloseNow()
				require.NoError(t, client.Write(ctx, coderws.MessageText, []byte(`{"type":"response.create","model":"gpt-5.1","input":[{"role":"user","content":"first"}]}`)))

				var frames []string
				for {
					_, frame, readErr := client.Read(ctx)
					if readErr != nil {
						require.Equal(t, "exhausts", scenario, "unexpected close: %v", readErr)
						require.Equal(t, coderws.StatusTryAgainLater, coderws.CloseStatus(readErr))
						require.Contains(t, readErr.Error(), "overloaded")
						break
					}
					frames = append(frames, string(frame))
					event := gjson.GetBytes(frame, "type").String()
					if event == "response.completed" && scenario == "later_turn" && secondAttempts.Load() == 0 {
						require.NoError(t, client.Write(ctx, coderws.MessageText, []byte(`{"type":"response.create","model":"gpt-5.1","input":[{"role":"user","content":"second"}]}`)))
						continue
					}
					if event == "response.completed" || event == "response.failed" {
						break
					}
				}
				joined := strings.Join(frames, "\n")
				switch scenario {
				case "recovers", "failed_only":
					require.EqualValues(t, 2, attempts.Load())
					require.NotContains(t, joined, "overloaded")
					require.Equal(t, 1, strings.Count(joined, `"type":"response.created"`), "failed-attempt metadata must stay hidden")
					first, retried := <-payloads, <-payloads
					require.JSONEq(t, first, retried, "retry must preserve the request")
				case "exhausts":
					require.EqualValues(t, 2, attempts.Load(), "one retry then stop; never loop indefinitely")
					require.Empty(t, frames)
				case "metadata_then_overload":
					if mode == service.OpenAIWSIngressModeHTTPBridge {
						require.EqualValues(t, 2, attempts.Load())
						require.NotContains(t, joined, "overloaded")
					} else {
						require.EqualValues(t, 1, attempts.Load(), "a native WS response already exposed to the client must retain its cancel/continuation state")
						require.Contains(t, joined, `"code":"server_error"`)
					}
				case "after_text", "after_tool_call":
					require.EqualValues(t, 1, attempts.Load(), "do not replay emitted content or tools")
					require.Contains(t, joined, `"code":"server_error"`)
					require.NotContains(t, joined, "server_is_overloaded")
				case "later_turn":
					if mode == service.OpenAIWSIngressModeHTTPBridge {
						require.EqualValues(t, 3, attempts.Load())
						require.EqualValues(t, 2, secondAttempts.Load())
						require.NotContains(t, joined, "overloaded")
					} else {
						require.EqualValues(t, 2, attempts.Load(), "native WS must not replay its first request for a later failure")
						require.Contains(t, joined, `"code":"server_error"`)
					}
				}
			})
		}
	}
}

func newOpenAIWSCapacityTestRouter(t *testing.T, upstreamURL, mode string) *gin.Engine {
	t.Helper()
	cfg := &config.Config{}
	cfg.RunMode = config.RunModeSimple
	cfg.Default.RateMultiplier = 1
	cfg.Security.URLAllowlist.AllowInsecureHTTP = true
	cfg.Gateway.OpenAIWS.Enabled = true
	cfg.Gateway.OpenAIWS.APIKeyEnabled = true
	cfg.Gateway.OpenAIWS.ResponsesWebsocketsV2 = true
	cfg.Gateway.OpenAIWS.ModeRouterV2Enabled = true
	cfg.Gateway.OpenAIWS.DialTimeoutSeconds = 3
	cfg.Gateway.OpenAIWS.ReadTimeoutSeconds = 3
	cfg.Gateway.OpenAIWS.WriteTimeoutSeconds = 3
	repo := &openAIWSUsageHandlerAccountRepoStub{account: service.Account{
		ID: 9901, Name: "capacity-test", Platform: service.PlatformOpenAI, Type: service.AccountTypeAPIKey,
		Status: service.StatusActive, Schedulable: true, Concurrency: 1,
		Credentials: map[string]any{"api_key": "sk-test", "base_url": upstreamURL, "pool_mode": true, "pool_mode_retry_count": 1},
		Extra:       map[string]any{"openai_apikey_responses_websockets_v2_mode": mode},
	}}
	billing := service.NewBillingCacheService(nil, nil, nil, nil, nil, nil, cfg, nil)
	t.Cleanup(billing.Stop)
	gateway := service.NewOpenAIGatewayService(
		repo, &openAIWSUsageHandlerUsageLogRepoStub{}, nil, nil, nil, nil, nil, cfg, nil, nil,
		service.NewBillingService(cfg, nil), nil, billing, &compositeWSHTTPUpstream{}, &service.DeferredService{},
		nil, nil, nil, nil, nil, nil, nil,
	)
	cache := &concurrencyCacheMock{
		acquireUserSlotFn:    func(context.Context, int64, int, string) (bool, error) { return true, nil },
		acquireAccountSlotFn: func(context.Context, int64, int, string) (bool, error) { return true, nil },
	}
	h := &OpenAIGatewayHandler{
		cfg: cfg, gatewayService: gateway, billingCacheService: billing,
		apiKeyService:     &service.APIKeyService{},
		concurrencyHelper: NewConcurrencyHelper(service.NewConcurrencyService(cache), SSEPingFormatNone, time.Second),
	}
	groupID := int64(4201)
	apiKey := &service.APIKey{ID: 1801, GroupID: &groupID, User: &service.User{ID: 1701, Status: service.StatusActive}}
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.ContextKeyAPIKey), apiKey)
		c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: apiKey.User.ID, Concurrency: 1})
		c.Next()
	})
	router.GET("/v1/responses", h.ResponsesWebSocket)
	return router
}
