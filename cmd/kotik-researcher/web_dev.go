//go:build !production

package main

import "net/http"

func newWebHandler() http.Handler {
	return http.NotFoundHandler()
}
