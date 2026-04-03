# Go Step Definition Template

Use this template when creating new step definition files for Go (godog). Each template includes doc comments with parameter descriptions and a TODO placeholder body.

When creating a new step file, use the full template (package + imports + step struct + functions). When appending to an existing step file, add only the new step functions and register them in `InitializeScenario`.

```go
package steps

import (
	"context"
	"fmt"

	"github.com/cucumber/godog"
)

// {Domain}Steps registers step definitions for {domain} scenarios.
type {Domain}Steps struct {
	world *TestWorld
}

// New{Domain}Steps creates a new {domain} steps instance.
func New{Domain}Steps(world *TestWorld) *{Domain}Steps {
	return &{Domain}Steps{world: world}
}

// stepGivenDescription sets up {what this step does}.
//
// Parameters:
//   - param (string): {parameter description}
func (s *{Domain}Steps) stepGivenDescription(ctx context.Context, param string) error {
	return fmt.Errorf("TODO: implement step")
}

// stepWhenDescription performs {what this step does}.
//
// Parameters:
//   - param (string): {parameter description}
func (s *{Domain}Steps) stepWhenDescription(ctx context.Context, param string) error {
	return fmt.Errorf("TODO: implement step")
}

// stepThenDescription asserts {what this step verifies}.
//
// Parameters:
//   - param (string): {parameter description}
func (s *{Domain}Steps) stepThenDescription(ctx context.Context, param string) error {
	return fmt.Errorf("TODO: implement step")
}

// InitializeScenario registers all {domain} steps.
func (s *{Domain}Steps) InitializeScenario(ctx *godog.ScenarioContext) {
	ctx.Step(`^{step pattern with "([^"]*)"$`, s.stepGivenDescription)
	ctx.Step(`^{step pattern with "([^"]*)"$`, s.stepWhenDescription)
	ctx.Step(`^{step pattern with "([^"]*)"$`, s.stepThenDescription)
}
```
