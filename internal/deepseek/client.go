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
)

const (
	defaultEndpoint = "https://api.deepseek.com/chat/completions"
	defaultModel    = "deepseek-v4-flash"
	maxErrorBody    = 1 << 20
	maxStreamLine   = 1 << 20
)

type DeltaKind string

const (
	DeltaReasoning DeltaKind = "reasoning"
	DeltaAnswer    DeltaKind = "answer"
)

type Delta struct {
	Kind DeltaKind
	Text string
}

type Client struct {
	apiKey     string
	endpoint   string
	httpClient *http.Client
}

type APIError struct {
	StatusCode int
	Message    string
}

func (e *APIError) Error() string {
	if e.Message == "" {
		return fmt.Sprintf("DeepSeek API returned status %d", e.StatusCode)
	}
	return fmt.Sprintf("DeepSeek API returned status %d: %s", e.StatusCode, e.Message)
}

func New(apiKey string) *Client {
	return &Client{
		apiKey:   apiKey,
		endpoint: defaultEndpoint,
		httpClient: &http.Client{
			Timeout: 5 * time.Minute,
		},
	}
}

func (c *Client) Stream(ctx context.Context, question string, emit func(Delta) error) error {
	body, err := json.Marshal(chatRequest{
		Model: defaultModel,
		Messages: []message{
			{Role: "user", Content: question},
		},
		Thinking:        thinking{Type: "enabled"},
		ReasoningEffort: "high",
		MaxTokens:       4096,
		Stream:          true,
	})
	if err != nil {
		return fmt.Errorf("encode DeepSeek request: %w", err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create DeepSeek request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+c.apiKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "text/event-stream")

	response, err := c.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("send DeepSeek request: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return decodeAPIError(response)
	}

	return consumeStream(response.Body, emit)
}

func consumeStream(reader io.Reader, emit func(Delta) error) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 4096), maxStreamLine)
	finishReason := ""
	receivedAnswer := false

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || !strings.HasPrefix(line, "data:") {
			continue
		}

		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			if finishReason != "stop" {
				if finishReason == "" {
					return errors.New("DeepSeek stream ended without a finish reason")
				}
				return fmt.Errorf("DeepSeek completion stopped with reason %q", finishReason)
			}
			if !receivedAnswer {
				return errors.New("DeepSeek completion did not contain a final answer")
			}
			return nil
		}

		var chunk streamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			return fmt.Errorf("decode DeepSeek stream chunk: %w", err)
		}
		for _, choice := range chunk.Choices {
			if choice.FinishReason != "" {
				finishReason = choice.FinishReason
			}
			if choice.Delta.ReasoningContent != "" {
				if err := emit(Delta{Kind: DeltaReasoning, Text: choice.Delta.ReasoningContent}); err != nil {
					return err
				}
			}
			if choice.Delta.Content != "" {
				receivedAnswer = true
				if err := emit(Delta{Kind: DeltaAnswer, Text: choice.Delta.Content}); err != nil {
					return err
				}
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read DeepSeek stream: %w", err)
	}
	return errors.New("DeepSeek stream ended before [DONE]")
}

func decodeAPIError(response *http.Response) error {
	body, err := io.ReadAll(io.LimitReader(response.Body, maxErrorBody))
	if err != nil {
		return fmt.Errorf("read DeepSeek error response: %w", err)
	}

	var payload struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = json.Unmarshal(body, &payload)

	return &APIError{StatusCode: response.StatusCode, Message: payload.Error.Message}
}

type chatRequest struct {
	Model           string    `json:"model"`
	Messages        []message `json:"messages"`
	Thinking        thinking  `json:"thinking"`
	ReasoningEffort string    `json:"reasoning_effort"`
	MaxTokens       int       `json:"max_tokens"`
	Stream          bool      `json:"stream"`
}

type message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type thinking struct {
	Type string `json:"type"`
}

type streamChunk struct {
	Choices []struct {
		FinishReason string `json:"finish_reason"`
		Delta        struct {
			ReasoningContent string `json:"reasoning_content"`
			Content          string `json:"content"`
		} `json:"delta"`
	} `json:"choices"`
}
