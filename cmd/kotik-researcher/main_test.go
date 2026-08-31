package main

import "testing"

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
