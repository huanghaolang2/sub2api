package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	coderws "github.com/coder/websocket"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func newDeepSeekAliasWSTestService(upstream HTTPUpstream) *OpenAIGatewayService {
	cfg := newOpenAIWSV2TestConfig()
	cfg.Security.URLAllowlist.Enabled = false
	cfg.Security.URLAllowlist.AllowInsecureHTTP = true
	cfg.Gateway.OpenAIWS.ModeRouterV2Enabled = true
	cfg.Gateway.OpenAIWS.HTTPBridgeEnabled = true
	cfg.Gateway.OpenAIWS.HTTPBridgeThresholdBytes = 10 * 1024 * 1024
	return &OpenAIGatewayService{
		cfg: cfg, httpUpstream: upstream, cache: &stubGatewayCache{},
		openaiWSResolver: NewOpenAIWSProtocolResolver(cfg), toolCorrector: NewCodexToolCorrector(),
	}
}

func startDeepSeekAliasWS(t *testing.T, svc *OpenAIGatewayService, account *Account, hooks *OpenAIWSIngressHooks) (*coderws.Conn, <-chan error) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	done := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := coderws.Accept(w, r, nil)
		if err != nil {
			done <- err
			return
		}
		defer conn.CloseNow()
		_, first, err := conn.Read(r.Context())
		if err != nil {
			done <- err
			return
		}
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = r.Clone(r.Context())
		err = svc.ProxyResponsesWebSocketFromClient(r.Context(), c, conn, account, "sk-test", first, hooks)
		done <- err
		var closeErr *OpenAIWSClientCloseError
		if errors.As(err, &closeErr) {
			_ = conn.Close(closeErr.StatusCode(), closeErr.Reason())
		}
	}))
	t.Cleanup(server.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := coderws.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), &coderws.DialOptions{HTTPHeader: http.Header{responsesLiteHeader: []string{"true"}, "User-Agent": []string{CodexCanonicalUserAgent()}}})
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.CloseNow() })
	return conn, done
}

func writeDeepSeekAliasWS(t *testing.T, conn *coderws.Conn, frame any) {
	t.Helper()
	body, err := json.Marshal(frame)
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	require.NoError(t, conn.Write(ctx, coderws.MessageText, body))
}

func readDeepSeekAliasWSTerminal(t *testing.T, conn *coderws.Conn) gjson.Result {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for {
		_, raw, err := conn.Read(ctx)
		require.NoError(t, err)
		event := gjson.ParseBytes(raw)
		switch event.Get("type").String() {
		case "response.completed", "response.failed", "error":
			return event
		}
	}
}

func finishDeepSeekAliasWS(t *testing.T, conn *coderws.Conn, done <-chan error) error {
	t.Helper()
	_ = conn.Close(coderws.StatusNormalClosure, "done")
	select {
	case err := <-done:
		return err
	case <-time.After(5 * time.Second):
		t.Fatal("websocket proxy did not finish")
		return nil
	}
}

