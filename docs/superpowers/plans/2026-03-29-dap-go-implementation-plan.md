# Go DAP Backend Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated Go backend slice that talks DAP to Delve-compatible debug servers and normalizes `launch`, `attach`, `pause`, `continue`, `state`, `stack`, `vars`, and `eval` into the AI-first debugger surface.

**Architecture:** Keep the slice self-contained under `src/adapters/dap-go/` as a small Go module with no dependency on the Bun runtime code. The module should expose a transport abstraction, a DAP client, and a session facade that converts protocol responses into stable, string-friendly records suitable for an agent-facing debugger surface. Real process launching is out of scope for this round, so `launch` and `attach` are modeled as DAP request flows over an existing transport.

**Tech Stack:** Go 1.22+, DAP JSON over a pluggable transport, `go test`, table-driven unit tests with a fake transport.

---

### Task 1: Bootstrap the standalone Go module and protocol types

**Files:**
- Create: `src/adapters/dap-go/go.mod`
- Create: `src/adapters/dap-go/types.go`
- Create: `src/adapters/dap-go/transport.go`
- Create: `src/adapters/dap-go/client.go`
- Create: `src/adapters/dap-go/client_test.go`

- [ ] **Step 1: Write the failing tests for transport encoding and request shapes**

```go
func TestClientSendsDAPRequest(t *testing.T) {
    fake := NewFakeTransport()
    client := NewClient(fake)

    _, err := client.Launch(context.Background(), LaunchArgs{
        Program: "/tmp/hello",
        Mode:    "debug",
    })
    require.NoError(t, err)

    req := fake.PopRequest(t)
    require.Equal(t, "launch", req.Command)
    require.Equal(t, "/tmp/hello", req.Arguments["program"])
    require.Equal(t, "debug", req.Arguments["mode"])
}
```

- [ ] **Step 2: Run the module tests to confirm the client does not exist yet**

Run: `cd src/adapters/dap-go && go test ./...`
Expected: FAIL because the module, client, and transport types have not been implemented yet.

- [ ] **Step 3: Implement the minimal module and DAP client**

Create:

```go
type Transport interface {
    Send(ctx context.Context, req Request) (Response, error)
}

type Client struct {
    transport Transport
}

func NewClient(transport Transport) *Client
func (c *Client) Launch(ctx context.Context, args LaunchArgs) (LaunchResult, error)
func (c *Client) Attach(ctx context.Context, args AttachArgs) (AttachResult, error)
func (c *Client) Pause(ctx context.Context) (PauseResult, error)
func (c *Client) Continue(ctx context.Context) (ContinueResult, error)
func (c *Client) StackTrace(ctx context.Context, threadID int) (StackResult, error)
func (c *Client) Scopes(ctx context.Context, frameID int) (ScopesResult, error)
func (c *Client) Variables(ctx context.Context, variablesReference int) (VariablesResult, error)
func (c *Client) Evaluate(ctx context.Context, frameID *int, expression string, contextName string) (EvaluateResult, error)
```

`types.go` should define small request/result structs that mirror the AI-first surface, not the full DAP schema.

- [ ] **Step 4: Re-run the module tests**

Run: `cd src/adapters/dap-go && go test ./...`
Expected: PASS for the new bootstrap and request-shape tests.

### Task 2: Add a fake transport and session normalization layer

**Files:**
- Create: `src/adapters/dap-go/session.go`
- Create: `src/adapters/dap-go/fake_transport_test.go`
- Create: `src/adapters/dap-go/session_test.go`

- [ ] **Step 1: Write failing tests for the debugger surface mapping**

```go
func TestSessionStateAndPausedData(t *testing.T) {
    fake := NewFakeTransport()
    session := NewSession(NewClient(fake))

    fake.EnqueueResponse("threads", dapThreadsResponse())
    fake.EnqueueResponse("stackTrace", dapStackTraceResponse())
    fake.EnqueueResponse("scopes", dapScopesResponse())
    fake.EnqueueResponse("variables", dapVariablesResponse())

    state, err := session.State(ctx)
    require.NoError(t, err)
    require.Equal(t, "paused", state.Mode)
    require.NotEmpty(t, state.Threads)

    stack, err := session.Stack(ctx, state.Threads[0].ID)
    require.NoError(t, err)
    require.Len(t, stack.Frames, 1)

    vars, err := session.Vars(ctx, stack.Frames[0].ID)
    require.NoError(t, err)
    require.NotEmpty(t, vars.Scopes)
}
```

- [ ] **Step 2: Run the session tests to confirm they fail**

Run: `cd src/adapters/dap-go && go test ./...`
Expected: FAIL because the session facade and fake transport do not exist yet.

- [ ] **Step 3: Implement the session facade and fake transport**

Create a `Session` type that wraps `Client` and normalizes protocol responses into:

- `SessionState` with `mode`, `threads`, and `reason`
- `StackResult` with stable frame IDs, names, source locations, and line numbers
- `VarsResult` with scopes and flattened variables using agent-friendly string values
- `EvaluateResult` with a single normalized `value` string plus an optional `type`

The fake transport should allow tests to enqueue responses and inspect outbound requests in order.

- [ ] **Step 4: Re-run the full module test suite**

Run: `cd src/adapters/dap-go && go test ./...`
Expected: PASS.

### Task 3: Document the AI-first contract mapping

**Files:**
- Create: `docs/reference/2026-03-29-go-dap-ai-first-surface.md`

- [ ] **Step 1: Write the contract doc**

Document:

- how `launch` and `attach` are represented as DAP request flows
- how `pause` and `continue` map to DAP execution control
- how `state` infers running vs paused from DAP threads and stopped events
- how `stack`, `vars`, and `eval` are normalized for agent consumption
- the intentional limitation that this slice does not start Delve itself yet

- [ ] **Step 2: Review the doc for scope drift**

Check for any mention of launcher orchestration, shared kernel refactors, or unsupported features like stepping, breakpoints, or persistent session storage. Remove anything outside this slice.

### Task 4: Verify, clean up, and commit

**Files:**
- Modify only the files created in Tasks 1-3

- [ ] **Step 1: Run the Go tests one more time**

Run: `cd src/adapters/dap-go && go test ./...`
Expected: PASS.

- [ ] **Step 2: Inspect the git diff for slice isolation**

Run: `git status --short && git diff --stat`
Expected: only the new Go backend files, the contract doc, and this plan doc should be present.

- [ ] **Step 3: Commit the slice**

```bash
git add src/adapters/dap-go docs/reference/2026-03-29-go-dap-ai-first-surface.md docs/superpowers/plans/2026-03-29-dap-go-implementation-plan.md
git commit -m "feat(dap-go): add standalone Delve DAP slice"
```
