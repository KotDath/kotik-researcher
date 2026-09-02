package gateway

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/KotDath/kotik-researcher/internal/agent"
)

const (
	maxRequestSize        = 64 << 10
	defaultEphemeralTTL   = 10 * time.Minute
	contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self'; " +
		"connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
)

type Options struct {
	Runtime        *agent.Runtime
	WebRoot        string
	AccessToken    string
	AllowedOrigins []string
	Logger         *log.Logger
	EphemeralTTL   time.Duration
}

type Handler struct {
	runtime        *agent.Runtime
	webRoot        string
	accessToken    string
	logger         *log.Logger
	ephemeral      *ephemeralTracker
	allowedOrigins map[string]struct{}
}

func NewHandler(options Options) *Handler {
	if options.Runtime == nil {
		panic("runtime is required")
	}
	logger := options.Logger
	if logger == nil {
		logger = log.Default()
	}
	ttl := options.EphemeralTTL
	if ttl <= 0 {
		ttl = defaultEphemeralTTL
	}
	h := &Handler{
		runtime: options.Runtime, webRoot: options.WebRoot, accessToken: options.AccessToken, logger: logger,
		allowedOrigins: make(map[string]struct{}, len(options.AllowedOrigins)),
	}
	for _, origin := range options.AllowedOrigins {
		h.allowedOrigins[strings.TrimSuffix(origin, "/")] = struct{}{}
	}
	h.ephemeral = newEphemeralTracker(options.Runtime, ttl, logger)
	return h
}

func (h *Handler) Close() { h.ephemeral.close() }

func NewHTTPServer(address string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              address,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
}

func (h *Handler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if err := h.handle(response, request); err != nil {
		var httpErr *HTTPError
		if errors.As(err, &httpErr) {
			writeJSON(response, httpErr.Status, map[string]any{"error": httpErr.Message})
			return
		}
		h.logger.Printf("Unhandled application server error: %v", err)
		writeJSON(response, http.StatusInternalServerError, map[string]any{"error": "Internal server error"})
	}
}

func (h *Handler) handle(response http.ResponseWriter, request *http.Request) error {
	path := request.URL.EscapedPath()
	if strings.HasPrefix(path, "/api/") {
		if request.Method == http.MethodOptions {
			if !h.authorizeOrigin(response, request) {
				return nil
			}
			h.applyCORS(response, request)
			response.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			response.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			response.Header().Set("Access-Control-Max-Age", "600")
			response.WriteHeader(http.StatusNoContent)
			return nil
		}
		if !h.authorizeOrigin(response, request) {
			return nil
		}
		if h.accessToken != "" && !validBearer(request.Header.Get("Authorization"), h.accessToken) {
			writeJSON(response, http.StatusUnauthorized, map[string]any{"error": "Invalid application access token"})
			return nil
		}
		h.applyCORS(response, request)
		return h.handleAPI(response, request, path)
	}
	return h.serveWeb(response, request)
}