func TestDeepSeekAliasWSRoundTripAndSessionIsolation(t *testing.T) {
	for _, mode := range []string{OpenAIWSIngressModeCtxPool, OpenAIWSIngressModePassthrough, OpenAIWSIngressModeHTTPBridge} {
		t.Run(mode, func(t *testing.T) {
			calls := 0
			upstream := &codexModelsHTTPUpstreamStub{do: func(req *http.Request, _ string, _ int64, _ int) (*http.Response, error) {
				calls++
				body, err := io.ReadAll(req.Body)
				require.NoError(t, err)
				require.Equal(t, deepSeekTestTarget, gjson.GetBytes(body, "model").String(), "the target must not be mapped twice")
				require.Equal(t, "/v1/responses", req.URL.Path)
				require.Empty(t, req.Header.Get(responsesLiteHeader))
				require.False(t, gjson.GetBytes(body, "previous_response_id").Exists())
				require.False(t, gjson.GetBytes(body, "client_metadata."+responsesLiteWSMetadataKey).Exists())
				require.Equal(t, "function", gjson.GetBytes(body, "tools.0.type").String())
				require.Equal(t, "exec", gjson.GetBytes(body, "tools.0.name").String())
				require.Len(t, gjson.GetBytes(body, "tools").Array(), 2, "additional namespace and custom tools must both survive omitted tools")
				var output []any
				switch calls {
				case 1:
					require.Equal(t, "low", gjson.GetBytes(body, "reasoning.effort").String())
					output = []any{
						map[string]any{"type": "reasoning", "id": "rs_ws", "content": []any{map[string]any{"type": "reasoning_text", "text": "WS reasoning"}}},
						map[string]any{"type": "function_call", "id": "fc_ws", "call_id": "call_ws", "name": "exec", "arguments": `{"input":"pwd"}`, "status": "completed"},
					}
				case 2:
					require.Equal(t, "none", gjson.GetBytes(body, "reasoning.effort").String())
					require.Equal(t, "working directory?", gjson.GetBytes(body, "input.0.content").String())
					require.Contains(t, string(body), "WS reasoning")
					require.Contains(t, string(body), "function_call_output")
					require.Contains(t, string(body), "/workspace")
					output = []any{map[string]any{"type": "message", "id": "msg_ws", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": "directory is /workspace"}}}}
				case 3:
					require.Equal(t, "max", gjson.GetBytes(body, "reasoning.effort").String())
					require.Contains(t, string(body), "directory is /workspace", "ordinary assistant messages must survive stateless continuation")
					output = []any{map[string]any{"type": "message", "id": "msg_done", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": "done"}}}}
				default:
					t.Errorf("unexpected upstream request %d", calls)
				}
				response := deepSeekAliasSSE(deepSeekAliasResponse(output, fmt.Sprintf("resp_ws_%d", calls)))
				return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(response))}, nil
			}}
			svc := newDeepSeekAliasWSTestService(upstream)
			account := deepSeekAliasTestAccount()
			account.Credentials["model_mapping"] = map[string]any{deepSeekTestAlias: deepSeekTestTarget, deepSeekTestTarget: "gpt-5.4"}
			account.Extra["openai_apikey_responses_websockets_v2_mode"] = mode
			mappedTurns := 0
			hooks := &OpenAIWSIngressHooks{MapRequestModel: func(turn int, model string) (string, error) {
				mappedTurns++
				require.Equal(t, deepSeekTestAlias, model)
				return model, nil
			}}
			conn, done := startDeepSeekAliasWS(t, svc, account, hooks)
			writeDeepSeekAliasWS(t, conn, map[string]any{
				"type": "response.create", "model": deepSeekTestAlias,
				"input": []any{map[string]any{"role": "user", "content": "working directory?"}, map[string]any{"type": "additional_tools", "tools": []any{
					map[string]any{"type": "namespace", "name": "files", "tools": []any{map[string]any{"type": "function", "name": "list", "parameters": map[string]any{"type": "object"}}}},
				}}},
				"reasoning": map[string]any{"effort": "minimal"}, "tools": []any{map[string]any{"type": "custom", "name": "exec"}},
				"client_metadata": map[string]any{responsesLiteWSMetadataKey: "true"},
			})
			first := readDeepSeekAliasWSTerminal(t, conn)
			require.Equal(t, "response.completed", first.Get("type").String())
			require.Equal(t, deepSeekTestAlias, first.Get("response.model").String())
			require.Equal(t, "custom_tool_call", first.Get("response.output.1.type").String())
			writeDeepSeekAliasWS(t, conn, map[string]any{
				"type": "response.create", "previous_response_id": "resp_ws_1", "reasoning": map[string]any{"effort": "none"},
				"input": []any{map[string]any{"type": "custom_tool_call_output", "call_id": "call_ws", "output": "/workspace"}},
			})
			second := readDeepSeekAliasWSTerminal(t, conn)
			require.Equal(t, "response.completed", second.Get("type").String())
			require.Equal(t, deepSeekTestAlias, second.Get("response.model").String())
			writeDeepSeekAliasWS(t, conn, map[string]any{"type": "response.create", "previous_response_id": "resp_ws_2", "input": "continue", "reasoning": map[string]any{"effort": "ultra"}})
			third := readDeepSeekAliasWSTerminal(t, conn)
			require.Equal(t, "response.completed", third.Get("type").String())
			require.Equal(t, deepSeekTestAlias, third.Get("response.model").String())
			require.NoError(t, finishDeepSeekAliasWS(t, conn, done))
			require.Equal(t, 3, calls)
			require.Equal(t, 3, mappedTurns)

			// The shared response-owner binding must not be mistaken for a
			// recoverable history snapshot in an independent connection.
			other, otherDone := startDeepSeekAliasWS(t, svc, account, nil)
			writeDeepSeekAliasWS(t, other, map[string]any{"type": "response.create", "model": deepSeekTestAlias, "previous_response_id": "resp_ws_3", "input": "continue"})
			failure := readDeepSeekAliasWSTerminal(t, other)
			require.Equal(t, "invalid_request_error", failure.Get("error.type").String())
			require.Equal(t, "previous_response_id", failure.Get("error.param").String())
			var closeErr *OpenAIWSClientCloseError
			require.ErrorAs(t, finishDeepSeekAliasWS(t, other, otherDone), &closeErr)
			require.Equal(t, coderws.StatusPolicyViolation, closeErr.StatusCode())
			require.Equal(t, 3, calls)
		})
	}
}

func TestDeepSeekAliasWSRejectsToolsAndHonorsOff(t *testing.T) {
	for _, mode := range []string{OpenAIWSIngressModeHTTPBridge, OpenAIWSIngressModeOff} {
		t.Run(mode, func(t *testing.T) {
			upstream := &httpUpstreamRecorder{}
			svc := newDeepSeekAliasWSTestService(upstream)
			account := deepSeekAliasTestAccount()
			account.Extra["openai_apikey_responses_websockets_v2_mode"] = mode
			conn, done := startDeepSeekAliasWS(t, svc, account, nil)
			writeDeepSeekAliasWS(t, conn, map[string]any{"type": "response.create", "model": deepSeekTestAlias, "input": "hi", "tools": []any{map[string]any{"type": "computer_use_preview"}}})
			if mode == OpenAIWSIngressModeHTTPBridge {
				failure := readDeepSeekAliasWSTerminal(t, conn)
				require.Equal(t, "invalid_request_error", failure.Get("error.type").String())
				require.Equal(t, "tools", failure.Get("error.param").String())
			}
			var closeErr *OpenAIWSClientCloseError
			require.ErrorAs(t, finishDeepSeekAliasWS(t, conn, done), &closeErr)
			require.Equal(t, coderws.StatusPolicyViolation, closeErr.StatusCode())
			if mode == OpenAIWSIngressModeOff {
				require.Contains(t, closeErr.Reason(), "disabled")
			}
			require.Empty(t, upstream.requests)
		})
	}
}
