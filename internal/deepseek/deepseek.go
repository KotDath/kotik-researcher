package deepseek

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/KotDath/kotik-researcher/internal/agent"
)

const (
	DefaultEndpoint = "https://api.deepseek.com/chat/completions"
	DefaultModel    = "deepseek-v4-flash"
	maxBodySize     = 1 << 20
)

type Options struct {
	APIKey     string
	Endpoint   string
	HTTPClient *http.Client
	Timeout    time.Duration
}

type Provider struct {
	apiKey     string
	endpoint   string
	httpClient *http.Client
	timeout    time.Duration
}

func NewProvider(options Options) *Provider {
	endpoint := options.Endpoint
	if endpoint == "" {
		endpoint = DefaultEndpoint
	}
	client := options.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	timeout := options.Timeout
	if timeout == 0 {
		timeout = 5 * time.Minute
	}
	return &Provider{apiKey: options.APIKey, endpoint: endpoint, httpClient: client, timeout: timeout}
}

type APIError struct {
	StatusCode int
	APIMessage string
}

func (e *APIError) Error() string {
	if e.APIMessage != "" {
		return fmt.Sprintf("DeepSeek API returned status %d: %s", e.StatusCode, e.APIMessage)
	}
	return fmt.Sprintf("DeepSeek API returned status %d", e.StatusCode)
}

func (p *Provider) Stream(ctx context.Context, messages []agent.Message, emit func(agent.Delta) error) error {
	ctx, cancel := context.WithTimeout(ctx, p.timeout)
	defer cancel()
	payload := struct {
		Model    string          `json:"model"`
		Messages []agent.Message `json:"messages"`
		Thinking struct {
			Type string `json:"type"`
		} `json:"thinking"`
		ReasoningEffort string `json:"reasoning_effort"`
		MaxTokens       int    `json:"max_tokens"`
		Stream          bool   `json:"stream"`
	}{
		Model: DefaultModel, Messages: messages, ReasoningEffort: "high", MaxTokens: 4096, Stream: true,
	}
	payload.Thinking.Type = "enabled"
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode DeepSeek request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create DeepSeek request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+p.apiKey)
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Content-Type", "application/json")

	response, err := p.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return decodeAPIError(response)
	}
	if response.Body == nil {
		return errors.New("DeepSeek API returned an empty response body")
	}

	finishReason := ""
	receivedAnswer := false
	receivedDone := false
	err = readSSE(response.Body, func(data string) error {
		if data == "[DONE]" {
			receivedDone = true
			return errDone
		}
		choices, err := parseChunk(data)
		if err != nil {
			return err
		}
		for _, choice := range choices {
			if choice.FinishReason != "" {
				finishReason = choice.FinishReason
			}
			if choice.Reasoning != "" {
				if err := emit(agent.Delta{Type: agent.DeltaReasoning, Delta: choice.Reasoning}); err != nil {
					return err
				}
			}
			if choice.Answer != "" {
				receivedAnswer = true
				if err := emit(agent.Delta{Type: agent.DeltaAnswer, Delta: choice.Answer}); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil && !errors.Is(err, errDone) {
		return err
	}
	if !receivedDone {
		return errors.New("DeepSeek stream ended before [DONE]")
	}
	if finishReason != "stop" {
		if finishReason == "" {
			return errors.New("DeepSeek stream ended without a finish reason")
		}
		quoted, _ := json.Marshal(finishReason)
		return fmt.Errorf("DeepSeek completion stopped with reason %s", quoted)
	}
	if !receivedAnswer {
		return errors.New("DeepSeek completion did not contain a final answer")
	}
	return nil
}

var errDone = errors.New("SSE done")

type streamChoice struct {
	FinishReason string
	Reasoning    string
	Answer       string
}

func parseChunk(data string) ([]streamChoice, error) {
	var value any
	if err := json.Unmarshal([]byte(data), &value); err != nil {
		return nil, fmt.Errorf("Could not decode DeepSeek stream chunk: %w", err)
	}
	object, valid := value.(map[string]any)
	if !valid {
		return nil, errors.New("DeepSeek stream chunk has an invalid shape")
	}
	rawChoices, valid := object["choices"].([]any)
	if !valid {
		return nil, errors.New("DeepSeek stream chunk has an invalid shape")
	}
	choices := make([]streamChoice, 0, len(rawChoices))
	for _, rawChoice := range rawChoices {
		choiceObject, valid := rawChoice.(map[string]any)
		if !valid {
			return nil, errors.New("DeepSeek stream chunk has an invalid shape")
		}
		choice := streamChoice{}
		choice.FinishReason, _ = choiceObject["finish_reason"].(string)
		if deltaObject, ok := choiceObject["delta"].(map[string]any); ok {
			choice.Reasoning, _ = deltaObject["reasoning_content"].(string)
			choice.Answer, _ = deltaObject["content"].(string)
		}
		choices = append(choices, choice)
	}
	return choices, nil
}

func readSSE(reader io.Reader, dispatch func(string) error) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), maxBodySize+1)
	dataLines := make([]string, 0, 1)
	eventSize := 0
	dispatchEvent := func() error {
		if len(dataLines) == 0 {
			eventSize = 0
			return nil
		}
		data := strings.Join(dataLines, "\n")
		dataLines = dataLines[:0]
		eventSize = 0
		return dispatch(data)
	}
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		eventSize += len(line) + 1
		if eventSize > maxBodySize {
			return errors.New("DeepSeek stream event exceeded the size limit")
		}
		if line == "" {
			if err := dispatchEvent(); err != nil {
				return err
			}
			continue
		}
		if strings.HasPrefix(line, "data:") {
			dataLines = append(dataLines, strings.TrimLeft(line[5:], " \t"))
		}
	}
	if err := scanner.Err(); err != nil {
		if errors.Is(err, bufio.ErrTooLong) || strings.Contains(err.Error(), "token too long") {
			return errors.New("DeepSeek stream event exceeded the size limit")
		}
		return err
	}
	return dispatchEvent()
}

func decodeAPIError(response *http.Response) error {
	limited := io.LimitReader(response.Body, maxBodySize+1)
	body, err := io.ReadAll(limited)
	if err != nil || len(body) > maxBodySize {
		return &APIError{StatusCode: response.StatusCode}
	}
	var value struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &value) != nil {
		return &APIError{StatusCode: response.StatusCode}
	}
	return &APIError{StatusCode: response.StatusCode, APIMessage: value.Error.Message}
}
