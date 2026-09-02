package deepseek

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/KotDath/kotik-researcher/internal/agent"
)

func TestProviderPayloadAndNormalizedStream(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("Authorization = %q", request.Header.Get("Authorization"))
		}
		var payload map[string]any
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload["model"] != DefaultModel || payload["reasoning_effort"] != "high" || payload["max_tokens"] != float64(4096) || payload["stream"] != true {
			t.Errorf("payload = %#v", payload)
		}
		response.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(response, "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"think\"}}]}\n\n")
		_, _ = io.WriteString(response, "data: {\"choices\":[{\"finish_reason\":\"stop\",\"delta\":{\"content\":\"answer\"}}]}\n\n")
		_, _ = io.WriteString(response, "data: [DONE]\n\n")
	}))
	defer server.Close()
	provider := NewProvider(Options{APIKey: "test-key", Endpoint: server.URL})
	var deltas []agent.Delta
	err := provider.Stream(context.Background(), []agent.Message{{Role: agent.RoleUser, Content: "question"}}, func(delta agent.Delta) error {
		deltas = append(deltas, delta)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(deltas) != 2 || deltas[0].Type != agent.DeltaReasoning || deltas[1].Delta != "answer" {
		t.Fatalf("deltas = %#v", deltas)
	}
}

func TestProviderAPIAndIncompleteStreamErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(response, `{"error":{"message":"invalid key"}}`)
	}))
	provider := NewProvider(Options{APIKey: "bad", Endpoint: server.URL})
	err := provider.Stream(context.Background(), nil, func(agent.Delta) error { return nil })
	server.Close()
	var apiError *APIError
	if !errors.As(err, &apiError) || apiError.StatusCode != 401 || apiError.APIMessage != "invalid key" {
		t.Fatalf("API error = %#v (%v)", apiError, err)
	}

	server = httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_, _ = io.WriteString(response, "data: {\"choices\":[]}\n\n")
	}))
	defer server.Close()
	provider = NewProvider(Options{APIKey: "key", Endpoint: server.URL})
	err = provider.Stream(context.Background(), nil, func(agent.Delta) error { return nil })
	if err == nil || !strings.Contains(err.Error(), "before [DONE]") {
		t.Fatalf("incomplete stream error = %v", err)
	}
}

func TestProviderCancellationAndEventLimit(t *testing.T) {
	cancelled := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		<-request.Context().Done()
		close(cancelled)
	}))
	provider := NewProvider(Options{APIKey: "key", Endpoint: server.URL})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := provider.Stream(ctx, nil, func(agent.Delta) error { return nil }); err == nil {
		t.Fatal("cancelled request succeeded")
	}
	server.Close()

	err := readSSE(strings.NewReader("data: "+strings.Repeat("x", maxBodySize)+"\n\n"), func(string) error { return nil })
	if err == nil || !strings.Contains(err.Error(), "size limit") {
		t.Fatalf("oversized event error = %v", err)
	}
}
