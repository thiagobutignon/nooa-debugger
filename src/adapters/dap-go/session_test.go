package dapgo

import (
	"context"
	"testing"
)

func TestSessionLaunchAttachPauseContinueState(t *testing.T) {
	ctx := context.Background()

	t.Run("launch", func(t *testing.T) {
		fake := NewFakeTransport()
		session := NewSession(NewClient(fake))
		fake.EnqueueResponse("launch", map[string]any{"ok": true})
		fake.EnqueueResponse("threads", map[string]any{
			"threads": []any{
				map[string]any{"id": 11, "name": "main"},
			},
		})
		fake.EnqueueResponse("stackTrace", map[string]any{
			"stackFrames": []any{
				map[string]any{
					"id":     21,
					"name":   "main.main",
					"line":   17,
					"column": 3,
					"source": map[string]any{"path": "/work/main.go"},
				},
			},
		})

		state, err := session.Launch(ctx, LaunchArgs{Program: "/work/main", Mode: "debug"})
		if err != nil {
			t.Fatalf("Launch returned error: %v", err)
		}
		if state.Mode != StatePaused {
			t.Fatalf("Launch state = %q, want paused", state.Mode)
		}
		if state.SelectedThreadID != 11 {
			t.Fatalf("Launch selected thread = %d, want 11", state.SelectedThreadID)
		}
		if state.TopFrame == nil || state.TopFrame.Source != "/work/main.go" {
			t.Fatalf("Launch top frame = %#v, want source /work/main.go", state.TopFrame)
		}
	})

	t.Run("attach", func(t *testing.T) {
		fake := NewFakeTransport()
		session := NewSession(NewClient(fake))
		fake.EnqueueResponse("attach", map[string]any{"ok": true})
		fake.EnqueueResponse("threads", map[string]any{
			"threads": []any{
				map[string]any{"id": 31, "name": "worker"},
			},
		})
		fake.EnqueueResponse("stackTrace", map[string]any{"stackFrames": []any{}})

		state, err := session.Attach(ctx, AttachArgs{Mode: "local", ProcessID: 2001})
		if err != nil {
			t.Fatalf("Attach returned error: %v", err)
		}
		if state.Mode != StateRunning {
			t.Fatalf("Attach state = %q, want running", state.Mode)
		}
		if state.SelectedThreadID != 31 {
			t.Fatalf("Attach selected thread = %d, want 31", state.SelectedThreadID)
		}
	})

	t.Run("pause-and-continue", func(t *testing.T) {
		fake := NewFakeTransport()
		session := NewSession(NewClient(fake))
		fake.EnqueueResponse("threads", map[string]any{
			"threads": []any{
				map[string]any{"id": 41, "name": "main"},
			},
		})
		fake.EnqueueResponse("stackTrace", map[string]any{
			"stackFrames": []any{
				map[string]any{
					"id":     51,
					"name":   "main.pausePoint",
					"line":   22,
					"column": 1,
					"source": map[string]any{"path": "/work/pause.go"},
				},
			},
		})
		fake.EnqueueResponse("pause", map[string]any{"ok": true})
		fake.EnqueueResponse("threads", map[string]any{
			"threads": []any{
				map[string]any{"id": 41, "name": "main"},
			},
		})
		fake.EnqueueResponse("stackTrace", map[string]any{
			"stackFrames": []any{
				map[string]any{
					"id":     52,
					"name":   "main.pausePoint",
					"line":   23,
					"column": 1,
					"source": map[string]any{"path": "/work/pause.go"},
				},
			},
		})
		fake.EnqueueResponse("continue", map[string]any{"ok": true})
		fake.EnqueueResponse("threads", map[string]any{
			"threads": []any{
				map[string]any{"id": 41, "name": "main"},
			},
		})
		fake.EnqueueResponse("stackTrace", map[string]any{"stackFrames": []any{}})

		state, err := session.State(ctx)
		if err != nil {
			t.Fatalf("State returned error: %v", err)
		}
		if state.Mode != StatePaused {
			t.Fatalf("State mode = %q, want paused", state.Mode)
		}
		if state.TopFrame == nil || state.TopFrame.Source != "/work/pause.go" {
			t.Fatalf("State top frame = %#v, want source /work/pause.go", state.TopFrame)
		}

		state, err = session.Pause(ctx)
		if err != nil {
			t.Fatalf("Pause returned error: %v", err)
		}
		if state.Mode != StatePaused {
			t.Fatalf("Pause state = %q, want paused", state.Mode)
		}

		state, err = session.Continue(ctx)
		if err != nil {
			t.Fatalf("Continue returned error: %v", err)
		}
		if state.Mode != StateRunning {
			t.Fatalf("Continue state = %q, want running", state.Mode)
		}
	})
}

