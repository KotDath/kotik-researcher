package httpapi

import (
	"encoding/json"
	"net/http"
)

// New returns the application HTTP handler with API and web routes isolated.
func New(web http.Handler) http.Handler {
	api := http.NewServeMux()
	api.HandleFunc("GET /health", health)

	root := http.NewServeMux()
	root.Handle("/api/", http.StripPrefix("/api", api))
	root.Handle("/", web)

	return root
}

func health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
