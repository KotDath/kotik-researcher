package deepseek

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestStreamSendsStatelessRequestAndEmitsDeltas(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s, want POST", r.Method)
		}
		if authorization := r.Header.Get("Authorization"); authorization != "Bearer test-key" {
			t.Errorf("Authorization = %q, want Bearer test-key", authorization)
		}
		if accept := r.Header.Get("Accept"); accept != "text/event-stream" {
			t.Errorf("Accept = %q, want text/event-stream", accept)
		}

		var request chatRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if request.Model != "deepseek-v4-flash" {
			t.Errorf("model = %q, want deepseek-v4-flash", request.Model)
		}
		if len(request.Messages) != 1 || request.Messages[0] != (message{Role: "user", Content: "question"}) {
			t.Errorf("messages = %#v, want one user question", request.Messages)
		}
		if request.Thinking.Type != "enabled" || request.ReasoningEffort != "high" {
			t.Errorf("thinking = %#v, effort = %q", request.Thinking, request.ReasoningEffort)
		}
		if request.MaxTokens != 4096 || !request.Stream {
			t.Errorf("max_tokens = %d, stream = %v", request.MaxTokens, request.Stream)
		}

		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"think \"}}]}\n\n"))
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"carefully\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: {\"choices\":[{\"finish_reason\":\"stop\",\"delta\":{\"content\":\"final answer\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	client := New("test-key")
	client.endpoint = server.URL
	client.httpClient = server.Client()

	var deltas []Delta
	err := client.Stream(context.Background(), "question", func(delta Delta) error {
		deltas = append(deltas, delta)
		return nil
	})
	if err != nil {
		t.Fatalf("Stream() error = %v", err)
	}

	want := []Delta{
		{Kind: DeltaReasoning, Text: "think "},
		{Kind: DeltaReasoning, Text: "carefully"},
		{Kind: DeltaAnswer, Text: "final answer"},
	}
	if !reflect.DeepEqual(deltas, want) {
		t.Fatalf("deltas = %#v, want %#v", deltas, want)
	}
}

func TestStreamReturnsAPIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"invalid key"}}`))
	}))
	defer server.Close()

	client := New("test-key")
	client.endpoint = server.URL
	client.httpClient = server.Client()

	err := client.Stream(context.Background(), "question", func(Delta) error { return nil })
	var apiError *APIError
	if !errors.As(err, &apiError) {
		t.Fatalf("error = %v, want APIError", err)
	}
	if apiError.StatusCode != http.StatusUnauthorized || apiError.Message != "invalid key" {
		t.Fatalf("APIError = %#v", apiError)
	}
}

func TestConsumeStreamRejectsMalformedOrIncompleteStream(t *testing.T) {
	t.Run("malformed chunk", func(t *testing.T) {
		err := consumeStream(strings.NewReader("data: not-json\n\n"), func(Delta) error { return nil })
		if err == nil || !strings.Contains(err.Error(), "decode DeepSeek stream chunk") {
			t.Fatalf("error = %v", err)
		}
	})

	t.Run("missing done marker", func(t *testing.T) {
		err := consumeStream(strings.NewReader("data: {\"choices\":[]}\n\n"), func(Delta) error { return nil })
		if err == nil || !strings.Contains(err.Error(), "before [DONE]") {
			t.Fatalf("error = %v", err)
		}
	})

	t.Run("incomplete completion", func(t *testing.T) {
		stream := "data: {\"choices\":[{\"finish_reason\":\"length\",\"delta\":{\"content\":\"partial\"}}]}\n\ndata: [DONE]\n\n"
		err := consumeStream(strings.NewReader(stream), func(Delta) error { return nil })
		if err == nil || !strings.Contains(err.Error(), `reason "length"`) {
			t.Fatalf("error = %v", err)
		}
	})

	t.Run("empty final answer", func(t *testing.T) {
		stream := "data: {\"choices\":[{\"finish_reason\":\"stop\",\"delta\":{}}]}\n\ndata: [DONE]\n\n"
		err := consumeStream(strings.NewReader(stream), func(Delta) error { return nil })
		if err == nil || !strings.Contains(err.Error(), "did not contain a final answer") {
			t.Fatalf("error = %v", err)
		}
	})
}

func TestStreamCancelsUpstreamRequest(t *testing.T) {
	requestStarted := make(chan struct{})
	requestCanceled := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(requestStarted)
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(requestCanceled)
	}))
	defer server.Close()

	client := New("test-key")
	client.endpoint = server.URL
	client.httpClient = server.Client()

	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		result <- client.Stream(ctx, "question", func(Delta) error { return nil })
	}()

	select {
	case <-requestStarted:
	case <-time.After(time.Second):
		t.Fatal("upstream request did not start")
	}
	cancel()

	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("error = %v, want context.Canceled", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Stream did not return after cancellation")
	}

	select {
	case <-requestCanceled:
	case <-time.After(time.Second):
		t.Fatal("upstream request context was not canceled")
	}
}
