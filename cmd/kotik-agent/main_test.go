package main

import (
	"strings"
	"testing"
)

func TestParseCLIAndLoopbackValidation(t *testing.T) {
	options, err := ParseCLI([]string{
		"--addr=localhost:0", "--web-root=/tmp/web", "--open=false", "--token-stdin",
		"--allowed-origin=http://127.0.0.1:5173",
	})
	if err != nil {
		t.Fatal(err)
	}
	if options.Addr != "localhost:0" || options.WebRoot != "/tmp/web" || options.Open || !options.TokenStdin {
		t.Fatalf("options = %#v", options)
	}
	if len(options.AllowedOrigins) != 1 || options.AllowedOrigins[0] != "http://127.0.0.1:5173" {
		t.Fatalf("allowed origins = %#v", options.AllowedOrigins)
	}
	if _, err := ParseCLI([]string{"--addr=0.0.0.0:8080"}); err == nil {
		t.Fatal("non-loopback address was accepted")
	}
	if err := ValidateLoopbackAddress("[::1]:8080"); err != nil {
		t.Fatal(err)
	}
	if _, err := ParseCLI([]string{"--allowed-origin=https://example.com"}); err == nil {
		t.Fatal("remote allowed origin was accepted")
	}
}

func TestAPIKeyAndTokenInput(t *testing.T) {
	key, err := DeepSeekAPIKey(func(name string) string { return "  key  " })
	if err != nil || key != "key" {
		t.Fatalf("key = %q, error = %v", key, err)
	}
	if _, err := DeepSeekAPIKey(func(string) string { return " " }); err == nil {
		t.Fatal("empty API key was accepted")
	}
	token, err := ReadAccessToken(strings.NewReader("desktop-token\r\nignored"))
	if err != nil || token != "desktop-token" {
		t.Fatalf("token = %q, error = %v", token, err)
	}
	if _, err := ReadAccessToken(strings.NewReader("unterminated")); err == nil {
		t.Fatal("unterminated token was accepted")
	}
	if _, err := ReadAccessToken(strings.NewReader(strings.Repeat("x", (4<<10)+1) + "\n")); err == nil {
		t.Fatal("oversized token was accepted")
	}
}
