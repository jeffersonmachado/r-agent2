
# Architecture Diagrams

## Core Operational Loop

```mermaid
flowchart LR
Events --> State
State --> Decision
Decision --> Execution
Execution --> Learning
Learning --> State
```
