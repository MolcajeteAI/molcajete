# Go World Module Template

Create the world/context module during scaffold setup. **If `bdd/steps/world.go` already exists, do NOT modify it.**

Write `bdd/steps/world.go`:

```go
package steps

import (
	"context"
	"net/http"

	"github.com/cucumber/godog"
)

// TestWorld holds shared state between steps within a scenario.
// Modify this struct to add project-specific fields (DB pool, API client, auth helpers).
type TestWorld struct {
	BaseURL   string            // TODO: set API base URL
	AuthToken string            // TODO: set auth token helper
	Response  *http.Response    // Last HTTP response
	Data      map[string]any    // Arbitrary shared data between steps
}

// NewTestWorld creates a fresh TestWorld for a scenario.
func NewTestWorld() *TestWorld {
	return &TestWorld{
		Data: make(map[string]any),
	}
}

// BeforeScenario initializes the world before each scenario.
func BeforeScenario(ctx context.Context, sc *godog.Scenario) (context.Context, error) {
	world := NewTestWorld()
	return context.WithValue(ctx, worldKey, world), nil
}

// AfterScenario cleans up after each scenario.
func AfterScenario(ctx context.Context, sc *godog.Scenario, err error) (context.Context, error) {
	// TODO: TRUNCATE test tables or rollback transaction
	return ctx, nil
}

type contextKey string

const worldKey contextKey = "world"

// GetWorld retrieves the TestWorld from the context.
func GetWorld(ctx context.Context) *TestWorld {
	return ctx.Value(worldKey).(*TestWorld)
}
```
