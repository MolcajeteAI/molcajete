---
name: usecase-authoring
description: >-
  Rules and templates for creating and updating use case files. Defines
  UC file structure with flat scenario blocks, mandatory Side Effects field
  with non-side-effects, YAML frontmatter schema, UC-XXXX ID assignment,
  USE-CASES.md row management, and the creation interview pattern. Used by
  /m:plan.
---

# Use Case Authoring

Rules for creating and maintaining use case files: one file per UC at `prd/domains/{domain}/features/FEAT-XXXX-{slug}/use-cases/UC-XXXX-{slug}.md`. The /m:usecase command references this skill to run the creation interview and generate the UC file.

## When to Use

- Creating a new use case with /m:plan
- Updating an existing use case with /m:plan
- Understanding the structure and rules for UC files

## UC File Structure

Every UC file follows this exact structure. All sections are mandatory unless noted.

### 1. Title

```
# UC-XXXX: {Use Case Name}
```

The name is a verb-noun goal phrase (e.g., "Create Feature", "Authenticate User").

### 2. Objective

```
> {One sentence: what the actor achieves by completing this use case.}
```

Blockquote format. One sentence only. Describes the actor's goal, not the system's behavior.

### 3. Preconditions

```
## Preconditions

- {Shared state that must exist before ANY scenario can start}
- {Actor state: authenticated, has permission, etc.}
```

Bullet list of conditions that must be true before any scenario can begin. These are shared across all scenarios and map to a Gherkin `Background` block.

### 4. Trigger

```
## Trigger

{One sentence: what the actor does or what event occurs.}
```

One sentence only. Either an actor action ("User clicks Submit") or a system event ("Cron job fires at midnight").

### 5. Gherkin Tags

```
## Gherkin Tags

`@FEAT-XXXX @UC-XXXX`
```

Both tags on a single line in backticks. Used by /m:plan to tag generated Gherkin scenarios.

### 6. Scenarios

Scenarios are the core of the UC file. Every scenario -- success, error, edge case -- has the same shape and the same level of detail. There is no distinction between "main" and "alternative" flows.

Each scenario is a `### SC-XXXX:` heading followed by four bold-label fields. Scenarios are separated by `---` horizontal rules to give agents an unambiguous boundary signal. Each scenario gets a unique `SC-XXXX` ID. Generate codes by running `node ${CLAUDE_PLUGIN_ROOT}/shared/skills/id-generation/scripts/generate-id.js [count]` (use the count arg for multiple scenarios) and prepend `SC-` to each output line.

```
---

### SC-XXXX: {Scenario Name}

**Given:**
- {State specific to THIS scenario, beyond UC-level Preconditions}

**Steps:**
1. {Actor} {action}
2. System {validates/processes/stores/returns} {what}

**Outcomes:**
- {Entity/state that now exists or has changed}

**Side Effects:**
- `{event.name}` event published with payload `{fields}`
- No {notification/email/webhook} sent

---

### SC-XXXX: {Scenario Name}

**Given:**
- {Scenario-specific state}

**Steps:**
1. {Actor} {action}
2. System {response}

**Outcomes:**
- {What is true after this scenario}

**Side Effects:**
- {Side effects for this scenario}
- No {thing that does NOT happen}
```

#### Scenario Field Rules

| Field | Format | Rules |
|-------|--------|-------|
| **Given** | Bullet list | State specific to THIS scenario only. UC-level Preconditions are not repeated here. Maps to Gherkin `Given` / `And` after Background. |
| **Steps** | Numbered list | Actor/system interaction. Each step is one action. Maps to Gherkin `When` / `And`. |
| **UI** (optional) | Fenced code block (ASCII art) or Markdown image reference | Inline within Steps. Shows screen state after a step that produces a visual change. Omit for non-visual scenarios. |
| **Outcomes** | Bullet list | What is true after this scenario completes. Maps to Gherkin `Then` clauses. |
| **Side Effects** | Bullet list | Events, DB writes, and explicit non-side-effects. Maps to Gherkin `And` / `And no` clauses. |

#### Scenario Naming

- The first scenario is typically the success case, but structurally it is identical to every other scenario.
- Scenario names should be descriptive and unique within the UC (e.g., "Valid credentials", "Expired token", "Missing required field").
- Each scenario gets a unique `SC-XXXX` ID via `node ${CLAUDE_PLUGIN_ROOT}/shared/skills/id-generation/scripts/generate-id.js`.

#### Scenario Separators

Every scenario block is preceded and followed by a `---` horizontal rule. This includes before the first scenario (after the Gherkin Tags section) and after the last scenario.

#### Step Verb Conventions

- **Actor verbs:** provides, selects, confirms, submits, clicks, enters, uploads
- **System verbs:** validates, processes, stores, returns, displays, creates, publishes, sends

Each step is one action. Do not combine multiple actions in one step.