func (h *Handler) handleAPI(response http.ResponseWriter, request *http.Request, path string) error {
	if path == "/api/health" {
		if request.Method != http.MethodGet {
			writeMethodNotAllowed(response, http.MethodGet)
			return nil
		}
		writeJSON(response, http.StatusOK, map[string]any{"status": "ok"})
		return nil
	}
	if path == "/api/sessions" {
		if request.Method != http.MethodPost {
			writeMethodNotAllowed(response, http.MethodPost)
			return nil
		}
		if err := requireJSON(request); err != nil {
			return err
		}
		body, err := readJSONObject(request)
		if err != nil {
			return err
		}
		ephemeral, valid := parseCreateBody(body)
		if !valid {
			writeJSON(response, http.StatusBadRequest, map[string]any{"error": "Request body may contain only an ephemeral boolean"})
			return nil
		}
		session, err := h.runtime.CreateSession(request.Context())
		if err != nil {
			return writeRuntimeError(response, err)
		}
		if ephemeral {
			h.ephemeral.mark(session.ID)
		}
		writeJSON(response, http.StatusCreated, map[string]any{"session": protocolSession(session)})
		return nil
	}

	parts := strings.Split(strings.TrimPrefix(path, "/api/sessions/"), "/")
	if !strings.HasPrefix(path, "/api/sessions/") || len(parts) == 0 || parts[0] == "" {
		writeJSON(response, http.StatusNotFound, map[string]any{"error": "Not found"})
		return nil
	}
	sessionID, err := decodeSegment(parts[0])
	if err != nil {
		return err
	}
	if len(parts) == 1 {
		switch request.Method {
		case http.MethodGet:
			session, err := h.runtime.GetSession(request.Context(), sessionID)
			if err != nil {
				return writeRuntimeError(response, err)
			}
			writeJSON(response, http.StatusOK, map[string]any{"session": protocolSession(session)})
		case http.MethodDelete:
			h.ephemeral.forget(sessionID)
			if err := h.runtime.DeleteSession(request.Context(), sessionID); err != nil {
				return writeRuntimeError(response, err)
			}
			response.WriteHeader(http.StatusNoContent)
		default:
			writeMethodNotAllowed(response, http.MethodGet, http.MethodDelete)
		}
		return nil
	}
	if len(parts) == 2 && parts[1] == "turns" {
		if request.Method != http.MethodPost {
			writeMethodNotAllowed(response, http.MethodPost)
			return nil
		}
		if err := requireJSON(request); err != nil {
			return err
		}
		body, err := readJSONObject(request)
		if err != nil {
			return err
		}
		message, valid := parseTurnBody(body)
		if !valid {
			writeJSON(response, http.StatusBadRequest, map[string]any{"error": "Request body must contain only a message string"})
			return nil
		}
		message = strings.TrimSpace(message)
		if message == "" {
			writeJSON(response, http.StatusBadRequest, map[string]any{"error": "message is required"})
			return nil
		}
		ephemeral := h.ephemeral.claim(sessionID)
		defer func() {
			if ephemeral {
				h.ephemeral.delete(sessionID)
			}
		}()
		h.streamTurn(response, request, sessionID, message)
		return nil
	}
	if len(parts) == 2 && parts[1] == "cancel" {
		if request.Method != http.MethodPost {
			writeMethodNotAllowed(response, http.MethodPost)
			return nil
		}
		if err := requireJSON(request); err != nil {
			return err
		}
		if _, err := h.runtime.GetSession(request.Context(), sessionID); err != nil {
			return writeRuntimeError(response, err)
		}
		writeJSON(response, http.StatusOK, map[string]any{"cancelled": h.runtime.CancelTurn(sessionID)})
		return nil
	}
	writeJSON(response, http.StatusNotFound, map[string]any{"error": "Not found"})
	return nil
}

func (h *Handler) streamTurn(response http.ResponseWriter, request *http.Request, sessionID, message string) {
	started := false
	start := func() {
		if started {
			return
		}
		started = true
		response.Header().Set("Content-Type", "text/event-stream")
		response.Header().Set("Cache-Control", "no-cache")
		response.Header().Set("Connection", "keep-alive")
		response.Header().Set("X-Accel-Buffering", "no")
		response.WriteHeader(http.StatusOK)
		if flusher, ok := response.(http.Flusher); ok {
			flusher.Flush()
		}
	}
	err := h.runtime.RunTurn(request.Context(), sessionID, message, func(delta agent.Delta) error {
		start()
		typeName := "answer.delta"
		if delta.Type == agent.DeltaReasoning {
			typeName = "reasoning.delta"
		}
		return writeEvent(response, typeName, deltaEvent{Type: typeName, Delta: delta.Delta})
	})
	if request.Context().Err() != nil {
		return
	}
	if err != nil {
		h.logger.Printf("Agent turn failed: %v", err)
		if !started {
			var busy *agent.SessionBusyError
			var notFound *agent.SessionNotFoundError
			switch {
			case errors.As(err, &busy):
				writeJSON(response, http.StatusConflict, map[string]any{"error": err.Error()})
			case errors.As(err, &notFound):
				writeJSON(response, http.StatusNotFound, map[string]any{"error": err.Error()})
			default:
				writeJSON(response, http.StatusBadGateway, map[string]any{"error": "Agent request failed"})
			}
			return
		}
		_ = writeEvent(response, "turn.failed", failedEvent{Type: "turn.failed", Message: "Agent request failed"})
		return
	}
	start()
	_ = writeEvent(response, "turn.completed", completedEvent{Type: "turn.completed"})
}

