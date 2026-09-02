package gateway

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/KotDath/kotik-researcher/internal/agent"
)

type testProvider func(context.Context, []agent.Message, func(agent.Delta) error) error

func (p testProvider) Stream(ctx context.Context, messages []agent.Message, emit func(agent.Delta) error) error {
	return p(ctx, messages, emit)
}

func TestRoutesStreamHistoryAndDelete(t *testing.T) {
	runtime := testRuntime(testProvider(func(_ context.Context, _ []agent.Message, emit func(agent.Delta) error) error {
		if err := emit(agent.Delta{Type: agent.DeltaReasoning, Delta: "thinking"}); err != nil {
			return err
		}
		return emit(agent.Delta{Type: agent.DeltaAnswer, Delta: "answer"})
	}))
	handler := NewHandler(Options{Runtime: runtime})
	defer handler.Close()
	server := httptest.NewServer(handler)
	defer server.Close()

	created := requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/sessions", `{}`)
	if created.StatusCode != http.StatusCreated {
		t.Fatalf("create status = %d", created.StatusCode)
	}
	created.Body.Close()
	turn := requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/sessions/session-1/turns", `{"message":"  question  "}`)
	body, _ := io.ReadAll(turn.Body)
	turn.Body.Close()
	stream := string(body)
	if turn.StatusCode != http.StatusOK || !strings.Contains(stream, `data: {"type":"answer.delta","delta":"answer"}`) || !strings.Contains(stream, `{"type":"turn.completed"}`) {
		t.Fatalf("turn status/body = %d %q", turn.StatusCode, stream)
	}
	response, err := server.Client().Get(server.URL + "/api/sessions/session-1")
	if err != nil {
		t.Fatal(err)
	}
	var history struct {
		Session sessionResponse `json:"session"`
	}
	if err := json.NewDecoder(response.Body).Decode(&history); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if len(history.Session.Messages) != 2 || history.Session.Messages[1].Content != "answer" {
		t.Fatalf("history = %#v", history.Session.Messages)
	}
	request, _ := http.NewRequest(http.MethodDelete, server.URL+"/api/sessions/session-1", nil)
	response, err = server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("delete status = %d", response.StatusCode)
	}
}

func TestValidationOriginTokenAndCORS(t *testing.T) {
	handler := NewHandler(Options{
		Runtime: testRuntime(noopProvider()), AccessToken: "secret",
		AllowedOrigins: []string{"http://127.0.0.1:5173"},
	})
	defer handler.Close()
	server := httptest.NewServer(handler)
	defer server.Close()

	unauthorized := requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/sessions", `{}`)
	if unauthorized.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d", unauthorized.StatusCode)
	}
	unauthorized.Body.Close()
	request, _ := http.NewRequest(http.MethodPost, server.URL+"/api/sessions", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer secret")
	request.Header.Set("Origin", "https://example.com")
	remote, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	remote.Body.Close()
	if remote.StatusCode != http.StatusForbidden {
		t.Fatalf("remote origin status = %d", remote.StatusCode)
	}
	request, _ = http.NewRequest(http.MethodOptions, server.URL+"/api/sessions/session-1", nil)
	request.Header.Set("Origin", "http://127.0.0.1:5173")
	preflight, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	preflight.Body.Close()
	if preflight.StatusCode != http.StatusNoContent || !strings.Contains(preflight.Header.Get("Access-Control-Allow-Methods"), "DELETE") {
		t.Fatalf("preflight = %d %#v", preflight.StatusCode, preflight.Header)
	}
	request, _ = http.NewRequest(http.MethodOptions, server.URL+"/api/sessions/session-1", nil)
	request.Header.Set("Origin", "http://127.0.0.1:5174")
	deniedLoopback, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	deniedLoopback.Body.Close()
	if deniedLoopback.StatusCode != http.StatusForbidden {
		t.Fatalf("unlisted loopback origin status = %d", deniedLoopback.StatusCode)
	}

	badShape := requestWithToken(t, server.Client(), server.URL+"/api/sessions", `{"extra":true}`)
	if badShape.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad shape status = %d", badShape.StatusCode)
	}
	badShape.Body.Close()
	large := requestWithToken(t, server.Client(), server.URL+"/api/sessions", `{"x":"`+strings.Repeat("a", maxRequestSize)+`"}`)
	if large.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("large body status = %d", large.StatusCode)
	}
	large.Body.Close()
}

