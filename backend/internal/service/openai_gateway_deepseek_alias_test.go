package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func deepSeekAliasResponse(output any, id string) string {
	body, _ := json.Marshal(map[string]any{
		"id": id, "object": "response", "model": deepSeekTestTarget, "status": "completed", "output": output,
		"usage": map[string]any{"input_tokens": 10, "output_tokens": 2, "total_tokens": 12},
	})
	return string(body)
}

func deepSeekAliasSSE(response string) string {
	var events []string
	emit := func(value map[string]any) {
		value["sequence_number"] = len(events)
		data, _ := json.Marshal(value)
		events = append(events, "data: "+string(data))
	}
	for index, item := range gjson.Get(response, "output").Array() {
		emit(map[string]any{"type": "response.output_item.added", "output_index": index, "item": item.Value()})
		if item.Get("type").String() == "function_call" {
			emit(map[string]any{"type": "response.function_call_arguments.delta", "item_id": item.Get("id").String(), "output_index": index, "delta": item.Get("arguments").String()})
			emit(map[string]any{"type": "response.function_call_arguments.done", "item_id": item.Get("id").String(), "output_index": index, "arguments": item.Get("arguments").String()})
		}
		emit(map[string]any{"type": "response.output_item.done", "output_index": index, "item": item.Value()})
	}
	emit(map[string]any{"type": "response.completed", "response": gjson.Parse(response).Value()})
	return strings.Join(events, "\n\n") + "\n\n"
}

func deepSeekAliasFinalResponse(t *testing.T, output string, stream bool) gjson.Result {
	t.Helper()
	if !stream {
		return gjson.Parse(output)
	}
	for _, line := range strings.Split(output, "\n") {
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		event := gjson.Parse(strings.TrimPrefix(line, "data: "))
		if event.Get("type").String() == "response.completed" {
			return event.Get("response")
		}
	}
	t.Fatalf("missing response.completed: %s", output)
	return gjson.Result{}
}

func forwardDeepSeekAliasTest(t *testing.T, svc *OpenAIGatewayService, account *Account, request any) (*OpenAIForwardResult, *httptest.ResponseRecorder, error) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	body, err := json.Marshal(request)
	require.NoError(t, err)
	original := append([]byte(nil), body...)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(body))
	c.Request.Header.Set("User-Agent", CodexCanonicalUserAgent())
	c.Request.Header.Set(responsesLiteHeader, "true")
	result, err := svc.Forward(context.Background(), c, account, body)
	require.Equal(t, original, body, "another account attempt must retain the canonical request")
	require.Equal(t, "true", c.Request.Header.Get(responsesLiteHeader), "ingress headers must remain available for failover")
	return result, recorder, err
}