type deltaEvent struct {
	Type  string `json:"type"`
	Delta string `json:"delta"`
}

type completedEvent struct {
	Type string `json:"type"`
}

type failedEvent struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

type sessionMessage struct {
	Role    agent.Role `json:"role"`
	Content string     `json:"content"`
}

type sessionResponse struct {
	ID        string           `json:"id"`
	CreatedAt string           `json:"createdAt"`
	Messages  []sessionMessage `json:"messages"`
}

func protocolSession(session agent.Session) sessionResponse {
	messages := make([]sessionMessage, len(session.Messages))
	for index, message := range session.Messages {
		messages[index] = sessionMessage{Role: message.Role, Content: message.Content}
	}
	return sessionResponse{
		ID: session.ID, CreatedAt: session.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"), Messages: messages,
	}
}

func writeEvent(response http.ResponseWriter, eventType string, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(response, "event: %s\ndata: %s\n\n", eventType, data); err != nil {
		return err
	}
	if flusher, ok := response.(http.Flusher); ok {
		flusher.Flush()
	}
	return nil
}

func parseCreateBody(body map[string]json.RawMessage) (bool, bool) {
	if len(body) == 0 {
		return false, true
	}
	if len(body) != 1 {
		return false, false
	}
	raw, exists := body["ephemeral"]
	if !exists {
		return false, false
	}
	var ephemeral bool
	if err := json.Unmarshal(raw, &ephemeral); err != nil {
		return false, false
	}
	return ephemeral, true
}

func parseTurnBody(body map[string]json.RawMessage) (string, bool) {
	if len(body) != 1 {
		return "", false
	}
	raw, exists := body["message"]
	if !exists {
		return "", false
	}
	var message string
	if err := json.Unmarshal(raw, &message); err != nil {
		return "", false
	}
	return message, true
}

func readJSONObject(request *http.Request) (map[string]json.RawMessage, error) {
	if request.ContentLength > maxRequestSize {
		return nil, &HTTPError{Status: http.StatusRequestEntityTooLarge, Message: "Request body is too large"}
	}
	body, err := io.ReadAll(io.LimitReader(request.Body, maxRequestSize+1))
	if err != nil {
		return nil, &HTTPError{Status: http.StatusBadRequest, Message: "Could not read request body"}
	}
	if len(body) > maxRequestSize {
		return nil, &HTTPError{Status: http.StatusRequestEntityTooLarge, Message: "Request body is too large"}
	}
	if !utf8.Valid(body) {
		return nil, &HTTPError{Status: http.StatusBadRequest, Message: "Request body must be valid JSON"}
	}
	decoder := json.NewDecoder(strings.NewReader(string(body)))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return nil, &HTTPError{Status: http.StatusBadRequest, Message: "Request body must be valid JSON"}
	}
	value := make(map[string]json.RawMessage)
	for decoder.More() {
		keyToken, err := decoder.Token()
		key, valid := keyToken.(string)
		if err != nil || !valid {
			return nil, &HTTPError{Status: http.StatusBadRequest, Message: "Request body must be valid JSON"}
		}
		if _, duplicate := value[key]; duplicate {
			return nil, &HTTPError{Status: http.StatusBadRequest, Message: "Request body must be valid JSON"}
		}
		var raw json.RawMessage
		if err := decoder.Decode(&raw); err != nil {
			return nil, &HTTPError{Status: http.StatusBadRequest, Message: "Request body must be valid JSON"}
		}
		value[key] = raw
	}
	if token, err = decoder.Token(); err != nil || token != json.Delim('}') {
		return nil, &HTTPError{Status: http.StatusBadRequest, Message: "Request body must be valid JSON"}
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return nil, &HTTPError{Status: http.StatusBadRequest, Message: "Request body must be valid JSON"}
	}
	return value, nil
}

