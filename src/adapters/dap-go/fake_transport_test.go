package dapgo

import (
	"context"
	"fmt"
	"sync"
	"testing"
)

type fakeQueuedResult struct {
	response Response
	err      error
}

type FakeTransport struct {
	mu        sync.Mutex
	requests  []Request
	responses []fakeQueuedResult
}

func NewFakeTransport() *FakeTransport {
	return &FakeTransport{}
}

func (f *FakeTransport) EnqueueResponse(command string, body map[string]any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.responses = append(f.responses, fakeQueuedResult{
		response: Response{
			Success: true,
			Command: command,
			Body:    body,
		},
	})
}

func (f *FakeTransport) EnqueueError(err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.responses = append(f.responses, fakeQueuedResult{err: err})
}

func (f *FakeTransport) Send(ctx context.Context, req Request) (Response, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.requests = append(f.requests, req)
	if len(f.responses) == 0 {
		return Response{}, fmt.Errorf("fake transport has no queued response for %q", req.Command)
	}

	next := f.responses[0]
	f.responses = f.responses[1:]
	if next.err != nil {
		return Response{}, next.err
	}

	next.response.RequestSeq = req.Seq
	if next.response.Command == "" {
		next.response.Command = req.Command
	}
	return next.response, nil
}

func (f *FakeTransport) PopRequest(t *testing.T) Request {
	t.Helper()

	f.mu.Lock()
	defer f.mu.Unlock()

	if len(f.requests) == 0 {
		t.Fatalf("expected a request, but none were recorded")
	}

	req := f.requests[0]
	f.requests = f.requests[1:]
	return req
}

func (f *FakeTransport) RequestCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.requests)
}

func TestFakeTransportRecordsAndReturnsQueuedResponses(t *testing.T) {
	fake := NewFakeTransport()
	fake.EnqueueResponse("launch", map[string]any{"ok": true})

	resp, err := fake.Send(context.Background(), Request{Seq: 1, Command: "launch", Arguments: map[string]any{"program": "/tmp/hello"}})
	if err != nil {
		t.Fatalf("Send returned error: %v", err)
	}
	if !resp.Success {
		t.Fatalf("response should have been successful")
	}
	if got := fake.PopRequest(t); got.Command != "launch" {
		t.Fatalf("recorded command = %q, want launch", got.Command)
	}
}