func TestDeepSeekAliasHTTPNativeRoundTrip(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprintf("stream=%v", stream), func(t *testing.T) {
			calls := 0
			upstream := &codexModelsHTTPUpstreamStub{do: func(req *http.Request, _ string, _ int64, _ int) (*http.Response, error) {
				calls++
				body, err := io.ReadAll(req.Body)
				require.NoError(t, err)
				require.Equal(t, "relay.example", req.URL.Host)
				require.Equal(t, "/v1/responses", req.URL.Path)
				require.Equal(t, deepSeekTestTarget, gjson.GetBytes(body, "model").String())
				require.Empty(t, req.Header.Get(responsesLiteHeader))
				require.Equal(t, gjson.False, gjson.GetBytes(body, "store").Type)
				require.False(t, gjson.GetBytes(body, "previous_response_id").Exists())
				require.False(t, gjson.GetBytes(body, "client_metadata."+responsesLiteWSMetadataKey).Exists())
				require.Equal(t, "max", gjson.GetBytes(body, "reasoning.effort").String())
				require.Equal(t, "function", gjson.GetBytes(body, "tools.0.type").String())
				var response string
				if calls == 1 {
					require.Len(t, gjson.GetBytes(body, "tools").Array(), 2, "additional_tools namespace must be promoted")
					require.Len(t, gjson.GetBytes(body, "input").Array(), 1)
					response = deepSeekAliasResponse([]any{map[string]any{"type": "function_call", "id": "fc_1", "call_id": "call_1", "name": "exec", "arguments": `{"input":"pwd"}`, "status": "completed"}}, "resp_first")
				} else {
					require.Equal(t, "reasoning", gjson.GetBytes(body, "input.1.type").String())
					require.Equal(t, "preserved reasoning", gjson.GetBytes(body, "input.1.content.0.text").String())
					require.Equal(t, "function_call", gjson.GetBytes(body, "input.2.type").String())
					require.Equal(t, "call_1", gjson.GetBytes(body, "input.2.call_id").String())
					require.JSONEq(t, `{"input":"pwd"}`, gjson.GetBytes(body, "input.2.arguments").String())
					require.Equal(t, "function_call_output", gjson.GetBytes(body, "input.3.type").String())
					require.Equal(t, "/workspace", gjson.GetBytes(body, "input.3.output").String())
					response = deepSeekAliasResponse([]any{map[string]any{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": "/workspace"}}}}, "resp_second")
				}
				contentType := "application/json"
				if stream {
					contentType, response = "text/event-stream", deepSeekAliasSSE(response)
				}
				return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{contentType}}, Body: io.NopCloser(strings.NewReader(response))}, nil
			}}
			svc := &OpenAIGatewayService{cfg: deepSeekChatFallbackTestConfig(), httpUpstream: upstream}
			account := deepSeekAliasTestAccount()
			tool := map[string]any{"type": "custom", "name": "exec"}
			user := map[string]any{"role": "user", "content": "working directory?"}
			request := map[string]any{
				"model": deepSeekTestAlias, "stream": stream, "store": true,
				"reasoning": map[string]any{"effort": "ultra"}, "tools": []any{tool},
				"client_metadata": map[string]any{responsesLiteWSMetadataKey: "true"},
				"input": []any{user, map[string]any{"type": "additional_tools", "tools": []any{
					map[string]any{"type": "namespace", "name": "fs", "tools": []any{map[string]any{"type": "function", "name": "list", "parameters": map[string]any{"type": "object"}}}},
				}}},
			}
			result, recorder, err := forwardDeepSeekAliasTest(t, svc, account, request)
			require.NoError(t, err)
			require.Equal(t, deepSeekTestTarget, result.UpstreamModel)
			first := deepSeekAliasFinalResponse(t, recorder.Body.String(), stream)
			require.Equal(t, deepSeekTestAlias, first.Get("model").String())
			call := first.Get("output.0")
			require.Equal(t, "custom_tool_call", call.Get("type").String())
			require.Equal(t, "pwd", call.Get("input").String())
			require.Equal(t, "call_1", call.Get("call_id").String())
			if stream {
				require.Contains(t, recorder.Body.String(), `"type":"response.custom_tool_call_input.done"`)
			}
			request["previous_response_id"] = first.Get("id").String()
			request["input"] = []any{user,
				map[string]any{"type": "reasoning", "id": "rs_plain", "content": []any{map[string]any{"type": "reasoning_text", "text": "preserved reasoning"}}},
				call.Value(), map[string]any{"type": "custom_tool_call_output", "call_id": "call_1", "output": "/workspace"},
			}
			_, recorder, err = forwardDeepSeekAliasTest(t, svc, account, request)
			require.NoError(t, err)
			second := deepSeekAliasFinalResponse(t, recorder.Body.String(), stream)
			require.Equal(t, deepSeekTestAlias, second.Get("model").String())
			require.Equal(t, "/workspace", second.Get("output.0.content.0.text").String())
			require.Equal(t, 2, calls)
		})
	}
}

func TestDeepSeekAliasHTTPNamespaceOnly(t *testing.T) {
	upstream := &codexModelsHTTPUpstreamStub{do: func(req *http.Request, _ string, _ int64, _ int) (*http.Response, error) {
		body, _ := io.ReadAll(req.Body)
		tool := gjson.GetBytes(body, "tools.0")
		require.Equal(t, "function", tool.Get("type").String())
		response := deepSeekAliasResponse([]any{map[string]any{"type": "function_call", "id": "fc_ns", "call_id": "call_ns", "name": tool.Get("name").String(), "arguments": `{}`}}, "resp_ns")
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(response))}, nil
	}}
	svc := &OpenAIGatewayService{cfg: deepSeekChatFallbackTestConfig(), httpUpstream: upstream}
	_, recorder, err := forwardDeepSeekAliasTest(t, svc, deepSeekAliasTestAccount(), map[string]any{
		"model": deepSeekTestAlias, "input": "list files", "tools": []any{map[string]any{
			"type": "namespace", "name": "files", "tools": []any{map[string]any{"type": "function", "name": "list", "parameters": map[string]any{"type": "object"}}},
		}},
	})
	require.NoError(t, err)
	call := gjson.Get(recorder.Body.String(), "output.0")
	require.Equal(t, "files", call.Get("namespace").String())
	require.Equal(t, "list", call.Get("name").String())
	require.Equal(t, "call_ns", call.Get("call_id").String())
}

