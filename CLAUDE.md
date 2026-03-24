# Project Instructions

## About This Project

Molcajete.ai is a Claude Code plugin for spec-driven software development. It provides two commands — **plan** and **build** — that turn a fixed product spec into working, tested software.

**How it works:**
- A `PRD/` folder holds the permanent spec: project description, features, use cases, and scenarios (in Gherkin). This is the source of truth — not throwaway documents.
- **Plan** decomposes work into features, use cases, and scenarios, adding them to the PRD spec.
- **Build** picks up unimplemented specs and runs a looping dispatch that implements, validates (BDD tests as the done signal), and commits — session by session — until all scenarios pass.
