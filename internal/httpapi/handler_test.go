package httpapi_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/KotDath/kotik-researcher/internal/deepseek"
	"github.com/KotDath/kotik-researcher/internal/httpapi"
)

type chatStub struct {
	question string
	deltas   []deepseek.Delta
	err      error
}

func (s *chatStub) Stream(_ context.Context, question string, emit func(deepseek.Delta) error) error {
	s.question = question
	for _, delta := range s.deltas {
		if err := emit(delta); err != nil {
			return err
		}
	}
	return s.err
}

func TestHealth(t *testing.T) {
	handler := httpapi.New(http.NotFoundHandler(), &chatStub{})
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", contentType)
	}

	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Status != "ok" {
		t.Fatalf("status body = %q, want ok", body.Status)
	}
}

func TestHealthRejectsUnsupportedMethod(t *testing.T) {
	handler := httpapi.New(http.NotFoundHandler(), &chatStub{})
	request := httptest.NewRequest(http.MethodPost, "/api/health", strings.NewReader("{}"))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusMethodNotAllowed)
	}
}

func TestChatStreamsReasoningAndAnswer(t *testing.T) {
	chat := &chatStub{deltas: []deepseek.Delta{
		{Kind: deepseek.DeltaReasoning, Text: "thinking"},
		{Kind: deepseek.DeltaAnswer, Text: "answer"},
	}}
	handler := httpapi.New(http.NotFoundHandler(), chat)
	request := httptest.NewRequest(http.MethodPost, "/api/chat", strings.NewReader(`{"question":"  current question  "}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "text/event-stream" {
		t.Fatalf("Content-Type = %q, want text/event-stream", contentType)
	}
	if chat.question != "current question" {
		t.Fatalf("question = %q, want current question", chat.question)
	}
	body := response.Body.String()
	for _, expected := range []string{
		"event: reasoning\ndata: {\"delta\":\"thinking\"}",
		"event: answer\ndata: {\"delta\":\"answer\"}",
		"event: done\ndata: {}",
	} {
		if !strings.Contains(body, expected) {
			t.Errorf("response body does not contain %q:\n%s", expected, body)
		}
	}
}

func TestChatValidatesQuestion(t *testing.T) {
	handler := httpapi.New(http.NotFoundHandler(), &chatStub{})
	request := httptest.NewRequest(http.MethodPost, "/api/chat", strings.NewReader(`{"question":"   "}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
}

func TestChatMapsUpstreamError(t *testing.T) {
	handler := httpapi.New(http.NotFoundHandler(), &chatStub{err: errors.New("upstream failed")})
	request := httptest.NewRequest(http.MethodPost, "/api/chat", strings.NewReader(`{"question":"hello"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadGateway)
	}
}

func TestChatRejectsCrossSiteAndSimpleRequests(t *testing.T) {
	handler := httpapi.New(http.NotFoundHandler(), &chatStub{})
	tests := []struct {
		name        string
		contentType string
		origin      string
		fetchSite   string
		wantStatus  int
	}{
		{name: "simple content type", contentType: "text/plain", wantStatus: http.StatusUnsupportedMediaType},
		{name: "remote origin", contentType: "application/json", origin: "https://example.com", wantStatus: http.StatusForbidden},
		{name: "cross-site fetch", contentType: "application/json", fetchSite: "cross-site", wantStatus: http.StatusForbidden},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/api/chat", strings.NewReader(`{"question":"hello"}`))
			request.Header.Set("Content-Type", test.contentType)
			request.Header.Set("Origin", test.origin)
			request.Header.Set("Sec-Fetch-Site", test.fetchSite)
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
		})
	}
}

func TestChatAllowsLoopbackDevOrigin(t *testing.T) {
	chat := &chatStub{deltas: []deepseek.Delta{{Kind: deepseek.DeltaAnswer, Text: "answer"}}}
	handler := httpapi.New(http.NotFoundHandler(), chat)
	request := httptest.NewRequest(http.MethodPost, "/api/chat", strings.NewReader(`{"question":"hello"}`))
	request.Header.Set("Content-Type", "application/json; charset=utf-8")
	request.Header.Set("Origin", "http://127.0.0.1:5173")
	request.Header.Set("Sec-Fetch-Site", "same-origin")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
}
