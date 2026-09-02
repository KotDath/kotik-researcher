package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/KotDath/kotik-researcher/internal/agent"
	"github.com/KotDath/kotik-researcher/internal/deepseek"
	"github.com/KotDath/kotik-researcher/internal/gateway"
)

type CLIOptions struct {
	Addr           string
	WebRoot        string
	Open           bool
	TokenStdin     bool
	AllowedOrigins stringListFlag
}

type stringListFlag []string

func (values *stringListFlag) String() string { return strings.Join(*values, ",") }
func (values *stringListFlag) Set(value string) error {
	if !gateway.IsLoopbackOrigin(value) {
		return fmt.Errorf("allowed origin %q must be an HTTP(S) loopback origin", value)
	}
	*values = append(*values, strings.TrimSuffix(value, "/"))
	return nil
}

func ParseCLI(arguments []string) (CLIOptions, error) {
	options := CLIOptions{Addr: "127.0.0.1:8080", Open: true}
	flags := flag.NewFlagSet("kotik-agent", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&options.Addr, "addr", options.Addr, "loopback listen address")
	flags.StringVar(&options.WebRoot, "web-root", "", "optional React build directory")
	flags.BoolVar(&options.Open, "open", true, "open the application in a browser")
	flags.BoolVar(&options.TokenStdin, "token-stdin", false, "read the gateway access token from stdin")
	flags.Var(&options.AllowedOrigins, "allowed-origin", "additional loopback browser origin (repeatable)")
	if err := flags.Parse(arguments); err != nil {
		return CLIOptions{}, err
	}
	if flags.NArg() != 0 {
		return CLIOptions{}, fmt.Errorf("unexpected argument: %s", flags.Arg(0))
	}
	if err := ValidateLoopbackAddress(options.Addr); err != nil {
		return CLIOptions{}, err
	}
	return options, nil
}

func ValidateLoopbackAddress(address string) error {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("invalid listen address %q: %w", address, err)
	}
	if !gateway.IsLoopbackHost(host) {
		return fmt.Errorf("listen address %q must use a loopback host", address)
	}
	if port == "" {
		return fmt.Errorf("listen address %q must include a port", address)
	}
	if _, err := net.LookupPort("tcp", port); err != nil {
		return fmt.Errorf("invalid listen port %q", port)
	}
	return nil
}

func DeepSeekAPIKey(environment func(string) string) (string, error) {
	apiKey := strings.TrimSpace(environment("DEEPSEEK_API_KEY"))
	if apiKey == "" {
		return "", errors.New("DEEPSEEK_API_KEY is not set")
	}
	return apiKey, nil
}

func ReadAccessToken(input io.Reader) (string, error) {
	const maxAccessTokenSize = 4 << 10
	reader := bufio.NewReaderSize(io.LimitReader(input, maxAccessTokenSize+2), maxAccessTokenSize+2)
	line, err := reader.ReadString('\n')
	if err != nil {
		if errors.Is(err, io.EOF) {
			return "", errors.New("access token must be terminated by a newline")
		}
		return "", fmt.Errorf("read access token: %w", err)
	}
	token := strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r")
	if len(token) > maxAccessTokenSize {
		return "", errors.New("access token is too large")
	}
	if token == "" {
		return "", errors.New("access token must not be empty")
	}
	return token, nil
}

type runEnvironment struct {
	stdin   io.Reader
	stdout  io.Writer
	stderr  io.Writer
	getenv  func(string) string
	openURL func(string) error
}

func run(ctx context.Context, options CLIOptions, environment runEnvironment) error {
	apiKey, err := DeepSeekAPIKey(environment.getenv)
	if err != nil {
		return err
	}
	accessToken := ""
	if options.TokenStdin {
		accessToken, err = ReadAccessToken(environment.stdin)
		if err != nil {
			return err
		}
	}

	provider := deepseek.NewProvider(deepseek.Options{APIKey: apiKey})
	repository := agent.NewInMemorySessionRepository()
	agentRuntime := agent.NewRuntime(provider, repository)
	logger := log.New(environment.stderr, "kotik-agent: ", log.LstdFlags)
	handler := gateway.NewHandler(gateway.Options{
		Runtime: agentRuntime, WebRoot: options.WebRoot, AccessToken: accessToken,
		AllowedOrigins: options.AllowedOrigins, Logger: logger,
	})
	defer handler.Close()
	listener, err := net.Listen("tcp", options.Addr)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", options.Addr, err)
	}
	server := gateway.NewHTTPServer(options.Addr, handler)
	server.BaseContext = func(net.Listener) context.Context { return ctx }
	serveErrors := make(chan error, 1)
	go func() {
		err := server.Serve(listener)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErrors <- err
			return
		}
		serveErrors <- nil
	}()

	url := listenerURL(listener.Addr())
	if err := json.NewEncoder(environment.stdout).Encode(map[string]any{"type": "ready", "url": url}); err != nil {
		_ = server.Close()
		return fmt.Errorf("write readiness message: %w", err)
	}
	if options.Open {
		go func() {
			if err := environment.openURL(url); err != nil {
				logger.Printf("Could not open the browser: %v", err)
			}
		}()
	}

	select {
	case err := <-serveErrors:
		return err
	case <-ctx.Done():
		shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownContext); err != nil {
			_ = server.Close()
			return fmt.Errorf("shut down server: %w", err)
		}
		return <-serveErrors
	}
}

func listenerURL(address net.Addr) string {
	host, port, err := net.SplitHostPort(address.String())
	if err != nil {
		return "http://" + address.String()
	}
	return "http://" + net.JoinHostPort(host, port)
}

func OpenBrowser(url string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		command = exec.Command("open", url)
	case "windows":
		command = exec.Command("cmd", "/c", "start", "", url)
	default:
		command = exec.Command("xdg-open", url)
	}
	return command.Run()
}

func main() {
	options, err := ParseCLI(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	err = run(ctx, options, runEnvironment{
		stdin: os.Stdin, stdout: os.Stdout, stderr: os.Stderr, getenv: os.Getenv, openURL: OpenBrowser,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
