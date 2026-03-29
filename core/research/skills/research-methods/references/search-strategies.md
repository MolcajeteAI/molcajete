# Search Strategies

Reference for constructing effective search queries and choosing between WebSearch and WebFetch.

## WebSearch vs WebFetch Decision Matrix

| Situation | Tool | Reason |
|-----------|------|--------|
| Finding relevant pages on a topic | WebSearch | Need to discover URLs |
| Reading a known URL's content | WebFetch | Already have the URL |
| Getting official docs for a library | WebSearch first, then WebFetch | Find the right page, then read it |
| Reading a GitHub README | WebFetch | Direct URL pattern is predictable |
| Finding community discussions | WebSearch | Need to discover relevant threads |
| Reading a Stack Overflow answer | WebFetch | After finding it via WebSearch |

## Query Construction

### General Principles

1. **Be specific** — "React useEffect cleanup async" not "React hooks"
2. **Include the language/framework** — "TypeScript WebSocket reconnection" not "WebSocket reconnection"
3. **Add context qualifiers** — "production", "best practices", "2024", "performance"
4. **Use error messages verbatim** — when researching errors, quote the exact message

### Progressive Refinement

Start broad, then narrow based on results:

1. **Discovery query** — broad topic to understand the landscape: `"{topic} {language} guide"`
2. **Focused query** — specific aspect identified from discovery: `"{topic} {specific aspect} {language}"`
3. **Problem query** — specific issues or edge cases: `"{topic} {problem} solution {language}"`

### Domain-Specific Strategies

**Frontend (React, Vue, etc.):**
- Include framework version: "React 18 Suspense" not "React Suspense"
- Check for breaking changes: "{library} migration guide v{X} to v{Y}"
- Search for hooks/composables patterns specific to the framework

**Backend (Node, Go, Python, etc.):**
- Include runtime/framework: "Express.js middleware" or "FastAPI dependency injection"
- Search for production considerations: "{topic} production {framework}"
- Look for benchmarks: "{library A} vs {library B} benchmark {language}"

**Infrastructure/DevOps:**
- Include cloud provider if relevant: "AWS Lambda cold start" not "serverless cold start"
- Search for configuration examples: "{tool} configuration example {use case}"
- Look for troubleshooting guides: "{tool} common issues"

**Database:**
- Include the specific database: "PostgreSQL partial index" not "database partial index"
- Search for query patterns: "{database} {pattern} query example"
- Look for scaling considerations: "{database} {feature} at scale"

## Registry Search Patterns

| Registry | Search URL Pattern | Sort By |
|----------|-------------------|---------|
| npm | `site:npmjs.com {topic}` | Popularity, maintenance |
| PyPI | `site:pypi.org {topic}` | Downloads, recent release |
| crates.io | `site:crates.io {topic}` | Downloads, recent activity |
| pkg.go.dev | `site:pkg.go.dev {topic}` | Imports, documentation quality |
| rubygems.org | `site:rubygems.org {topic}` | Downloads, recent release |

## Source Discovery Patterns

For each topic, search these source categories in order:

1. **Official source** — `"{library/technology} official documentation"`
2. **GitHub repo** — `"github.com/{org}/{repo}"` for README, issues, discussions
3. **API reference** — `"{library} API reference {version}"`
4. **Tutorials** — `"{topic} tutorial {language} {year}"`
5. **Community** — `"{topic} {language} site:stackoverflow.com"` or `"{topic} {language} site:github.com/issues"`
