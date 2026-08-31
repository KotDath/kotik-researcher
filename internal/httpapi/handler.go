package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/KotDath/kotik-researcher/internal/deepseek"
)

const maxChatRequestSize = 64 << 10

type ChatStreamer interface {
	Stream(context.Context, string, func(deepseek.Delta) error) error
}

// New returns the application HTTP handler with API and web routes isolated.
func New(web http.Handler, chat ChatStreamer) http.Handler {
	api := http.NewServeMux()
	api.HandleFunc("GET /health", health)
	api.HandleFunc("POST /chat", streamChat(chat))

	root := http.NewServeMux()
	root.Handle("/api/", http.StripPrefix("/api", api))
	root.Handle("/", web)

	return root
}

func streamChat(chat ChatStreamer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if status, err := validateChatRequest(r); err != nil {
			writeJSONError(w, status, err.Error())
			return
		}
		request, err := decodeChatRequest(w, r)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, err.Error())
			return
		}

		flusher, ok := w.(http.Flusher)
		if !ok {
			writeJSONError(w, http.StatusInternalServerError, "streaming is not supported")
			return
		}

		started := false
		writeEvent := func(event string, payload any) error {
			body, err := json.Marshal(payload)
			if err != nil {
				return fmt.Errorf("encode %s event: %w", event, err)
			}
			if !started {
				w.Header().Set("Content-Type", "text/event-stream")
				w.Header().Set("Cache-Control", "no-cache")
				w.Header().Set("X-Accel-Buffering", "no")
				w.WriteHeader(http.StatusOK)
				started = true
			}
			if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, body); err != nil {
				return fmt.Errorf("write %s event: %w", event, err)
			}
			flusher.Flush()
			return nil
		}

		err = chat.Stream(r.Context(), request.Question, func(delta deepseek.Delta) error {
			return writeEvent(string(delta.Kind), struct {
				Delta string `json:"delta"`
			}{Delta: delta.Text})
		})
		if err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(r.Context().Err(), context.Canceled) {
				return
			}
			log.Printf("DeepSeek chat request failed: %v", err)
			if !started {
				writeJSONError(w, http.StatusBadGateway, "DeepSeek API request failed")
				return
			}
			_ = writeEvent("error", struct {
				Message string `json:"message"`
			}{Message: "DeepSeek API request failed"})
			return
		}

		_ = writeEvent("done", struct{}{})
	}
}

func validateChatRequest(r *http.Request) (int, error) {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return http.StatusUnsupportedMediaType, errors.New("Content-Type must be application/json")
	}

	if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		return http.StatusForbidden, errors.New("cross-site requests are not allowed")
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		parsedOrigin, err := url.Parse(origin)
		if err != nil || parsedOrigin.Scheme == "" || !isLoopbackHost(parsedOrigin.Hostname()) {
			return http.StatusForbidden, errors.New("request origin must be local")
		}
	}
	return 0, nil
}

func isLoopbackHost(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func decodeChatRequest(w http.ResponseWriter, r *http.Request) (struct {
	Question string `json:"question"`
}, error) {
	var request struct {
		Question string `json:"question"`
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxChatRequestSize)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return request, fmt.Errorf("invalid request body: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return request, errors.New("request body must contain one JSON object")
	}

	request.Question = strings.TrimSpace(request.Question)
	if request.Question == "" {
		return request, errors.New("question is required")
	}
	return request, nil
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(struct {
		Error string `json:"error"`
	}{Error: message})
}

func health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
