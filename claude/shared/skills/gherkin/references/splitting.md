# Per-UC File Size Check

This procedure runs after generation and indexing. Each `.feature` file represents exactly one use case; if a UC has grown beyond the scenario budget, the right remedy is usually authoring sub-UCs in the PRD — not auto-splitting the Gherkin file.

## Count Scenarios

1. Read the target UC's `.feature` file (the one just created or appended to).
2. Count the total number of `Scenario:` and `Scenario Outline:` blocks.
3. If the count is **15 or fewer**, skip the rest of this procedure — proceed to the Summary Output.

## Warn and Proceed

If the count exceeds 15, this UC is likely trying to do too much. Do NOT auto-split and do NOT auto-promote — this session is non-interactive, so no user prompt is possible, and both remedies require human judgment.

Instead, emit a warning as an action item in the summary output and proceed (keep the file as-is):

> "UC-XXXX ({UC name}) now has {N} scenarios — more than the 15-scenario guideline. Large UCs usually signal the PRD use case should be decomposed into smaller UCs. Recommended action: run `/m:update-feature` to split the UC into multiple UCs, then regenerate Gherkin. As an escape hatch, the UC's `.feature` can be promoted to a subdirectory by concern (see 'Escape Hatch' below) — but only when invoked from an interactive session."

Then proceed without mutation.

## Escape Hatch: Promote a Single UC File to a Subdirectory

This branch is **never** executed from a non-interactive session. It is documented here only as reference for interactive sessions (the `m` plugin) that share this skill. When invoked interactively, the user explicitly chooses this option, conceding that the UC stays whole in the PRD but its Gherkin needs internal organization.

1. **Group scenarios by concern.** Read all scenario names, tags, and step patterns. Apply these heuristics:
   - Scenarios sharing a specific classification tag → same group.
   - Scenarios testing the same sub-flow (happy path + its edge cases) → same group.
   - Scenarios sharing identical Given/Background setup → likely same group.
   - Aim for 5–10 scenarios per group. Avoid single-scenario groups unless the scenario is truly standalone.

2. **Create the UC subdirectory:** `bdd/features/{module}/{domain}/{UC-XXXX}-{uc-slug}/` (same name as the original file, without extension).

3. **Create sub-files inside the subdirectory:** one `.feature` (or `.feature.md`) per concern group:
   - Filename: kebab-case name reflecting the concern (e.g., `happy-path.feature`, `edge-cases.feature`, `error-handling.feature`).
   - Each sub-file must have its own `Feature:` line (sub-aspect of the UC name), the same feature-level tags as the original (including `@FEAT-XXXX` and `@UC-XXXX`), and a description.
   - If scenarios in the group share preconditions, add a `Background:` block.
   - Preserve all scenario tags, steps, and examples exactly.
   - **Prohibited names:** `part-1.feature`, `scenarios-1-to-7.feature`, `misc.feature`, or any numeric/ordinal name.

4. **Delete the original single UC file:** remove `bdd/features/{module}/{domain}/{UC-XXXX}-{uc-slug}.feature`.

5. **Update `bdd/features/INDEX.md`:** replace the single UC entry with a subdirectory entry listing each sub-file and its scenarios:
   ```markdown
   #### {UC Name} ({UC-XXXX})
   - **Directory:** `{module}/{domain}/{UC-XXXX}-{uc-slug}/`
   - **Parent feature:** {FEAT-XXXX} — {Feature Name}
   - **Summary:** {UC objective}
   - **Files:**
     - `{sub-file}.feature` — {concern description}
       - {Scenario name} — {brief description}
     - `{sub-file}.feature` — {concern description}
       - {Scenario name} — {brief description}
   ```

6. **Update the summary:** Set the "Action" field to "Promoted to UC subdirectory" and list the sub-files created. Note that the UC still represents one PRD use case; the subdirectory is a purely organizational Gherkin concession.