#### Inline UI

Scenarios that involve screens or visual interactions can include optional `**UI:**` blocks within the Steps section. A UI block shows the screen state the actor sees after a particular step.

**Position:** Indented under the step number that produces the visual change, before the next step. The `**UI:**` label is followed by a fenced code block (ASCII art) or an image reference.

```
**Steps:**
1. Actor submits the form
2. System displays the confirmation screen

   **UI:**
   ```
   +----------------------------------+
   | Confirmation                     |
   |----------------------------------|
   | Your changes have been saved.    |
   |                                  |
   | [ Back to Dashboard ]            |
   +----------------------------------+
   ```

3. Actor clicks "Back to Dashboard"
```

**Content types:**

- **ASCII art mockups** (default) -- fenced code blocks showing layout, key elements, and hierarchy. Generate from the user's description.
- **Image references** -- Markdown images pointing to `use-cases/assets/`:
  ```
  ![Confirmation screen](assets/UC-XXXX-confirmation.png)
  ```

**Asset management:**

- UC-level images go in `prd/domains/{domain}/features/FEAT-XXXX-{slug}/use-cases/assets/`
- File naming: `{UC-ID}-{descriptive-slug}.{ext}` (e.g., `UC-A1B2-login-form.png`)
- Lowercase, hyphens, no spaces
- Supported formats: PNG, JPG
- Create the `use-cases/assets/` directory only when images are needed

**When to include:**

- The scenario involves screens, forms, or visual interactions
- The user provides mockups, screenshots, or descriptions of screen state
- The step produces a visible change the actor responds to

**When to omit:**

- The scenario is backend-only, error-only, or has no visual component
- The user explicitly says no UI for this scenario
- The scenario's steps do not produce screen changes

A UC file can have UI blocks in some scenarios and none in others. Do not add empty UI placeholders.

## Side Effects Rules

Side Effects is the most critical field for downstream agents. The Tester agent maps side effects to Gherkin `And` clauses and non-side-effects to `And no ...` clauses. Missing or vague side effects produce incomplete test coverage.

### Three Categories

**Events:**
```
- `{domain}.{entity}.{verb}` event published with payload `{field1, field2}`
```

**Database writes:**
```
- `{table}` table: {row created/updated/deleted} with {key fields}
```

**Non-side-effects (explicit):**
```
- No {notification/email/webhook/event} sent
```

### Rules

- Every scenario must have at least one side effect or at least one non-side-effect. A scenario that changes nothing is not a scenario.
- Non-side-effects start with "No" and name the thing that does NOT happen.
- Non-side-effects are just as important as side effects -- they tell the Tester agent what to assert does NOT occur.
- Event names follow `{domain}.{entity}.{verb}` convention (e.g., `auth.session.created`, `billing.invoice.sent`).
- Payload fields are listed in backtick-wrapped comma-separated format.

## Gherkin Mapping

This table defines how UC elements map to Gherkin output for the Tester agent.

| UC Element | Gherkin Output |
|------------|----------------|
| UC `Preconditions` | `Background: Given ...` |
| UC `Gherkin Tags` | `@FEAT-XXXX @UC-XXXX` on Feature line |
| Scenario `Given` | Additional `Given` / `And` after Background |
| Scenario `Steps` | `When` / `And` clauses |
| Scenario `Outcomes` | `Then` clauses |
| Scenario `Side Effects` (positive) | `And` clauses |
| Scenario `Side Effects` ("No ...") | `And no ...` clauses |

## YAML Frontmatter Schema

| Field | Type | Rules |
|-------|------|-------|
| `id` | string | `UC-XXXX` -- 4-character timestamp ID |
| `name` | string | Verb-noun goal phrase (e.g., "Create Feature") |
| `feature` | string | Parent feature ID: `FEAT-XXXX` |
| `status` | enum | `pending` when first created. Lifecycle: pending, implemented, dirty, deprecated |
| `version` | integer | Starts at `1`. Incremented by /m:plan on each edit |
| `actor` | string | Primary actor role (must exist in prd/ACTORS.md) |
| `tag` | string | `@UC-XXXX` -- used for Gherkin scenario filtering |

## UC-XXXX ID Assignment

When creating a new use case, generate a unique ID using a 4-character timestamp code.

**How to generate the ID:**
Run: `node ${CLAUDE_PLUGIN_ROOT}/shared/skills/id-generation/scripts/generate-id.js`
Prepend `UC-` to the output (e.g., `UC-0S9A`).

**IDs are permanent.** Once assigned, a UC-XXXX ID is never reused, even if the use case is deprecated.

## Slug Generation

Use case slugs follow the same rules as feature slugs (defined in the feature-authoring skill): lowercase, hyphens for spaces, strip non-alphanumeric, collapse hyphens, max 40 chars at word boundary. The slug is derived from the confirmed use case name.