func TestEphemeralCleanupAndStaticFallback(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("<title>kotik</title>"), 0o600); err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(Options{Runtime: testRuntime(noopProvider()), WebRoot: root, EphemeralTTL: 25 * time.Millisecond})
	defer handler.Close()
	server := httptest.NewServer(handler)
	defer server.Close()

	created := requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/sessions", `{"ephemeral":true}`)
	created.Body.Close()
	turn := requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/sessions/session-1/turns", `{"message":"question"}`)
	_, _ = io.Copy(io.Discard, turn.Body)
	turn.Body.Close()
	missing, err := server.Client().Get(server.URL + "/api/sessions/session-1")
	if err != nil {
		t.Fatal(err)
	}
	missing.Body.Close()
	if missing.StatusCode != http.StatusNotFound {
		t.Fatalf("ephemeral session status = %d", missing.StatusCode)
	}
	orphan := requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/sessions", `{"ephemeral":true}`)
	orphan.Body.Close()
	deadline := time.Now().Add(time.Second)
	for {
		response, err := server.Client().Get(server.URL + "/api/sessions/session-1")
		if err != nil {
			t.Fatal(err)
		}
		status := response.StatusCode
		response.Body.Close()
		if status == http.StatusNotFound {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("orphaned ephemeral session was not deleted")
		}
		time.Sleep(10 * time.Millisecond)
	}
	spa, err := server.Client().Get(server.URL + "/research/session")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(spa.Body)
	spa.Body.Close()
	if spa.StatusCode != http.StatusOK || !strings.Contains(string(body), "<title>kotik</title>") || !strings.Contains(spa.Header.Get("Content-Security-Policy"), "default-src 'self'") {
		t.Fatalf("SPA response = %d %q", spa.StatusCode, body)
	}
}

func TestCancelActiveTurn(t *testing.T) {
	started := make(chan struct{})
	provider := testProvider(func(ctx context.Context, _ []agent.Message, _ func(agent.Delta) error) error {
		close(started)
		<-ctx.Done()
		return ctx.Err()
	})
	handler := NewHandler(Options{Runtime: testRuntime(provider)})
	defer handler.Close()
	server := httptest.NewServer(handler)
	defer server.Close()
	created := requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/sessions", `{}`)
	created.Body.Close()
	turnResult := make(chan *http.Response, 1)
	go func() {
		turnResult <- requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/sessions/session-1/turns", `{"message":"question"}`)
	}()
	<-started
	cancelled := requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/sessions/session-1/cancel", ``)
	var value struct {
		Cancelled bool `json:"cancelled"`
	}
	_ = json.NewDecoder(cancelled.Body).Decode(&value)
	cancelled.Body.Close()
	if !value.Cancelled {
		t.Fatal("cancel endpoint returned false")
	}
	turn := <-turnResult
	turn.Body.Close()
}

func testRuntime(provider agent.ModelProvider) *agent.Runtime {
	return agent.NewRuntime(provider, agent.NewInMemorySessionRepository(), agent.RuntimeOptions{
		IDFactory: func() string { return "session-1" },
		Now:       func() time.Time { return time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC) },
	})
}

func noopProvider() agent.ModelProvider {
	return testProvider(func(_ context.Context, _ []agent.Message, emit func(agent.Delta) error) error {
		return emit(agent.Delta{Type: agent.DeltaAnswer, Delta: "answer"})
	})
}

func requestJSON(t *testing.T, client *http.Client, method, url, body string) *http.Response {
	t.Helper()
	request, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func requestWithToken(t *testing.T, client *http.Client, url, body string) *http.Response {
	t.Helper()
	request, _ := http.NewRequest(http.MethodPost, url, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer secret")
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}
