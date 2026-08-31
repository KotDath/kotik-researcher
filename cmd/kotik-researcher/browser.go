package main

import (
	"fmt"
	"os/exec"
	"runtime"
)

func openBrowser(applicationURL string) error {
	var command string
	var arguments []string

	switch runtime.GOOS {
	case "darwin":
		command = "open"
		arguments = []string{applicationURL}
	case "linux":
		command = "xdg-open"
		arguments = []string{applicationURL}
	case "windows":
		command = "rundll32"
		arguments = []string{"url.dll,FileProtocolHandler", applicationURL}
	default:
		return fmt.Errorf("opening a browser is not supported on %s", runtime.GOOS)
	}

	process := exec.Command(command, arguments...)
	if err := process.Start(); err != nil {
		return fmt.Errorf("start %s: %w", command, err)
	}
	go func() {
		_ = process.Wait()
	}()
	return nil
}
