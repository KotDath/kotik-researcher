package agent

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type providerFunc func(context.Context, []Message, func(Delta) error) error

func (f providerFunc) Stream(ctx context.Context, messages []Message, emit func(Delta) error) error {
	return f(ctx, messages, emit)
}

func TestRuntimePersistsAnswerAndSuppliesHistory(t *testing.T) {
	var received [][]Message
	provider := providerFunc(func(_ context.Context, messages []Message, emit func(Delta) error) error {
		received = append(received, cloneMessages(messages))
		if err := emit(Delta{Type: DeltaReasoning, Delta: "private thought"}); err != nil {
			return err
		}
		return emit(Delta{Type: DeltaAnswer, Delta: "answer"})
	})
	runtime := NewRuntime(provider, NewInMemorySessionRepository(), RuntimeOptions{
		IDFactory: func() string { return "session-1" },
		Now:       func() time.Time { return time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC) },
	})
	session, err := runtime.CreateSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := runtime.RunTurn(context.Background(), session.ID, "question", nil); err != nil {
		t.Fatal(err)
	}
	stored, err := runtime.GetSession(context.Background(), session.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := []Message{{Role: RoleUser, Content: "question"}, {Role: RoleAssistant, Content: "answer"}}
	if len(stored.Messages) != len(want) || stored.Messages[0] != want[0] || stored.Messages[1] != want[1] {
		t.Fatalf("stored messages = %#v, want %#v", stored.Messages, want)
	}
	if len(received) != 1 || len(received[0]) != 1 || received[0][0] != want[0] {
		t.Fatalf("provider messages = %#v", received)
	}
}

func TestRuntimeRejectsConcurrentTurnAndCancels(t *testing.T) {
	started := make(chan struct{})
	provider := providerFunc(func(ctx context.Context, _ []Message, _ func(Delta) error) error {
		close(started)
		<-ctx.Done()
		return ctx.Err()
	})
	runtime := NewRuntime(provider, NewInMemorySessionRepository(), RuntimeOptions{IDFactory: func() string { return "s" }})
	if _, err := runtime.CreateSession(context.Background()); err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() { result <- runtime.RunTurn(context.Background(), "s", "first", nil) }()
	<-started
	err := runtime.RunTurn(context.Background(), "s", "second", nil)
	var busy *SessionBusyError
	if !errors.As(err, &busy) {
		t.Fatalf("concurrent turn error = %v", err)
	}
	if !runtime.CancelTurn("s") {
		t.Fatal("CancelTurn returned false for active turn")
	}
	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled turn error = %v", err)
	}
	if runtime.CancelTurn("s") {
		t.Fatal("CancelTurn returned true after turn ended")
	}
	stored, err := runtime.GetSession(context.Background(), "s")
	if err != nil || len(stored.Messages) != 0 {
		t.Fatalf("cancelled turn history = %#v, error = %v", stored.Messages, err)
	}
}

func TestRuntimeSerializesStartupAndDeletion(t *testing.T) {
	repository := &delayedRepository{InMemorySessionRepository: NewInMemorySessionRepository()}
	runtime := NewRuntime(providerFunc(func(_ context.Context, _ []Message, emit func(Delta) error) error {
		return emit(Delta{Type: DeltaAnswer, Delta: "answer"})
	}), repository, RuntimeOptions{IDFactory: func() string { return "s" }})
	if _, err := runtime.CreateSession(context.Background()); err != nil {
		t.Fatal(err)
	}
	repository.delay = true
	repository.started = make(chan struct{})
	repository.release = make(chan struct{})
	result := make(chan error, 1)
	go func() { result <- runtime.RunTurn(context.Background(), "s", "question", nil) }()
	<-repository.started
	err := runtime.DeleteSession(context.Background(), "s")
	var busy *SessionBusyError
	if !errors.As(err, &busy) {
		t.Fatalf("delete error = %v", err)
	}
	close(repository.release)
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	if err := runtime.DeleteSession(context.Background(), "s"); err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.GetSession(context.Background(), "s"); err == nil {
		t.Fatal("deleted session was found")
	}
}

func TestRepositoryCapacityAndCloning(t *testing.T) {
	repository := NewInMemorySessionRepository(1)
	session := Session{ID: "one", Messages: []Message{{Role: RoleUser, Content: "original"}}}
	if err := repository.Create(context.Background(), session); err != nil {
		t.Fatal(err)
	}
	session.Messages[0].Content = "mutated"
	stored, _, _ := repository.Get(context.Background(), "one")
	if stored.Messages[0].Content != "original" {
		t.Fatal("repository did not clone created session")
	}
	err := repository.Create(context.Background(), Session{ID: "two"})
	var capacity *SessionCapacityError
	if !errors.As(err, &capacity) {
		t.Fatalf("capacity error = %v", err)
	}
}

type delayedRepository struct {
	*InMemorySessionRepository
	mu      sync.Mutex
	delay   bool
	started chan struct{}
	release chan struct{}
}

func (r *delayedRepository) Get(ctx context.Context, id string) (Session, bool, error) {
	r.mu.Lock()
	if r.delay {
		r.delay = false
		started, release := r.started, r.release
		r.mu.Unlock()
		close(started)
		select {
		case <-release:
		case <-ctx.Done():
			return Session{}, false, ctx.Err()
		}
		return r.InMemorySessionRepository.Get(ctx, id)
	}
	r.mu.Unlock()
	return r.InMemorySessionRepository.Get(ctx, id)
}
