package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"
)

const deepSeekTestAlias = "gpt-6.1-sol"
const deepSeekTestTarget = "deepseek-v4.1-flash"

func deepSeekAliasTestAccount() *Account {
	account := newCodexModelsAPIKeyTestAccount("https://relay.example/v1")
	account.Status = StatusActive
	account.Schedulable = true
	account.Credentials["model_mapping"] = map[string]any{deepSeekTestAlias: deepSeekTestTarget}
	account.Extra = map[string]any{"openai_responses_supported": true}
	return account
}

func assertDeepSeekAliasCatalog(t *testing.T, body []byte) map[string]any {
	t.Helper()
	models := decodeCodexManifestModels(t, body)
	require.Len(t, models, 1)
	model := models[0]
	require.Equal(t, deepSeekTestAlias, model["slug"])
	require.Equal(t, deepSeekTestAlias, model["display_name"])
	require.Equal(t, []string{"low", "high", "max"}, effortsFromManifestModel(t, model))
	require.Equal(t, false, model["use_responses_lite"])
	require.Equal(t, false, model["prefer_websockets"])
	require.Nil(t, model["tool_mode"])
	require.Empty(t, model["service_tiers"])
	require.Empty(t, model["additional_speed_tiers"])
	return model
}

func TestDeepSeekAliasCatalogAllSources(t *testing.T) {
	account := deepSeekAliasTestAccount()
	for _, source := range []string{
		`{"models":[{"slug":"gpt-6.1-sol"}]}`,
		`{"models":[{"slug":"gpt-6.1-sol","use_responses_lite":true,"tool_mode":"code_mode_only","service_tiers":[{"id":"priority"}],"additional_speed_tiers":["fast"]}]}`,
		`{"data":[{"id":"gpt-6.1-sol","use_responses_lite":true,"tool_mode":"code_mode_only"}]}`,
	} {
		t.Run(source, func(t *testing.T) {
			converted := convertOpenAIModelListToCodexManifestForAccount([]byte(source), account)
			manifest := &OpenAIModelsResponse{Body: converted}
			svc := &OpenAIGatewayService{}
			require.NoError(t, svc.CompleteAPIKeyCodexModelsManifestForClient(manifest, account))
			assertDeepSeekAliasCatalog(t, manifest.Body)
			require.Equal(t, codexModelsManifestBodyETag(manifest.Body), manifest.ETag)
		})
	}
	for _, platform := range []string{PlatformOpenAI, PlatformComposite} {
		body, err := buildCodexModelsManifestForAccounts(platform, []string{deepSeekTestAlias}, []Account{*account}, nil, nil, true)
		require.NoError(t, err)
		assertDeepSeekAliasCatalog(t, body)
	}
}

func TestDeepSeekAliasCatalogSnapshotAndCachedSourceIsolation(t *testing.T) {
	const source = `{"models":[{"slug":"gpt-6.1-sol","use_responses_lite":true,"tool_mode":"code_mode_only"}],"metadata":{"kept":true}}`
	var calls atomic.Int32
	upstream := &codexModelsHTTPUpstreamStub{do: func(*http.Request, string, int64, int) (*http.Response, error) {
		calls.Add(1)
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(source))}, nil
	}}
	svc := newCodexModelsAPIKeyTestService(upstream)
	account := deepSeekAliasTestAccount()
	first, err := svc.FetchCodexModelsManifest(context.Background(), account, "0.153.0", "")
	require.NoError(t, err)
	require.NoError(t, svc.CompleteAPIKeyCodexModelsManifestForClient(first, account))
	assertDeepSeekAliasCatalog(t, first.Body)
	firstBody := append([]byte(nil), first.Body...)
	firstETag := first.ETag

	reasoning := true
	account.SetUpstreamModelMetadataSnapshot(UpstreamModelMetadataSnapshot{Models: map[string]UpstreamModelMetadata{
		deepSeekTestTarget: {
			ID: deepSeekTestTarget, Reasoning: &reasoning,
			SupportedReasoningLevels: []string{"high", "max"}, DefaultReasoningLevel: "max",
			InputModalities: []string{"text", "image"}, ContextWindow: 262144,
			CodexToolCapabilities: map[string]json.RawMessage{"use_responses_lite": json.RawMessage("true")},
		},
	}})
	second, err := svc.FetchCodexModelsManifest(context.Background(), account, "0.153.0", "")
	require.NoError(t, err)
	require.NoError(t, svc.CompleteAPIKeyCodexModelsManifestForClient(second, account))
	model := decodeCodexManifestModels(t, second.Body)[0]
	require.Equal(t, []string{"high", "max"}, effortsFromManifestModel(t, model))
	require.Equal(t, "max", model["default_reasoning_level"])
	require.EqualValues(t, 262144, model["context_window"])
	require.Equal(t, []any{"text", "image"}, model["input_modalities"])
	require.Equal(t, false, model["use_responses_lite"])
	require.NotEqual(t, firstETag, second.ETag)
	require.False(t, CodexModelsManifestETagMatches(firstETag, second.ETag))
	require.Equal(t, firstBody, first.Body)
	require.JSONEq(t, source, string(second.upstreamSourceBody))

	peer := newCodexModelsAPIKeyTestAccount("https://relay.example/v1")
	third, err := svc.FetchCodexModelsManifest(context.Background(), peer, "0.153.0", "")
	require.NoError(t, err)
	require.NoError(t, svc.CompleteAPIKeyCodexModelsManifestForClient(third, peer))
	peerModel := decodeCodexManifestModels(t, third.Body)[0]
	require.Contains(t, effortsFromManifestModel(t, peerModel), "ultra")
	require.Equal(t, "code_mode_only", peerModel["tool_mode"])
	require.EqualValues(t, 1, calls.Load(), "account/group-specific completion must not replace the shared source cache")
}

func TestDeepSeekAliasCatalogIgnoresInactivePassthroughMapping(t *testing.T) {
	account := deepSeekAliasTestAccount()
	account.Extra["openai_passthrough"] = true
	svc := &OpenAIGatewayService{}
	reasoning := true
	account.SetUpstreamModelMetadataSnapshot(UpstreamModelMetadataSnapshot{Models: map[string]UpstreamModelMetadata{
		deepSeekTestTarget: {ID: deepSeekTestTarget, Reasoning: &reasoning, SupportedReasoningLevels: []string{"low"}, ContextWindow: 12345},
	}})
	for _, source := range []string{`{"models":[{"slug":"gpt-6.1-sol"}]}`, `{"data":[{"id":"gpt-6.1-sol"}]}`} {
		manifest := &OpenAIModelsResponse{Body: convertOpenAIModelListToCodexManifestForAccount([]byte(source), account)}
		require.NoError(t, svc.CompleteAPIKeyCodexModelsManifestForClient(manifest, account))
		model := decodeCodexManifestModels(t, manifest.Body)[0]
		require.Contains(t, effortsFromManifestModel(t, model), "ultra")
		require.NotEqualValues(t, 12345, model["context_window"])
	}
	body, err := buildCodexModelsManifestForAccounts(PlatformOpenAI, []string{deepSeekTestAlias}, []Account{*account}, nil, nil, true)
	require.NoError(t, err)
	require.Contains(t, effortsFromManifestModel(t, decodeCodexManifestModels(t, body)[0]), "ultra")
}
