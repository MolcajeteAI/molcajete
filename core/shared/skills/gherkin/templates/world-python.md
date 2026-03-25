# Python World Module Template

Create the world/context module during scaffold setup. **If `bdd/steps/world.py` already exists, do NOT modify it.**

Write `bdd/steps/world.py`:

```python
"""
Test world — shared context for all BDD steps.

This module provides the test context object and lifecycle utilities.
Modify this file to add project-specific setup (DB connections, API clients, auth helpers).
"""


class World:
    """Shared test context passed between steps via behave's `context`."""

    def __init__(self):
        self.base_url = ""       # TODO: set API base URL
        self.db_conn = None      # TODO: set DB connection
        self.auth_token = None   # TODO: set auth token helper
        self.response = None     # Last HTTP response
        self.data = {}           # Arbitrary shared data between steps
```

Write `bdd/steps/environment.py`:

```python
"""
Behave environment hooks.

Lifecycle hooks for scenario setup and teardown.
"""

from steps.world import World


def before_scenario(context, scenario):
    """Initialize a fresh World for each scenario."""
    context.world = World()


def after_scenario(context, scenario):
    """Clean up after each scenario."""
    if context.world.db_conn:
        # TODO: TRUNCATE test tables or rollback transaction
        pass
```
