package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	coderws "github.com/coder/websocket"
	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

// isDeepSeekCompatibilityTarget receives an already resolved upstream model.
// Never map it again: a target may itself be the key of a different alias.
// A third-party name alone is not evidence of DeepSeek semantics; an active
// account mapping, native platform or official endpoint must establish it.
func isDeepSeekCompatibilityTarget(account *Account, upstreamModel string) bool {
	if account == nil || account.Type != AccountTypeAPIKey || !isDeepSeekCatalogModel(upstreamModel) {
		return false
	}
	if targetsDeepSeekAPIHost(account) {
		return true
	}
	if account.IsOpenAIPassthroughEnabled() {
		return false
	}
	for _, target := range account.GetModelMapping() {
		if strings.TrimSpace(target) == strings.TrimSpace(upstreamModel) {
			return true
		}
	}
	return false
}

func deepSeekCompatibilityModel(account *Account, requestedModel string) string {
	if account == nil {
		return ""
	}
	_, target := resolveOpenAIForwardMappedModels(account, requestedModel, false)
	if isDeepSeekCompatibilityTarget(account, target) {
		return target
	}
	return ""
}

func codexAccountCapabilityModel(account *Account, publicModel string) string {
	if account == nil || account.IsOpenAIPassthroughEnabled() {
		return publicModel
	}
	return account.GetMappedModel(publicModel)
}

// These fields describe the executable wire contract, not the public alias.
// DeepSeek uses standard Responses and cannot execute GPT's private Lite wire.
func constrainDeepSeekCodexCapabilities(fields map[string]json.RawMessage) bool {
	changed := false
	for key, value := range map[string]json.RawMessage{
		"use_responses_lite":     json.RawMessage("false"),
		"tool_mode":              json.RawMessage("null"),
		"prefer_websockets":      json.RawMessage("false"),
		"service_tiers":          json.RawMessage("[]"),
		"additional_speed_tiers": json.RawMessage("[]"),
	} {
		if !bytes.Equal(bytes.TrimSpace(fields[key]), value) {
			fields[key] = value
			changed = true
		}
	}
	return changed
}

type deepSeekHistoryMode string

const (
	deepSeekExplicitHistory deepSeekHistoryMode = "explicit"
	deepSeekRestoredHistory deepSeekHistoryMode = "restored"
)

type deepSeekCompatibilityError struct {
	param   string
	message string
}

func (e *deepSeekCompatibilityError) Error() string { return e.message }

func deepSeekRequestError(model, param, message string) error {
	return &deepSeekCompatibilityError{param: param, message: fmt.Sprintf("DeepSeek model %q: %s", model, message)}
}

func writeDeepSeekCompatibilityError(c *gin.Context, err error) {
	param := "input"
	if typed, ok := err.(*deepSeekCompatibilityError); ok {
		param = typed.param
	}
	MarkOpsClientBusinessLimited(c, OpsClientBusinessLimitedReasonLocalFeatureGate)
	c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{
		"type": "invalid_request_error", "param": param, "message": err.Error(),
	}})
}

