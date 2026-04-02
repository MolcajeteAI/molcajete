---
name: research-methods
description: >-
  Full research orchestration skill — detects tech stack, parses input type,
  launches 4 parallel agents (web docs, community, library discovery, local
  codebase), and synthesizes findings into a progressive research guide.
---

# Research Methods

Orchestrates deep research by launching parallel agents and synthesizing their findings into a single progressive guide. Every research request — regardless of topic — produces the same document format. The depth and breadth of each section adapts naturally to the topic.

## When to Use

- User wants to understand a technology, pattern, or concept before specifying it
- User provides a URL, local path, or general topic to research
- Any `/m:research` invocation

## Step 1: Detect Tech Stack

1. Check `.molcajete/apps.md` for cached BDD section (Framework, Language)
2. If not cached, scan project root for stack indicators: `package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, `requirements.txt`, `Gemfile`, `pom.xml`, `build.gradle`, `composer.json`, `mix.exs`
3. Store the detected stack as `DETECTED_STACK` — pass to all agents so they tailor results to the project's language and ecosystem

## Step 2: Parse Input

Classify the research input into one of three types:

| Type | Detection | Agent Behavior |
|------|-----------|----------------|
| **URL** | Starts with `http://` or `https://` | WebFetch the URL first, then research the topic it covers |
| **Local path** | Matches an existing file or directory path | Read the file/directory first, then research the topic it covers |
| **General query** | Everything else | Research the topic directly |

For URLs and local paths, extract the core topic from the content before launching agents.

## Step 3: Launch Parallel Agents

Launch all 4 agents in a single message for maximum parallelism. Each agent receives `DETECTED_STACK` and the research topic.

### Agent 1: Web Docs Agent

- **Type:** `subagent_type: general-purpose`
- **Task:** Search for official documentation, API references, getting-started guides, and specification documents
- **Instructions:**
  - Use WebSearch to find official docs for the topic
  - Use WebFetch to read the most relevant pages (limit to 3-5 pages)
  - Tag each finding with a source tier (see `references/source-evaluation.md`)
  - Return structured findings: title, URL, key content summary, source tier
  - Prioritize: official docs > API references > tutorials from the official source

### Agent 2: Community Agent

- **Type:** `subagent_type: general-purpose`
- **Task:** Search for real-world usage patterns, common issues, and community knowledge
- **Instructions:**
  - Use WebSearch for GitHub issues, Stack Overflow answers, blog posts, and tutorials
  - Focus on: common gotchas, production lessons, migration guides, performance tips
  - Tag each finding with a source tier
  - Return structured findings: title, URL, key takeaway, source tier
  - Prioritize recent content (within last 2 years) over older content

### Agent 3: Library Discovery Agent

- **Type:** `subagent_type: general-purpose`
- **Task:** Search the appropriate package registry for relevant libraries and tools
- **Instructions:**
  - Based on `DETECTED_STACK`, search the right registry:
    - JavaScript/TypeScript → npm (npmjs.com)
    - Python → PyPI (pypi.org)
    - Rust → crates.io
    - Go → pkg.go.dev
    - Ruby → rubygems.org
    - Java → Maven Central
    - PHP → Packagist
  - For each relevant library, collect: name, description, weekly downloads/popularity, license, last updated, key features
  - Return a structured comparison table
  - Include an opinionated recommendation for the current project context

### Agent 4: Local Codebase Agent

- **Type:** `subagent_type: Explore`
- **Task:** Find existing code patterns, dependencies, and conventions relevant to the research topic
- **Instructions:**
  - Use Glob to find files related to the topic
  - Use Grep to search for relevant imports, function names, patterns
  - Use Read to examine relevant code sections
  - Return: existing dependencies (from package.json/go.mod/etc.), existing patterns, conventions, architecture decisions
  - Note any existing implementations that relate to the research topic

## Step 4: Synthesize

Assemble the agent findings into the research guide using the template at:

```
${CLAUDE_PLUGIN_ROOT}/research/skills/research-methods/templates/research-guide.md
```

Read the template first, then populate each section:

1. **Introduction** — synthesize from all agents: what is this, why does it matter
2. **The Big Picture** — primarily from Web Docs Agent + Local Codebase Agent: where this fits
3. **Glossary** — extract key terms encountered across all agent findings
4. **Concepts** — primarily from Web Docs Agent: progressive concept explanation
5. **Options and Approaches** — primarily from Library Discovery Agent + Community Agent: comparison table
6. **How To Do It** — from Web Docs Agent + Local Codebase Agent: step-by-step in detected language
7. **Gotchas and Edge Cases** — primarily from Community Agent: real-world issues
8. **Key Takeaways** — synthesize from all agents: 5-7 essential items
9. **Sources** — all URLs organized by tier

### Writing Principles

- Plain language first — define technical terms immediately (or point to Glossary)
- Build from the ground up — each section assumes you've read the previous ones
- Friendly tone — explain over coffee, not from a textbook
- Scannable structure — headers, bullets, tables, bold for key terms
- Code examples in detected language with comments
- Always cite sources — every claim traceable to Sources section

## Step 5: Save

Present the completed guide and offer save options via AskUserQuestion (handled by the calling command).

## References

| Reference | Purpose |
|-----------|---------|
| [search-strategies.md](./references/search-strategies.md) | Query construction, search techniques, progressive refinement |
| [source-evaluation.md](./references/source-evaluation.md) | Source tiers (1-4), evaluation criteria, confidence levels |

## Templates

| Template | Purpose |
|----------|---------|
| [research-guide.md](./templates/research-guide.md) | Single progressive guide format for all research output |