func requireJSON(request *http.Request) error {
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(request.Header.Get("Content-Type"), ";")[0]))
	if contentType != "application/json" {
		return &HTTPError{Status: http.StatusUnsupportedMediaType, Message: "Content-Type must be application/json"}
	}
	return nil
}

func (h *Handler) authorizeOrigin(response http.ResponseWriter, request *http.Request) bool {
	if strings.EqualFold(request.Header.Get("Sec-Fetch-Site"), "cross-site") {
		writeJSON(response, http.StatusForbidden, map[string]any{"error": "Request origin must be local"})
		return false
	}
	origin := request.Header.Get("Origin")
	if origin != "" && !h.isAllowedOrigin(request, origin) {
		writeJSON(response, http.StatusForbidden, map[string]any{"error": "Request origin must be local"})
		return false
	}
	return true
}

func (h *Handler) applyCORS(response http.ResponseWriter, request *http.Request) {
	origin := request.Header.Get("Origin")
	if origin != "" && h.isAllowedOrigin(request, origin) {
		response.Header().Set("Access-Control-Allow-Origin", origin)
		response.Header().Add("Vary", "Origin")
	}
}

func (h *Handler) isAllowedOrigin(request *http.Request, origin string) bool {
	if !IsLoopbackOrigin(origin) {
		return false
	}
	normalized := strings.TrimSuffix(origin, "/")
	if _, allowed := h.allowedOrigins[normalized]; allowed {
		return true
	}
	parsed, err := url.Parse(normalized)
	if err != nil || !strings.EqualFold(parsed.Host, request.Host) {
		return false
	}
	expectedScheme := "http"
	if request.TLS != nil {
		expectedScheme = "https"
	}
	return strings.EqualFold(parsed.Scheme, expectedScheme)
}

func validBearer(header, token string) bool {
	expected := "Bearer " + token
	return len(header) == len(expected) && subtle.ConstantTimeCompare([]byte(header), []byte(expected)) == 1
}

func IsLoopbackOrigin(origin string) bool {
	parsed, err := url.Parse(origin)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil || parsed.Host == "" {
		return false
	}
	return IsLoopbackHost(parsed.Hostname())
}

func IsLoopbackHost(host string) bool {
	if strings.EqualFold(strings.TrimSuffix(host, "."), "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func decodeSegment(value string) (string, error) {
	decoded, err := url.PathUnescape(value)
	if err != nil || !utf8.ValidString(decoded) {
		return "", &HTTPError{Status: http.StatusBadRequest, Message: "Request path contains invalid percent encoding"}
	}
	return decoded, nil
}

func writeRuntimeError(response http.ResponseWriter, err error) error {
	var notFound *agent.SessionNotFoundError
	var busy *agent.SessionBusyError
	var capacity *agent.SessionCapacityError
	switch {
	case errors.As(err, &notFound):
		writeJSON(response, http.StatusNotFound, map[string]any{"error": err.Error()})
	case errors.As(err, &busy):
		writeJSON(response, http.StatusConflict, map[string]any{"error": err.Error()})
	case errors.As(err, &capacity):
		writeJSON(response, http.StatusServiceUnavailable, map[string]any{"error": err.Error()})
	default:
		return err
	}
	return nil
}

func writeJSON(response http.ResponseWriter, status int, body any) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(body)
}

func writeMethodNotAllowed(response http.ResponseWriter, methods ...string) {
	response.Header().Set("Allow", strings.Join(methods, ", "))
	writeJSON(response, http.StatusMethodNotAllowed, map[string]any{"error": "Method not allowed"})
}

type HTTPError struct {
	Status  int
	Message string
}

func (e *HTTPError) Error() string { return e.Message }

