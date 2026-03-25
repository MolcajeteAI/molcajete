# Python Step Definition Template

Use this template when creating new step definition files for Python (behave). Each template includes docstrings with parameter descriptions and a TODO placeholder body.

When creating a new step file, use the full template (module docstring + imports + step functions). When appending to an existing step file, add only the new step functions.

```python
"""
{Domain} step definitions.

Steps for {domain description} scenarios.
"""

from behave import given, when, then


@given("{step pattern with {param}}")
def step_given_description(context, param):
    """
    Set up {what this step does}.

    Args:
        param (str): {parameter description}
    """
    raise NotImplementedError("TODO: implement step")


@when("{step pattern with {param}}")
def step_when_description(context, param):
    """
    Perform {what this step does}.

    Args:
        param (str): {parameter description}
    """
    raise NotImplementedError("TODO: implement step")


@then("{step pattern with {param}}")
def step_then_description(context, param):
    """
    Assert {what this step verifies}.

    Args:
        param (str): {parameter description}
    """
    raise NotImplementedError("TODO: implement step")
```