// prepareDeepSeekAliasRequestBody works on a fresh decoded copy. It leaves
// client tool types intact: native Responses and the Chat bridge each own
// their reversible lowering and must not lower the same tool twice.
func prepareDeepSeekAliasRequestBody(body []byte, model string, historyMode deepSeekHistoryMode) ([]byte, error) {
	var request map[string]any
	if err := decodeOpenAIJSONUseNumber(body, &request); err != nil || request == nil {
		return nil, deepSeekRequestError(model, "input", "request must be a JSON object")
	}
	if reasoning, ok := request["reasoning"].(map[string]any); ok {
		if effort, exists := reasoning["effort"]; exists {
			normalized, err := deepSeekReasoningEffort(model, effort)
			if err != nil {
				return nil, err
			}
			reasoning["effort"] = normalized
		}
		delete(reasoning, "context")
	}
	if effort, exists := request["reasoning_effort"]; exists {
		normalized, err := deepSeekReasoningEffort(model, effort)
		if err != nil {
			return nil, err
		}
		if _, exists := request["reasoning"]; !exists {
			request["reasoning"] = map[string]any{"effort": normalized}
		}
		delete(request, "reasoning_effort")
	}
	tools, toolsOK := request["tools"].([]any)
	if value, exists := request["tools"]; exists && value != nil && !toolsOK {
		return nil, deepSeekRequestError(model, "tools", "tools must be an array of declarations")
	}
	items, isArray := request["input"].([]any)
	if item, ok := request["input"].(map[string]any); ok {
		items, isArray = []any{item}, true
	}
	kept := make([]any, 0, len(items))
	hasHistory := false
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if text, isText := raw.(string); isText {
			item, ok = map[string]any{"type": "message", "role": "user", "content": text}, true
		}
		if !ok {
			return nil, deepSeekRequestError(model, "input", "input items must be objects")
		}
		typ, _ := item["type"].(string)
		if typ == "additional_tools" {
			additional, ok := item["tools"].([]any)
			if !ok {
				return nil, deepSeekRequestError(model, "tools", "additional_tools must contain a tools array")
			}
			var err error
			tools, err = mergeOpenAIResponsesLiteAdditionalTools(tools, additional)
			if err != nil {
				return nil, deepSeekRequestError(model, "tools", err.Error())
			}
			request["tools"] = tools
			continue
		}
		if typ == "item_reference" {
			return nil, deepSeekRequestError(model, "input", "item_reference cannot be restored; send explicit message and tool history")
		}
		switch typ {
		case "", "message", "reasoning", "function_call", "function_call_output", "custom_tool_call", "custom_tool_call_output", "tool_search_call", "tool_search_output":
		default:
			return nil, deepSeekRequestError(model, "input", fmt.Sprintf("unsupported history item type %q; send explicit message and tool history", typ))
		}
		if item["role"] == "assistant" || isCodexToolCallContextItemType(typ) {
			hasHistory = true
		}
		kept = append(kept, item)
	}
	if err := validateDeepSeekClientTools(tools, model); err != nil {
		return nil, err
	}
	if choice, ok := request["tool_choice"].(map[string]any); ok {
		switch choice["type"] {
		case "function", "custom", "tool_search":
		default:
			return nil, deepSeekRequestError(model, "tool_choice", "the selected tool cannot be adapted to a client function")
		}
	}
	if isArray {
		request["input"] = kept
	}
	if previous, _ := request["previous_response_id"].(string); strings.TrimSpace(previous) != "" && historyMode != deepSeekRestoredHistory && !hasHistory {
		return nil, deepSeekRequestError(model, "previous_response_id", "response history is unavailable; send complete explicit history")
	}
	delete(request, "previous_response_id")
	request["store"] = false
	if metadata, ok := request["client_metadata"].(map[string]any); ok {
		delete(metadata, responsesLiteWSMetadataKey)
	}
	encoded, err := marshalOpenAIUpstreamJSON(request)
	if err != nil {
		return nil, err
	}
	coverage := AnalyzeToolCallOutputContextCoverageBytes(encoded)
	if coverage.HasFunctionCallOutput && !coverage.ContextCoversAllCallIDs {
		return nil, deepSeekRequestError(model, "input", "tool output has no matching call; send complete explicit history")
	}
	return encoded, nil
}

func deepSeekReasoningEffort(model string, value any) (string, error) {
	effort, ok := value.(string)
	if !ok {
		return "", deepSeekRequestError(model, "reasoning.effort", "reasoning effort must be a string")
	}
	switch strings.ToLower(strings.TrimSpace(effort)) {
	case "none":
		return "none", nil
	case "minimal", "low":
		return "low", nil
	case "medium", "high", "xhigh":
		return "high", nil
	case "max", "ultra":
		return "max", nil
	default:
		return "", deepSeekRequestError(model, "reasoning.effort", "unsupported reasoning effort")
	}
}

func validateDeepSeekClientTools(tools []any, model string) error {
	for _, raw := range tools {
		tool, ok := raw.(map[string]any)
		if !ok {
			return deepSeekRequestError(model, "tools", "tool declarations must be objects")
		}
		switch tool["type"] {
		case "function", "custom", "tool_search":
		case "namespace":
			children, ok := tool["tools"].([]any)
			if !ok {
				return deepSeekRequestError(model, "tools", "namespace must contain a tools array")
			}
			if err := validateDeepSeekClientTools(children, model); err != nil {
				return err
			}
		default:
			return deepSeekRequestError(model, "tools", fmt.Sprintf("unsupported client tool type %q", tool["type"]))
		}
	}
	return nil
}

func stripDeepSeekLiteHeader(req *http.Request, account *Account, body []byte) {
	if isDeepSeekCompatibilityTarget(account, gjson.GetBytes(body, "model").String()) {
		req.Header.Del(responsesLiteHeader)
	}
}

func writeDeepSeekWSCompatibilityError(c *gin.Context, write func([]byte) error, err error) error {
	param := "input"
	if typed, ok := err.(*deepSeekCompatibilityError); ok {
		param = typed.param
	}
	MarkOpsClientBusinessLimited(c, OpsClientBusinessLimitedReasonLocalFeatureGate)
	payload, marshalErr := json.Marshal(map[string]any{"type": "error", "error": map[string]any{
		"type": "invalid_request_error", "param": param, "message": err.Error(),
	}})
	if marshalErr != nil {
		return marshalErr
	}
	if writeErr := write(payload); writeErr != nil {
		return writeErr
	}
	return NewOpenAIWSClientCloseError(coderws.StatusPolicyViolation, err.Error(), err)
}

func deepSeekReplayMessages(items []json.RawMessage) []json.RawMessage {
	messages := make([]json.RawMessage, 0, len(items))
	for _, item := range items {
		if gjson.GetBytes(item, "type").String() != "additional_tools" {
			messages = append(messages, item)
		}
	}
	return messages
}