**Examples:**
- "Login Flow" → `login-flow`
- "Create Feature" → `create-feature`

**Filename format:** `UC-XXXX-{slug}.md` (e.g., `UC-0S9A-login-flow.md`)

## USE-CASES.md Row Management

When creating a use case, add a new row to the feature's `USE-CASES.md`:

```
| UC-XXXX | {Use Case Name} | {One-sentence description} | pending | [UC-XXXX-{slug}.md](use-cases/UC-XXXX-{slug}.md) |
```

**Column rules:**
- **ID:** `UC-XXXX` -- the generated ID
- **Name:** Verb-noun goal phrase (matches frontmatter `name`)
- **Description:** One sentence -- enough for an agent to identify this use case
- **Status:** Always `pending` when first created
- **File:** Relative Markdown link to `use-cases/UC-XXXX-{slug}.md`

**When updating a use case,** do NOT change the ID. Update Status only when the use case advances through its lifecycle.

## Creation Interview

**All user interaction MUST use the AskUserQuestion tool.** Never ask questions as plain text. This keeps the agent in control of the flow throughout the interview.

The creation interview extracts structured content from the user's freeform input and presents it section-by-section for review. Files are only written after all sections are confirmed.

### Step 1: Extract from Input

From the user's freeform input, attempt to extract:
- Use case name (verb-noun goal)
- Primary actor
- Preconditions
- Trigger
- Scenarios (each with Given, Steps, Outcomes, Side Effects)

Cross-reference `prd/ACTORS.md` to validate the actor exists.

### Step 2: Review Shared Context

For each shared section, use AskUserQuestion to present what was extracted and ask for confirmation.

Present shared context in this order:
1. Use case name
2. Primary actor
3. Preconditions
4. Trigger

**If the input covered the section:**
"For {section name}, this is what I extracted:\n\n{content}\n\nDoes this look correct?"
- Options: "Yes, looks good" / "Edit" (user provides corrections via Other)

**If the input did NOT cover the section:**
"I didn't find any {section name} in your description. Can you provide them?"
- Options: "Yes, I'll add them" (user provides via Other) / "Skip for now"

### Step 3: Review Scenarios

For each scenario extracted from the input, present the full scenario block (Given, Steps, Outcomes, Side Effects) and ask for confirmation.

"Here is Scenario {N}: {Name}\n\n**Given:**\n{given}\n\n**Steps:**\n{steps}\n\n**Outcomes:**\n{outcomes}\n\n**Side Effects:**\n{side_effects}\n\nDoes this look correct?"
- Options: "Yes, looks good" / "Edit" (user provides corrections via Other)

After the scenario is confirmed, ask about UI for this scenario:
"Does this scenario have a user interface? If so, describe the screen state at the key step and I'll generate an ASCII art mockup."
- Options: "I'll describe the UI" (user provides via Other) / "No UI for this scenario"

If the user describes UI, generate an ASCII art mockup, present it for confirmation via AskUserQuestion, and note which step it belongs to. If the user provides image file paths, note them for the Write Files step.

For the **Side Effects** field specifically, always remind the user:
"Include both side effects (events published, DB writes) AND explicit non-side-effects (things that do NOT happen). Non-side-effects become 'And no ...' assertions in Gherkin tests."

After reviewing all extracted scenarios, ask:
"Would you like to add another scenario?"
- Options: "Yes" (user describes the scenario via Other) / "No, that's all"

Repeat the scenario review loop until the user confirms they have no more scenarios.

### Step 4: Write Files

After all sections are confirmed:
1. Generate UC-XXXX ID (4-character timestamp code)
2. Create `prd/domains/{domain}/features/FEAT-XXXX-{slug}/use-cases/` directory if it does not exist
3. If any scenario has image files, create `prd/domains/{domain}/features/FEAT-XXXX-{slug}/use-cases/assets/` and copy images with `{UC-ID}-{descriptive-slug}.{ext}` naming
4. Write `UC-XXXX-{slug}.md` using [UC-template.md](./templates/UC-template.md) -- fill all sections with confirmed content, include inline `**UI:**` blocks within Steps for scenarios that have UI, set frontmatter status to `pending`, version to `1`
6. Add row to the feature's `USE-CASES.md`

## Update Mode

/m:plan uses this skill in update mode:
- Read the current UC file
- Compare with the user's change description
- Propose specific changes via AskUserQuestion ("Here's what I'd change:\n\n{diff}\n\nDoes this look correct?")
- Apply after confirmation
- Increment `version` in frontmatter
- Set `status` to `dirty` in frontmatter
- Update the status column in USE-CASES.md
- Do NOT run the creation interview
- Do NOT change the UC-XXXX ID or tag

## Template Reference

| Template | Purpose |
|----------|---------|
| [UC-template.md](./templates/UC-template.md) | UC file for each use case |
