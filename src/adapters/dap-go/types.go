package dapgo

const (
	StateUnknown = "unknown"
	StateRunning = "running"
	StatePaused  = "paused"
)

type Request struct {
	Seq       int
	Command   string
	Arguments map[string]any
}

type Response struct {
	RequestSeq int
	Success    bool
	Command    string
	Message    string
	Body       map[string]any
}

type LaunchArgs struct {
	Program     string
	Mode        string
	Args        []string
	Cwd         string
	Env         map[string]string
	StopOnEntry bool
	Backend     string
}

type AttachArgs struct {
	Mode      string
	ProcessID int
	Host      string
	Port      int
}

type PauseArgs struct {
	ThreadID int
}

type ContinueArgs struct {
	ThreadID int
}

type StackArgs struct {
	ThreadID int
	Levels   int
}

type ScopesArgs struct {
	FrameID int
}

type VariablesArgs struct {
	VariablesReference int
}

type EvaluateArgs struct {
	FrameID    *int
	Expression string
	Context    string
}

type ThreadSummary struct {
	ID   int
	Name string
}

type FrameSummary struct {
	ID       int
	Name     string
	Source   string
	Line     int
	Column   int
	ThreadID int
}

type ScopeSummary struct {
	Name               string
	VariablesReference int
	Expensive          bool
}

type VariableSummary struct {
	Scope              string
	Name               string
	Value              string
	Type               string
	VariablesReference int
}

type SessionState struct {
	Mode             string
	Reason           string
	Threads          []ThreadSummary
	SelectedThreadID int
	TopFrame         *FrameSummary
}

type StackResult struct {
	ThreadID int
	Frames   []FrameSummary
}

type VarsResult struct {
	FrameID   int
	Scopes    []ScopeSummary
	Variables []VariableSummary
}

type EvalResult struct {
	Expression         string
	Value              string
	Type               string
	VariablesReference int
}