func TestSessionStackVarsEval(t *testing.T) {
	ctx := context.Background()
	fake := NewFakeTransport()
	session := NewSession(NewClient(fake))

	fake.EnqueueResponse("threads", map[string]any{
		"threads": []any{
			map[string]any{"id": 61, "name": "main"},
		},
	})
	fake.EnqueueResponse("stackTrace", map[string]any{
		"stackFrames": []any{
			map[string]any{
				"id":     71,
				"name":   "main.compute",
				"line":   44,
				"column": 5,
				"source": map[string]any{"path": "/work/compute.go"},
			},
		},
	})
	fake.EnqueueResponse("stackTrace", map[string]any{
		"stackFrames": []any{
			map[string]any{
				"id":     71,
				"name":   "main.compute",
				"line":   44,
				"column": 5,
				"source": map[string]any{"path": "/work/compute.go"},
			},
		},
	})
	fake.EnqueueResponse("scopes", map[string]any{
		"scopes": []any{
			map[string]any{"name": "Locals", "variablesReference": 81, "expensive": false},
			map[string]any{"name": "Globals", "variablesReference": 82, "expensive": false},
		},
	})
	fake.EnqueueResponse("variables", map[string]any{
		"variables": []any{
			map[string]any{"name": "count", "value": "3", "type": "int", "variablesReference": 0},
			map[string]any{"name": "label", "value": "demo", "type": "string", "variablesReference": 0},
		},
	})
	fake.EnqueueResponse("variables", map[string]any{
		"variables": []any{
			map[string]any{"name": "pi", "value": "3.14", "type": "float64", "variablesReference": 0},
		},
	})
	fake.EnqueueResponse("evaluate", map[string]any{
		"result":             "4",
		"type":               "int",
		"variablesReference": 0,
	})

	state, err := session.State(ctx)
	if err != nil {
		t.Fatalf("State returned error: %v", err)
	}
	if state.Mode != StatePaused {
		t.Fatalf("State mode = %q, want paused", state.Mode)
	}

	stack, err := session.Stack(ctx)
	if err != nil {
		t.Fatalf("Stack returned error: %v", err)
	}
	if len(stack.Frames) != 1 {
		t.Fatalf("Stack frames = %d, want 1", len(stack.Frames))
	}

	vars, err := session.Vars(ctx)
	if err != nil {
		t.Fatalf("Vars returned error: %v", err)
	}
	if len(vars.Scopes) != 2 {
		t.Fatalf("Vars scopes = %d, want 2", len(vars.Scopes))
	}
	if len(vars.Variables) != 3 {
		t.Fatalf("Vars variables = %d, want 3", len(vars.Variables))
	}
	if vars.Variables[0].Scope != "Locals" {
		t.Fatalf("Vars first variable scope = %q, want Locals", vars.Variables[0].Scope)
	}

	eval, err := session.Eval(ctx, "count + 1")
	if err != nil {
		t.Fatalf("Eval returned error: %v", err)
	}
	if eval.Value != "4" {
		t.Fatalf("Eval value = %q, want 4", eval.Value)
	}
	if eval.Type != "int" {
		t.Fatalf("Eval type = %q, want int", eval.Type)
	}
}
