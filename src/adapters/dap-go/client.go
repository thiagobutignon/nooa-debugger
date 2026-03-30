package dapgo

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
)

type Client struct {
	transport Transport
	mu        sync.Mutex
	seq       int
}

type CommandResult struct {
	Command string
	Body    map[string]any
	Message string
}

func NewClient(transport Transport) *Client {
	return &Client{transport: transport}
}

func (c *Client) nextSeq() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.seq++
	return c.seq
}

func (c *Client) send(ctx context.Context, command string, args map[string]any) (Response, error) {
	if c == nil || c.transport == nil {
		return Response{}, errors.New("dap transport is not configured")
	}

	req := Request{
		Seq:       c.nextSeq(),
		Command:   command,
		Arguments: args,
	}

	resp, err := c.transport.Send(ctx, req)
	if err != nil {
		return Response{}, err
	}

	if !resp.Success {
		if resp.Message == "" {
			resp.Message = "request failed"
		}

		return Response{}, fmt.Errorf("%s failed: %s", command, resp.Message)
	}

	return resp, nil
}

func (c *Client) Launch(ctx context.Context, args LaunchArgs) (CommandResult, error) {
	resp, err := c.send(ctx, "launch", launchArguments(args))
	if err != nil {
		return CommandResult{}, err
	}

	return CommandResult{Command: resp.Command, Body: resp.Body, Message: resp.Message}, nil
}

func (c *Client) Attach(ctx context.Context, args AttachArgs) (CommandResult, error) {
	resp, err := c.send(ctx, "attach", attachArguments(args))
	if err != nil {
		return CommandResult{}, err
	}

	return CommandResult{Command: resp.Command, Body: resp.Body, Message: resp.Message}, nil
}

func (c *Client) Pause(ctx context.Context, args PauseArgs) (CommandResult, error) {
	resp, err := c.send(ctx, "pause", map[string]any{"threadId": args.ThreadID})
	if err != nil {
		return CommandResult{}, err
	}

	return CommandResult{Command: resp.Command, Body: resp.Body, Message: resp.Message}, nil
}

func (c *Client) Continue(ctx context.Context, args ContinueArgs) (CommandResult, error) {
	resp, err := c.send(ctx, "continue", map[string]any{"threadId": args.ThreadID})
	if err != nil {
		return CommandResult{}, err
	}

	return CommandResult{Command: resp.Command, Body: resp.Body, Message: resp.Message}, nil
}

func (c *Client) Threads(ctx context.Context) ([]ThreadSummary, error) {
	resp, err := c.send(ctx, "threads", nil)
	if err != nil {
		return nil, err
	}

	return parseThreads(resp.Body), nil
}

func (c *Client) StackTrace(ctx context.Context, args StackArgs) (StackResult, error) {
	requestArgs := map[string]any{"threadId": args.ThreadID}
	if args.Levels > 0 {
		requestArgs["levels"] = args.Levels
	}

	resp, err := c.send(ctx, "stackTrace", requestArgs)
	if err != nil {
		return StackResult{}, err
	}

	return StackResult{
		ThreadID: args.ThreadID,
		Frames:   parseFrames(resp.Body, args.ThreadID),
	}, nil
}

func (c *Client) Scopes(ctx context.Context, args ScopesArgs) ([]ScopeSummary, error) {
	resp, err := c.send(ctx, "scopes", map[string]any{"frameId": args.FrameID})
	if err != nil {
		return nil, err
	}

	return parseScopes(resp.Body), nil
}

func (c *Client) Variables(ctx context.Context, args VariablesArgs) ([]VariableSummary, error) {
	resp, err := c.send(ctx, "variables", map[string]any{"variablesReference": args.VariablesReference})
	if err != nil {
		return nil, err
	}

	return parseVariables(resp.Body, ""), nil
}

func (c *Client) Evaluate(ctx context.Context, args EvaluateArgs) (EvalResult, error) {
	requestArgs := map[string]any{
		"expression": args.Expression,
	}
	if args.FrameID != nil {
		requestArgs["frameId"] = *args.FrameID
	}
	if args.Context != "" {
		requestArgs["context"] = args.Context
	}

	resp, err := c.send(ctx, "evaluate", requestArgs)
	if err != nil {
		return EvalResult{}, err
	}

	return EvalResult{
		Expression:         args.Expression,
		Value:              stringValue(resp.Body["result"]),
		Type:               stringValue(resp.Body["type"]),
		VariablesReference: intValue(resp.Body["variablesReference"]),
	}, nil
}

