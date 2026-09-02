package agent

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"
)

type Role string

const (
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
)

type Message struct {
	Role    Role   `json:"role"`
	Content string `json:"content"`
}

type DeltaType string

const (
	DeltaReasoning DeltaType = "reasoning"
	DeltaAnswer    DeltaType = "answer"
)

type Delta struct {
	Type  DeltaType
	Delta string
}

// ModelProvider emits completion deltas to emit, stopping when emit or ctx returns an error.
type ModelProvider interface {
	Stream(ctx context.Context, messages []Message, emit func(Delta) error) error
}

type Session struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"-"`
	Messages  []Message `json:"messages"`
}

type SessionRepository interface {
	Create(ctx context.Context, session Session) error
	Get(ctx context.Context, id string) (Session, bool, error)
	Save(ctx context.Context, session Session) error
	Delete(ctx context.Context, id string) error
}

type SessionNotFoundError struct{ ID string }

func (e *SessionNotFoundError) Error() string { return fmt.Sprintf("Session %s was not found", e.ID) }

type SessionBusyError struct{ ID string }

func (e *SessionBusyError) Error() string {
	return fmt.Sprintf("Session %s already has an active turn", e.ID)
}

type SessionCapacityError struct{ Limit int }

func (e *SessionCapacityError) Error() string {
	return fmt.Sprintf("Session capacity of %d has been reached", e.Limit)
}

type InMemorySessionRepository struct {
	mu          sync.RWMutex
	sessions    map[string]Session
	maxSessions int
}

func NewInMemorySessionRepository(maxSessions ...int) *InMemorySessionRepository {
	limit := 1000
	if len(maxSessions) > 0 {
		limit = maxSessions[0]
	}
	if limit < 1 {
		panic("maxSessions must be a positive integer")
	}
	return &InMemorySessionRepository{sessions: make(map[string]Session), maxSessions: limit}
}

func (r *InMemorySessionRepository) Create(ctx context.Context, session Session) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if _, exists := r.sessions[session.ID]; exists {
		return fmt.Errorf("session %s already exists", session.ID)
	}
	if len(r.sessions) >= r.maxSessions {
		return &SessionCapacityError{Limit: r.maxSessions}
	}
	r.sessions[session.ID] = cloneSession(session)
	return nil
}

func (r *InMemorySessionRepository) Get(ctx context.Context, id string) (Session, bool, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if err := ctx.Err(); err != nil {
		return Session{}, false, err
	}
	session, exists := r.sessions[id]
	if !exists {
		return Session{}, false, nil
	}
	return cloneSession(session), true, nil
}

func (r *InMemorySessionRepository) Save(ctx context.Context, session Session) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if _, exists := r.sessions[session.ID]; !exists {
		return &SessionNotFoundError{ID: session.ID}
	}
	r.sessions[session.ID] = cloneSession(session)
	return nil
}

func (r *InMemorySessionRepository) Delete(ctx context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	delete(r.sessions, id)
	return nil
}

type RuntimeOptions struct {
	IDFactory func() string
	Now       func() time.Time
}

type operation struct {
	cancel   context.CancelFunc
	deleting bool
}

type Runtime struct {
	provider  ModelProvider
	sessions  SessionRepository
	idFactory func() string
	now       func() time.Time

	mu         sync.Mutex
	operations map[string]operation
}

func NewRuntime(provider ModelProvider, sessions SessionRepository, options ...RuntimeOptions) *Runtime {
	if provider == nil || sessions == nil {
		panic("provider and sessions are required")
	}
	var option RuntimeOptions
	if len(options) > 0 {
		option = options[0]
	}
	if option.IDFactory == nil {
		option.IDFactory = randomID
	}
	if option.Now == nil {
		option.Now = time.Now
	}
	return &Runtime{
		provider: provider, sessions: sessions, idFactory: option.IDFactory, now: option.Now,
		operations: make(map[string]operation),
	}
}

func (r *Runtime) CreateSession(ctx context.Context) (Session, error) {
	session := Session{ID: r.idFactory(), CreatedAt: r.now().UTC(), Messages: []Message{}}
	if session.ID == "" {
		return Session{}, errors.New("session ID factory returned an empty ID")
	}
	if err := r.sessions.Create(ctx, session); err != nil {
		return Session{}, err
	}
	return cloneSession(session), nil
}

func (r *Runtime) GetSession(ctx context.Context, id string) (Session, error) {
	session, exists, err := r.sessions.Get(ctx, id)
	if err != nil {
		return Session{}, err
	}
	if !exists {
		return Session{}, &SessionNotFoundError{ID: id}
	}
	return cloneSession(session), nil
}

func (r *Runtime) DeleteSession(ctx context.Context, id string) error {
	r.mu.Lock()
	if _, busy := r.operations[id]; busy {
		r.mu.Unlock()
		return &SessionBusyError{ID: id}
	}
	r.operations[id] = operation{deleting: true}
	r.mu.Unlock()
	defer r.finishOperation(id)

	if _, err := r.GetSession(ctx, id); err != nil {
		return err
	}
	return r.sessions.Delete(ctx, id)
}

func (r *Runtime) RunTurn(
	ctx context.Context,
	sessionID string,
	message string,
	emit func(Delta) error,
) error {
	turnCtx, cancel := context.WithCancel(ctx)
	r.mu.Lock()
	if _, busy := r.operations[sessionID]; busy {
		r.mu.Unlock()
		cancel()
		return &SessionBusyError{ID: sessionID}
	}
	r.operations[sessionID] = operation{cancel: cancel}
	r.mu.Unlock()
	defer func() {
		cancel()
		r.finishOperation(sessionID)
	}()

	session, err := r.GetSession(turnCtx, sessionID)
	if err != nil {
		return err
	}
	if err := turnCtx.Err(); err != nil {
		return err
	}

	input := Message{Role: RoleUser, Content: message}
	messages := append(cloneMessages(session.Messages), input)
	answer := ""
	err = r.provider.Stream(turnCtx, messages, func(delta Delta) error {
		if err := turnCtx.Err(); err != nil {
			return err
		}
		if delta.Type == DeltaAnswer {
			answer += delta.Delta
		}
		if emit == nil {
			return nil
		}
		return emit(delta)
	})
	if err != nil {
		return err
	}
	if err := turnCtx.Err(); err != nil {
		return err
	}
	if answer == "" {
		return errors.New("Model completion did not contain a final answer")
	}
	session.Messages = append(session.Messages, input, Message{Role: RoleAssistant, Content: answer})
	return r.sessions.Save(turnCtx, session)
}

func (r *Runtime) CancelTurn(sessionID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	op, exists := r.operations[sessionID]
	if !exists || op.deleting || op.cancel == nil {
		return false
	}
	op.cancel()
	return true
}

func (r *Runtime) finishOperation(id string) {
	r.mu.Lock()
	delete(r.operations, id)
	r.mu.Unlock()
}

func cloneMessages(messages []Message) []Message {
	return append([]Message(nil), messages...)
}

func cloneSession(session Session) Session {
	session.Messages = cloneMessages(session.Messages)
	return session
}

func randomID() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		panic(fmt.Sprintf("generate session ID: %v", err))
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	var encoded [36]byte
	hex.Encode(encoded[0:8], value[0:4])
	encoded[8] = '-'
	hex.Encode(encoded[9:13], value[4:6])
	encoded[13] = '-'
	hex.Encode(encoded[14:18], value[6:8])
	encoded[18] = '-'
	hex.Encode(encoded[19:23], value[8:10])
	encoded[23] = '-'
	hex.Encode(encoded[24:36], value[10:16])
	return string(encoded[:])
}
