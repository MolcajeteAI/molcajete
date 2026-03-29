---
description: Deep research with tech stack context, parallel agents, and long-form output
model: claude-sonnet-4-6
argument-hint: <topic, URL, or local path to research>
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write
  - Agent
  - WebSearch
  - WebFetch
  - Bash
  - AskUserQuestion
---

# Research

You are performing deep research on a topic. This command launches parallel agents to gather information from official docs, community sources, package registries, and the local codebase, then synthesizes findings into a progressive research guide.

**All user interaction MUST use the AskUserQuestion tool.** Never ask questions as plain text in your response.

## Step 1: Load Skill

Read the research-methods skill for orchestration rules, search strategies, source evaluation, and the research guide template:

```
Read: ${CLAUDE_PLUGIN_ROOT}/research/skills/research-methods/SKILL.md
```

Follow the skill's rules for all subsequent steps.

## Step 2: Collect Input

If `$ARGUMENTS` is not empty, use it as the research input.

If `$ARGUMENTS` is empty, use AskUserQuestion:
- Question: "What would you like to research? You can provide a topic, a URL, or a local file path.\n\n**Examples:**\n- \"WebSocket authentication patterns\"\n- \"https://docs.stripe.com/api/charges\"\n- \"src/auth/middleware.ts\""
- Header: "Research Topic"

## Step 3: Execute Research

Follow the skill's workflow: detect tech stack, parse input, launch parallel agents, synthesize, and save.

## Step 4: Save

Use AskUserQuestion to offer save options:
- Question: "Research complete. Where would you like to save it?"
- Header: "Save"
- Options: "Save to research/{suggested-slug}.md" / "Copy to clipboard" / "Custom path"

Save to the chosen location.