func TestDeepSeekAliasHTTPReasoningAndChatFallback(t *testing.T) {
	for requested, expected := range map[string]string{"minimal": "low", "medium": "high", "xhigh": "high", "ultra": "max", "none": "none"} {
		for _, chat := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/chat=%v", requested, chat), func(t *testing.T) {
				upstream := &httpUpstreamRecorder{}
				response := deepSeekAliasResponse([]any{}, "resp_effort")
				if chat {
					response = `{"id":"chat_effort","model":"deepseek-v4.1-flash","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}`
				}
				upstream.resp = &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(response))}
				svc := &OpenAIGatewayService{cfg: deepSeekChatFallbackTestConfig(), httpUpstream: upstream}
				account := deepSeekAliasTestAccount()
				account.Extra["openai_responses_supported"] = !chat
				_, _, err := forwardDeepSeekAliasTest(t, svc, account, map[string]any{"model": deepSeekTestAlias, "input": "hi", "reasoning": map[string]any{"effort": requested}})
				require.NoError(t, err)
				require.Equal(t, deepSeekTestTarget, gjson.GetBytes(upstream.lastBody, "model").String())
				if chat {
					require.Equal(t, "/v1/chat/completions", upstream.lastReq.URL.Path)
					if requested == "none" {
						require.Equal(t, "disabled", gjson.GetBytes(upstream.lastBody, "thinking.type").String())
						require.False(t, gjson.GetBytes(upstream.lastBody, "reasoning_effort").Exists())
					} else {
						require.Equal(t, expected, gjson.GetBytes(upstream.lastBody, "reasoning_effort").String())
					}
				} else {
					require.Equal(t, expected, gjson.GetBytes(upstream.lastBody, "reasoning.effort").String())
				}
			})
		}
	}
}

func TestDeepSeekAliasHTTPRejectsUnrecoverableRequests(t *testing.T) {
	for name, fields := range map[string]map[string]any{
		"reference only":     {"previous_response_id": "resp_missing", "input": "continue"},
		"item reference":     {"input": []any{map[string]any{"type": "item_reference", "id": "fc_missing"}}},
		"orphan output":      {"input": []any{map[string]any{"type": "custom_tool_call_output", "call_id": "missing", "output": "done"}}},
		"unsupported tool":   {"tools": []any{map[string]any{"type": "computer_use_preview"}}},
		"opaque compaction":  {"input": []any{map[string]any{"type": "compaction", "encrypted_content": "opaque-vendor-history"}}},
		"unsupported choice": {"input": "search", "tool_choice": map[string]any{"type": "web_search"}},
	} {
		t.Run(name, func(t *testing.T) {
			upstream := &httpUpstreamRecorder{}
			svc := &OpenAIGatewayService{cfg: deepSeekChatFallbackTestConfig(), httpUpstream: upstream}
			fields["model"] = deepSeekTestAlias
			_, recorder, err := forwardDeepSeekAliasTest(t, svc, deepSeekAliasTestAccount(), fields)
			require.Error(t, err)
			require.Equal(t, http.StatusBadRequest, recorder.Code)
			require.Equal(t, "invalid_request_error", gjson.Get(recorder.Body.String(), "error.type").String())
			require.NotEmpty(t, gjson.Get(recorder.Body.String(), "error.param").String())
			require.Empty(t, upstream.requests)
		})
	}
}

