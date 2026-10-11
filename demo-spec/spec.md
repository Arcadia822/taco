---
title: Taco Dynamic Preview Demo Spec
status: active
---

## Overview

This specification demonstrates Taco's single-file specification review capabilities, featuring rich Markdown documents, Checkpoints, and interactive Mermaid diagrams.

### Architecture Workflow

```mermaid
flowchart TD
    A[Spec Markdown Canonical] --> B[Taco Single File Pack]
    B --> C{Human Review}
    C -->|Anchor Comments| D[Handoff Diff]
    C -->|In-place Edits| D
    D --> E[Agent Canonical Sync]
```

### Protocol Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Alice as Human Reviewer
    actor Bob as Coding Agent
    participant Taco as Taco Container
    Alice->>Taco: Open single file in browser
    Alice->>Taco: Click Mermaid flowchart node
    Taco-->>Alice: Highlight source line & show comment toolbar
    Alice->>Bob: Handoff feedback
    Bob->>Taco: Refresh bundle
```
