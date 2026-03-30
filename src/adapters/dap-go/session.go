package dapgo

import (
	"context"
	"fmt"
)

type Session struct {
	client           *Client
	selectedThreadID  int
	selectedFrameID   int
	lastTransitionTag string
}

func NewSession(client *Client) *Session {
	return &Session{client: client}
}

func (s *Session) Launch(ctx context.Context, args LaunchArgs) (SessionState, error) {
	if _, err := s.client.Launch(ctx, args); err != nil {
		return SessionState{}, err
	}
	s.lastTransitionTag = "launch"
	return s.State(ctx)
}

func (s *Session) Attach(ctx context.Context, args AttachArgs) (SessionState, error) {
	if _, err := s.client.Attach(ctx, args); err != nil {
		return SessionState{}, err
	}
	s.lastTransitionTag = "attach"
	return s.State(ctx)
}

func (s *Session) Pause(ctx context.Context) (SessionState, error) {
	threadID, err := s.ensureThreadID(ctx)
	if err != nil {
		return SessionState{}, err
	}
	if _, err := s.client.Pause(ctx, PauseArgs{ThreadID: threadID}); err != nil {
		return SessionState{}, err
	}
	s.lastTransitionTag = "pause"
	return s.State(ctx)
}

func (s *Session) Continue(ctx context.Context) (SessionState, error) {
	threadID, err := s.ensureThreadID(ctx)
	if err != nil {
		return SessionState{}, err
	}
	if _, err := s.client.Continue(ctx, ContinueArgs{ThreadID: threadID}); err != nil {
		return SessionState{}, err
	}
	s.lastTransitionTag = "continue"
	return s.State(ctx)
}

func (s *Session) State(ctx context.Context) (SessionState, error) {
	threads, err := s.client.Threads(ctx)
	if err != nil {
		return SessionState{}, err
	}

	state := SessionState{
		Mode:    StateRunning,
		Reason:  s.reasonForState(),
		Threads: threads,
	}

	if len(threads) == 0 {
		s.selectedThreadID = 0
		s.selectedFrameID = 0
		return state, nil
	}

	state.SelectedThreadID = threads[0].ID
	s.selectedThreadID = threads[0].ID

	stack, err := s.client.StackTrace(ctx, StackArgs{ThreadID: threads[0].ID, Levels: 20})
	if err != nil || len(stack.Frames) == 0 {
		s.selectedFrameID = 0
		return state, nil
	}

	state.Mode = StatePaused
	state.TopFrame = &stack.Frames[0]
	s.selectedFrameID = stack.Frames[0].ID
	return state, nil
}

func (s *Session) Stack(ctx context.Context) (StackResult, error) {
	threadID, err := s.ensureThreadID(ctx)
	if err != nil {
		return StackResult{}, err
	}

	result, err := s.client.StackTrace(ctx, StackArgs{ThreadID: threadID, Levels: 20})
	if err != nil {
		return StackResult{}, err
	}
	if len(result.Frames) > 0 {
		s.selectedFrameID = result.Frames[0].ID
		return result, nil
	}

	return StackResult{}, fmt.Errorf("session.invalid_state: no paused frame available")
}

func (s *Session) Vars(ctx context.Context) (VarsResult, error) {
	frameID, err := s.ensureFrameID(ctx)
	if err != nil {
		return VarsResult{}, err
	}

	scopes, err := s.client.Scopes(ctx, ScopesArgs{FrameID: frameID})
	if err != nil {
		return VarsResult{}, err
	}

	vars := VarsResult{
		FrameID: frameID,
		Scopes:  scopes,
	}

	for _, scope := range scopes {
		if scope.VariablesReference == 0 {
			continue
		}
		values, err := s.client.Variables(ctx, VariablesArgs{VariablesReference: scope.VariablesReference})
		if err != nil {
			return VarsResult{}, err
		}
		for _, value := range values {
			value.Scope = scope.Name
			vars.Variables = append(vars.Variables, value)
		}
	}

	return vars, nil
}

func (s *Session) Eval(ctx context.Context, expression string) (EvalResult, error) {
	frameID, err := s.ensureFrameID(ctx)
	if err != nil {
		return EvalResult{}, err
	}

	return s.client.Evaluate(ctx, EvaluateArgs{
		FrameID:    &frameID,
		Expression: expression,
		Context:    "repl",
	})
}

func (s *Session) ensureThreadID(ctx context.Context) (int, error) {
	if s.selectedThreadID > 0 {
		return s.selectedThreadID, nil
	}

	state, err := s.State(ctx)
	if err != nil {
		return 0, err
	}
	if state.SelectedThreadID == 0 {
		return 0, fmt.Errorf("session.invalid_state: no thread available")
	}

	return state.SelectedThreadID, nil
}

func (s *Session) ensureFrameID(ctx context.Context) (int, error) {
	if s.selectedFrameID > 0 {
		return s.selectedFrameID, nil
	}

	stack, err := s.Stack(ctx)
	if err != nil {
		return 0, err
	}
	if len(stack.Frames) == 0 {
		return 0, fmt.Errorf("session.invalid_state: no paused frame available")
	}

	return stack.Frames[0].ID, nil
}

func (s *Session) reasonForState() string {
	if s.lastTransitionTag != "" {
		return s.lastTransitionTag
	}
	return "snapshot"
}
