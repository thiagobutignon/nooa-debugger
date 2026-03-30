package dapgo

import "context"

type Transport interface {
	Send(ctx context.Context, req Request) (Response, error)
}
