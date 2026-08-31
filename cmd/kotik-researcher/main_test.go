package main

import (
	"strings"
	"testing"
)

func TestValidateLoopbackAddress(t *testing.T) {
	tests := []struct {
		name    string
		address string
		wantErr bool
	}{
		{name: "IPv4", address: "127.0.0.1:8080"},
		{name: "IPv6", address: "[::1]:8080"},
		{name: "localhost", address: "localhost:8080"},
		{name: "all IPv4 interfaces", address: "0.0.0.0:8080", wantErr: true},
		{name: "all IPv6 interfaces", address: "[::]:8080", wantErr: true},
		{name: "missing port", address: "127.0.0.1", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateLoopbackAddress(test.address)
			if (err != nil) != test.wantErr {
				t.Fatalf("validateLoopbackAddress(%q) error = %v, wantErr %v", test.address, err, test.wantErr)
			}
		})
	}
}

func TestDeepSeekAPIKey(t *testing.T) {
	t.Run("missing", func(t *testing.T) {
		t.Setenv("DEEPSEEK_API_KEY", "")
		_, err := deepSeekAPIKey()
		if err == nil || !strings.Contains(err.Error(), "DEEPSEEK_API_KEY") {
			t.Fatalf("error = %v, want missing key error", err)
		}
	})

	t.Run("available", func(t *testing.T) {
		t.Setenv("DEEPSEEK_API_KEY", "  test-key  ")
		key, err := deepSeekAPIKey()
		if err != nil {
			t.Fatalf("deepSeekAPIKey() error = %v", err)
		}
		if key != "test-key" {
			t.Fatalf("key = %q, want test-key", key)
		}
	})
}
