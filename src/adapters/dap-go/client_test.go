package dapgo

import (
	"context"
	"testing"
)

func TestClientRequestShapes(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name        string
		call        func(*Client, *FakeTransport) error
		wantCommand  string
		wantArgument map[string]any
	}{
		{
			name: "launch",
			call: func(client *Client, fake *FakeTransport) error {
				fake.EnqueueResponse("launch", map[string]any{"ok": true})
				_, err := client.Launch(ctx, LaunchArgs{
					Program:     "/tmp/hello",
					Mode:        "debug",
					Args:        []string{"--flag", "value"},
					Cwd:         "/tmp",
					Env:         map[string]string{"A": "B"},
					StopOnEntry: true,
					Backend:     "default",
				})
				return err
			},
			wantCommand: "launch",
			wantArgument: map[string]any{
				"program":     "/tmp/hello",
				"mode":        "debug",
				"args":        []string{"--flag", "value"},
				"cwd":         "/tmp",
				"env":         map[string]string{"A": "B"},
				"stopOnEntry": true,
				"backend":     "default",
			},
		},
		{
			name: "attach",
			call: func(client *Client, fake *FakeTransport) error {
				fake.EnqueueResponse("attach", map[string]any{"ok": true})
				_, err := client.Attach(ctx, AttachArgs{
					Mode:      "local",
					ProcessID: 1234,
					Host:      "127.0.0.1",
					Port:      2345,
				})
				return err
			},
			wantCommand: "attach",
			wantArgument: map[string]any{
				"mode":      "local",
				"processId": 1234,
				"host":      "127.0.0.1",
				"port":      2345,
			},
		},
		{
			name: "pause",
			call: func(client *Client, fake *FakeTransport) error {
				fake.EnqueueResponse("pause", map[string]any{"ok": true})
				_, err := client.Pause(ctx, PauseArgs{ThreadID: 9})
				return err
			},
			wantCommand: "pause",
			wantArgument: map[string]any{
				"threadId": 9,
			},
		},
		{
			name: "continue",
			call: func(client *Client, fake *FakeTransport) error {
				fake.EnqueueResponse("continue", map[string]any{"ok": true})
				_, err := client.Continue(ctx, ContinueArgs{ThreadID: 9})
				return err
			},
			wantCommand: "continue",
			wantArgument: map[string]any{
				"threadId": 9,
			},
		},
		{
			name: "stackTrace",
			call: func(client *Client, fake *FakeTransport) error {
				fake.EnqueueResponse("stackTrace", map[string]any{"stackFrames": []any{}})
				_, err := client.StackTrace(ctx, StackArgs{ThreadID: 7, Levels: 20})
				return err
			},
			wantCommand: "stackTrace",
			wantArgument: map[string]any{
				"threadId": 7,
				"levels":   20,
			},
		},
		{
			name: "scopes",
			call: func(client *Client, fake *FakeTransport) error {
				fake.EnqueueResponse("scopes", map[string]any{"scopes": []any{}})
				_, err := client.Scopes(ctx, ScopesArgs{FrameID: 4})
				return err
			},
			wantCommand: "scopes",
			wantArgument: map[string]any{
				"frameId": 4,
			},
		},
		{
			name: "variables",
			call: func(client *Client, fake *FakeTransport) error {
				fake.EnqueueResponse("variables", map[string]any{"variables": []any{}})
				_, err := client.Variables(ctx, VariablesArgs{VariablesReference: 88})
				return err
			},
			wantCommand: "variables",
			wantArgument: map[string]any{
				"variablesReference": 88,
			},
		},
		{
			name: "evaluate",
			call: func(client *Client, fake *FakeTransport) error {
				fake.EnqueueResponse("evaluate", map[string]any{"result": "42", "type": "int"})
				frameID := 3
				_, err := client.Evaluate(ctx, EvaluateArgs{
					FrameID:    &frameID,
					Expression: "answer",
					Context:    "repl",
				})
				return err
			},
			wantCommand: "evaluate",
			wantArgument: map[string]any{
				"frameId":    3,
				"expression": "answer",
				"context":    "repl",
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			fake := NewFakeTransport()
			client := NewClient(fake)

			if err := tc.call(client, fake); err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			req := fake.PopRequest(t)
			if req.Command != tc.wantCommand {
				t.Fatalf("command = %q, want %q", req.Command, tc.wantCommand)
			}
			for key, want := range tc.wantArgument {
				got, ok := req.Arguments[key]
				if !ok {
					t.Fatalf("missing argument %q", key)
				}
				if !deepEqual(got, want) {
					t.Fatalf("argument %q = %#v, want %#v", key, got, want)
				}
			}
		})
	}
}

func deepEqual(got, want any) bool {
	switch wantTyped := want.(type) {
	case []string:
		gotTyped, ok := got.([]string)
		if !ok || len(gotTyped) != len(wantTyped) {
			return false
		}
		for i := range wantTyped {
			if gotTyped[i] != wantTyped[i] {
				return false
			}
		}
		return true
	case map[string]string:
		gotTyped, ok := got.(map[string]string)
		if !ok || len(gotTyped) != len(wantTyped) {
			return false
		}
		for key, value := range wantTyped {
			if gotTyped[key] != value {
				return false
			}
		}
		return true
	default:
		return got == want
	}
}