func launchArguments(args LaunchArgs) map[string]any {
	requestArgs := map[string]any{}
	if args.Program != "" {
		requestArgs["program"] = args.Program
	}
	if args.Mode != "" {
		requestArgs["mode"] = args.Mode
	}
	if len(args.Args) > 0 {
		requestArgs["args"] = args.Args
	}
	if args.Cwd != "" {
		requestArgs["cwd"] = args.Cwd
	}
	if len(args.Env) > 0 {
		requestArgs["env"] = args.Env
	}
	if args.StopOnEntry {
		requestArgs["stopOnEntry"] = args.StopOnEntry
	}
	if args.Backend != "" {
		requestArgs["backend"] = args.Backend
	}
	return requestArgs
}

func attachArguments(args AttachArgs) map[string]any {
	requestArgs := map[string]any{}
	if args.Mode != "" {
		requestArgs["mode"] = args.Mode
	}
	if args.ProcessID > 0 {
		requestArgs["processId"] = args.ProcessID
	}
	if args.Host != "" {
		requestArgs["host"] = args.Host
	}
	if args.Port > 0 {
		requestArgs["port"] = args.Port
	}
	return requestArgs
}

func parseThreads(body map[string]any) []ThreadSummary {
	items, _ := body["threads"].([]any)
	threads := make([]ThreadSummary, 0, len(items))
	for _, item := range items {
		threadMap, _ := item.(map[string]any)
		threads = append(threads, ThreadSummary{
			ID:   intValue(threadMap["id"]),
			Name: stringValue(threadMap["name"]),
		})
	}
	return threads
}

func parseFrames(body map[string]any, threadID int) []FrameSummary {
	items, _ := body["stackFrames"].([]any)
	frames := make([]FrameSummary, 0, len(items))
	for _, item := range items {
		frameMap, _ := item.(map[string]any)
		sourcePath := ""
		if source, ok := frameMap["source"].(map[string]any); ok {
			sourcePath = stringValue(source["path"])
			if sourcePath == "" {
				sourcePath = stringValue(source["name"])
			}
		}

		frames = append(frames, FrameSummary{
			ID:       intValue(frameMap["id"]),
			Name:     stringValue(frameMap["name"]),
			Source:   sourcePath,
			Line:     intValue(frameMap["line"]),
			Column:   intValue(frameMap["column"]),
			ThreadID: threadID,
		})
	}
	return frames
}

func parseScopes(body map[string]any) []ScopeSummary {
	items, _ := body["scopes"].([]any)
	scopes := make([]ScopeSummary, 0, len(items))
	for _, item := range items {
		scopeMap, _ := item.(map[string]any)
		scopes = append(scopes, ScopeSummary{
			Name:               stringValue(scopeMap["name"]),
			VariablesReference: intValue(scopeMap["variablesReference"]),
			Expensive:          boolValue(scopeMap["expensive"]),
		})
	}
	return scopes
}

func parseVariables(body map[string]any, scope string) []VariableSummary {
	items, _ := body["variables"].([]any)
	variables := make([]VariableSummary, 0, len(items))
	for _, item := range items {
		variableMap, _ := item.(map[string]any)
		variables = append(variables, VariableSummary{
			Scope:              scope,
			Name:               stringValue(variableMap["name"]),
			Value:              stringValue(variableMap["value"]),
			Type:               stringValue(variableMap["type"]),
			VariablesReference: intValue(variableMap["variablesReference"]),
		})
	}
	return variables
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	case nil:
		return ""
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", typed))
	}
}

func intValue(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int8:
		return int(typed)
	case int16:
		return int(typed)
	case int32:
		return int(typed)
	case int64:
		return int(typed)
	case float32:
		return int(typed)
	case float64:
		return int(typed)
	default:
		return 0
	}
}

func boolValue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	default:
		return false
	}
}
