# Project Instructions

## About This Project

Molcajete.ai is a Claude Code plugin for spec-driven software development. It provides three phases — **spec**, **plan**, and **build** — that turn a product idea into working, tested software.

**How it works:**
- A `PRD/` folder holds the permanent spec: project description, features, use cases, and scenarios (in Gherkin). This is the source of truth — not throwaway documents.
- **Spec** authors the product spec — features with EARS requirements, use cases with scenario blocks, and Gherkin feature files.
- **Plan** decomposes use cases into an implementation plan — ordered tasks with dependencies and done signals.
- **Build** picks up a plan and runs a looping dispatch that implements, validates (BDD tests as the done signal), and commits — session by session — until all scenarios pass.