func (h *Handler) serveWeb(response http.ResponseWriter, request *http.Request) error {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		writeMethodNotAllowed(response, http.MethodGet, http.MethodHead)
		return nil
	}
	if h.webRoot == "" {
		writeJSON(response, http.StatusNotFound, map[string]any{"error": "Web application is not available in development server mode"})
		return nil
	}
	decoded, err := url.PathUnescape(request.URL.EscapedPath())
	if err != nil {
		return &HTTPError{Status: http.StatusBadRequest, Message: "Request path contains invalid percent encoding"}
	}
	root, err := filepath.Abs(h.webRoot)
	if err != nil {
		return err
	}
	relative := strings.TrimLeft(filepath.Clean(filepath.FromSlash(decoded)), string(filepath.Separator))
	if relative == "." || relative == "" {
		relative = "index.html"
	}
	candidate := filepath.Join(root, relative)
	if !pathWithin(root, candidate) || !regularFileWithin(root, candidate) {
		candidate = filepath.Join(root, "index.html")
		if !regularFileWithin(root, candidate) {
			writeJSON(response, http.StatusNotFound, map[string]any{"error": "Web application has not been built"})
			return nil
		}
	}
	file, err := os.Open(candidate)
	if err != nil {
		writeJSON(response, http.StatusNotFound, map[string]any{"error": "Web application has not been built"})
		return nil
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		writeJSON(response, http.StatusNotFound, map[string]any{"error": "Web application has not been built"})
		return nil
	}
	response.Header().Set("Content-Type", contentType(candidate))
	response.Header().Set("Content-Security-Policy", contentSecurityPolicy)
	response.Header().Set("Content-Length", fmt.Sprintf("%d", info.Size()))
	response.WriteHeader(http.StatusOK)
	if request.Method == http.MethodGet {
		_, _ = io.Copy(response, file)
	}
	return nil
}

func pathWithin(root, candidate string) bool {
	relative, err := filepath.Rel(root, candidate)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func regularFileWithin(root, candidate string) bool {
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return false
	}
	resolvedCandidate, err := filepath.EvalSymlinks(candidate)
	if err != nil || !pathWithin(resolvedRoot, resolvedCandidate) {
		return false
	}
	info, err := os.Stat(resolvedCandidate)
	return err == nil && info.Mode().IsRegular()
}

func contentType(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".css":
		return "text/css; charset=utf-8"
	case ".html":
		return "text/html; charset=utf-8"
	case ".js":
		return "text/javascript; charset=utf-8"
	case ".json":
		return "application/json; charset=utf-8"
	case ".svg":
		return "image/svg+xml"
	default:
		if value := mime.TypeByExtension(filepath.Ext(path)); value != "" {
			return value
		}
		return "application/octet-stream"
	}
}

type ephemeralTracker struct {
	runtime *agent.Runtime
	ttl     time.Duration
	logger  *log.Logger
	mu      sync.Mutex
	timers  map[string]*time.Timer
	closed  bool
}

func newEphemeralTracker(runtime *agent.Runtime, ttl time.Duration, logger *log.Logger) *ephemeralTracker {
	return &ephemeralTracker{runtime: runtime, ttl: ttl, logger: logger, timers: make(map[string]*time.Timer)}
}

func (t *ephemeralTracker) mark(id string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return
	}
	if timer := t.timers[id]; timer != nil {
		timer.Stop()
	}
	t.timers[id] = time.AfterFunc(t.ttl, func() { t.delete(id) })
}

func (t *ephemeralTracker) claim(id string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	timer, exists := t.timers[id]
	if exists {
		timer.Stop()
		delete(t.timers, id)
	}
	return exists
}

func (t *ephemeralTracker) forget(id string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if timer := t.timers[id]; timer != nil {
		timer.Stop()
		delete(t.timers, id)
	}
}

func (t *ephemeralTracker) delete(id string) {
	t.forget(id)
	err := t.runtime.DeleteSession(context.Background(), id)
	var busy *agent.SessionBusyError
	var notFound *agent.SessionNotFoundError
	switch {
	case err == nil, errors.As(err, &notFound):
		return
	case errors.As(err, &busy):
		t.mu.Lock()
		if !t.closed {
			t.timers[id] = time.AfterFunc(time.Second, func() { t.delete(id) })
		}
		t.mu.Unlock()
	default:
		t.logger.Printf("Could not clean up ephemeral session %s: %v", id, err)
	}
}

func (t *ephemeralTracker) close() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.closed = true
	for id, timer := range t.timers {
		timer.Stop()
		delete(t.timers, id)
	}
}
