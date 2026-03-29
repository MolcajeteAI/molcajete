# Source Evaluation

Reference for evaluating source quality, assigning tiers, and determining confidence levels.

## Source Tiers

### Tier 1: Official

Sources directly from the creators or maintainers of the technology.

- Official documentation sites
- Official API references
- Official GitHub repositories (README, docs/, wiki)
- RFCs and specification documents
- Official blog posts from the technology's team

**Trust level:** High — use as ground truth. Still verify version relevance.

### Tier 2: Authoritative

Sources from recognized experts or established educational platforms.

- Known educators and authors in the field (e.g., Dan Abramov for React, Kent C. Dodds for testing)
- Verified contributors to the project
- Reputable publisher content (O'Reilly, Manning, Pragmatic Bookshelf)
- Conference talks from core team or recognized experts
- Well-maintained awesome-lists with community curation

**Trust level:** High — reliable but may reflect personal opinion or specific context.

### Tier 3: Community

Sources from the broader developer community.

- Stack Overflow answers (check vote count and acceptance)
- GitHub issues and discussions (check resolution status)
- Developer blog posts (check author credentials and recency)
- Tutorial sites (check code examples actually work)
- Reddit and forum discussions (check consensus vs single opinion)

**Trust level:** Medium — cross-reference with Tier 1/2 sources. Valuable for real-world gotchas.

### Tier 4: Unverified

Sources that cannot be verified or have unknown provenance.

- AI-generated content without citations
- Anonymous forum posts
- Outdated documentation (> 2 years for fast-moving tech)
- Content from SEO-optimized sites with thin technical depth
- Translated content where accuracy is uncertain

**Trust level:** Low — use with caution, always cross-reference.

## Evaluation Criteria (ACARP)

Apply these criteria to every source:

| Criterion | Question | Red Flags |
|-----------|----------|-----------|
| **Authority** | Who wrote this? What are their credentials? | Anonymous, no bio, no verifiable affiliation |
| **Currency** | When was this written? Is it still relevant? | No date, references deprecated APIs, old version numbers |
| **Accuracy** | Can claims be verified? Do code examples work? | No code examples, contradicts official docs, syntax errors |
| **Relevance** | Does this address the specific topic and stack? | Different language/framework, different version, tangential topic |
| **Purpose** | Why was this written? Is it objective? | Product marketing disguised as tutorial, affiliate-heavy content |

## Cross-Referencing Rules

1. **Any claim used in the research guide must appear in at least 2 sources** (or 1 Tier 1 source)
2. **If Tier 3/4 sources contradict Tier 1/2, go with the higher-tier source** and note the discrepancy
3. **For library recommendations, verify:** the library is actively maintained (commits in last 6 months), has meaningful adoption (downloads/stars), and has no critical unresolved security issues
4. **For code patterns, verify:** the code compiles/runs in the current version of the framework/language

## Confidence Levels

Assign a confidence level to each major claim or recommendation in the research guide:

| Level | Meaning | Source Requirement |
|-------|---------|-------------------|
| **High** | Well-established, widely agreed upon | 2+ Tier 1/2 sources agree |
| **Medium** | Generally accepted but with caveats | 1 Tier 1/2 source + community consensus |
| **Low** | Emerging, debated, or context-dependent | Only Tier 3/4 sources, or sources disagree |

When confidence is low, explicitly note it in the research guide so the reader can make an informed decision.