func TestDeepSeekAliasHTTPLeavesRealGPTUnchanged(t *testing.T) {
	account := deepSeekAliasTestAccount()
	upstream := &httpUpstreamRecorder{resp: &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"id":"resp_gpt","model":"gpt-5.4","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1}}`))}}
	svc := &OpenAIGatewayService{cfg: deepSeekChatFallbackTestConfig(), httpUpstream: upstream}
	_, _, err := forwardDeepSeekAliasTest(t, svc, account, map[string]any{"model": "gpt-5.4", "input": "hi", "store": true, "reasoning": map[string]any{"effort": "minimal"}})
	require.NoError(t, err)
	require.Equal(t, "gpt-5.4", gjson.GetBytes(upstream.lastBody, "model").String())
	require.Equal(t, "none", gjson.GetBytes(upstream.lastBody, "reasoning.effort").String())
	require.True(t, gjson.GetBytes(upstream.lastBody, "store").Bool())
	require.Equal(t, "true", upstream.lastReq.Header.Get(responsesLiteHeader))
}

func TestDeepSeekAliasHTTPChatToolsRoundTrip(t *testing.T) {
	account := deepSeekAliasTestAccount()
	account.Extra["openai_responses_supported"] = false
	upstream := &httpUpstreamRecorder{responses: []*http.Response{
		{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"id":"chat_tool","model":"deepseek-v4.1-flash","choices":[{"index":0,"message":{"role":"assistant","content":null,"reasoning_content":"tool reasoning","tool_calls":[{"id":"call_chat","type":"function","function":{"name":"exec","arguments":"{\"input\":\"pwd\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}`))},
		{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"id":"chat_done","model":"deepseek-v4.1-flash","choices":[{"index":0,"message":{"role":"assistant","content":"/workspace"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}`))},
	}}
	svc := &OpenAIGatewayService{cfg: deepSeekChatFallbackTestConfig(), httpUpstream: upstream}
	user := map[string]any{"role": "user", "content": "working directory?"}
	request := map[string]any{"model": deepSeekTestAlias, "input": []any{user}, "tools": []any{map[string]any{"type": "custom", "name": "exec"}}}
	_, recorder, err := forwardDeepSeekAliasTest(t, svc, account, request)
	require.NoError(t, err)
	first := gjson.Parse(recorder.Body.String())
	require.Equal(t, deepSeekTestAlias, first.Get("model").String())
	input := []any{user}
	var call gjson.Result
	for _, item := range first.Get("output").Array() {
		input = append(input, item.Value())
		if item.Get("type").String() == "custom_tool_call" {
			call = item
		}
	}
	require.Equal(t, "call_chat", call.Get("call_id").String())
	require.Equal(t, "pwd", call.Get("input").String())
	input = append(input, map[string]any{"type": "custom_tool_call_output", "call_id": "call_chat", "output": "/workspace"})
	request["input"] = input
	_, recorder, err = forwardDeepSeekAliasTest(t, svc, account, request)
	require.NoError(t, err)
	require.Len(t, upstream.requests, 2)
	var sawCall, sawOutput bool
	for _, message := range gjson.GetBytes(upstream.lastBody, "messages").Array() {
		if message.Get("tool_calls.0.id").String() == "call_chat" {
			sawCall = true
			require.JSONEq(t, `{"input":"pwd"}`, message.Get("tool_calls.0.function.arguments").String())
			require.Equal(t, "tool reasoning", message.Get("reasoning_content").String())
		}
		if message.Get("tool_call_id").String() == "call_chat" {
			sawOutput = true
			require.Equal(t, "/workspace", message.Get("content").String())
		}
	}
	require.True(t, sawCall)
	require.True(t, sawOutput)
	require.Contains(t, recorder.Body.String(), "/workspace")
}

func TestDeepSeekAliasHTTPToolSearchDiscovery(t *testing.T) {
	calls := 0
	upstream := &codexModelsHTTPUpstreamStub{do: func(req *http.Request, _ string, _ int64, _ int) (*http.Response, error) {
		calls++
		body, _ := io.ReadAll(req.Body)
		tools := gjson.GetBytes(body, "tools").Array()
		name := tools[0].Get("name").String()
		arguments := `{"query":"file tools"}`
		if calls == 2 {
			require.Len(t, tools, 2, "discovered namespace must become an executable function")
			name, arguments = tools[1].Get("name").String(), `{}`
			require.Equal(t, "function_call_output", gjson.GetBytes(body, "input.2.type").String())
			require.Contains(t, gjson.GetBytes(body, "input.2.output").String(), "files")
		}
		response := deepSeekAliasResponse([]any{map[string]any{"type": "function_call", "id": fmt.Sprintf("fc_search_%d", calls), "call_id": fmt.Sprintf("call_search_%d", calls), "name": name, "arguments": arguments}}, fmt.Sprintf("resp_search_%d", calls))
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(response))}, nil
	}}
	svc := &OpenAIGatewayService{cfg: deepSeekChatFallbackTestConfig(), httpUpstream: upstream}
	user := map[string]any{"role": "user", "content": "find and list files"}
	request := map[string]any{"model": deepSeekTestAlias, "input": []any{user}, "tools": []any{map[string]any{"type": "tool_search"}}}
	_, recorder, err := forwardDeepSeekAliasTest(t, svc, deepSeekAliasTestAccount(), request)
	require.NoError(t, err)
	call := gjson.Get(recorder.Body.String(), "output.0")
	require.Equal(t, "tool_search_call", call.Get("type").String())
	request["input"] = []any{user, call.Value(), map[string]any{
		"type": "tool_search_output", "call_id": "call_search_1", "status": "completed", "execution": "client",
		"tools": []any{map[string]any{"type": "namespace", "name": "files", "tools": []any{map[string]any{"type": "function", "name": "list", "parameters": map[string]any{"type": "object"}}}}},
	}}
	_, recorder, err = forwardDeepSeekAliasTest(t, svc, deepSeekAliasTestAccount(), request)
	require.NoError(t, err)
	call = gjson.Get(recorder.Body.String(), "output.0")
	require.Equal(t, "function_call", call.Get("type").String())
	require.Equal(t, "files", call.Get("namespace").String())
	require.Equal(t, "list", call.Get("name").String())
	require.Equal(t, 2, calls)
}
