# Reygent Workflow

Visual diagrams of the reygent workflow, decision flows, and agent interactions.

## Full Workflow Overview

The complete reygent workflow from spec input to reviewed pull request:

```mermaid
flowchart TD
    A[Spec Input] --> B{Source Type?}
    B -->|Markdown file| C[Read .md file]
    B -->|Issue key| D{Which tracker?}
    B -->|Linear URL| F[Linear API]
    D -->|LINEAR_API_KEY set| F
    D -->|JIRA_* vars set| E[Jira API]

    C --> G[Parsed Spec]
    E --> G
    F --> G

    G --> H[Stage 1: Plan]
    H --> I[Stage 2: Implement]
    I --> J[Stage 3: Unit Test Gate]
    J --> K[Stage 4: Functional Test Gate]
    K --> L[Stage 5: Security Review]
    L --> M[Stage 6: PR Create]
    M --> N[Stage 7: PR Review]
    N --> O[Done]

    style A fill:#4a9eff,color:#fff
    style O fill:#22c55e,color:#fff
    style H fill:#8b5cf6,color:#fff
    style I fill:#8b5cf6,color:#fff
    style J fill:#f59e0b,color:#000
    style K fill:#f59e0b,color:#000
    style L fill:#ef4444,color:#fff
    style M fill:#06b6d4,color:#fff
    style N fill:#06b6d4,color:#fff
```

## Planner Clarification Loop

How the planner resolves ambiguous specs:

```mermaid
flowchart TD
    A[Spec] --> B{Skip clarification?}
    B -->|Yes| C[Run planner with\nassumption mode]
    B -->|No| D[Run planner]

    D --> E{Result?}
    E -->|Valid plan| F[Return plan]
    E -->|Needs clarification| G[Display questions\nto user]

    G --> H{User answers}
    H -->|Answers provided| I[Re-run planner\nwith answers]
    H -->|User types abort| J[Exit]

    I --> K{Attempt < 3?}
    K -->|Yes| E
    K -->|No| L[Fail: max attempts]

    C --> M{Valid plan?}
    M -->|Yes| F
    M -->|No| L

    style F fill:#22c55e,color:#fff
    style J fill:#ef4444,color:#fff
    style L fill:#ef4444,color:#fff
```

## Implementation Stage

Dev and QE agent execution based on mode:

```mermaid
flowchart TD
    A[Plan + Spec] --> B{Auto-approve?}

    B -->|Yes| C[Parallel Execution]
    C --> D[Dev Agent]
    C --> E[QE Agent]
    D --> F[Promise.all]
    E --> F

    B -->|No| G[Sequential Execution]
    G --> H[Dev Agent\nstdin inherited]
    H --> I[QE Agent\nstdin inherited]
    I --> F

    F --> J[Merge outputs\ninto TaskContext]

    style C fill:#8b5cf6,color:#fff
    style G fill:#f59e0b,color:#000
```

## Test Gate Retry Flow

What happens when tests fail:

```mermaid
flowchart TD
    A[Run Test Gate] --> B{Passed?}
    B -->|Yes| C[Continue workflow]
    B -->|No| D{Auto-approve?}

    D -->|Yes| F[Auto-retry]
    D -->|No| E{User: Retry?}
    E -->|No| G[Exit]
    E -->|Yes| F

    F --> H[Re-run agents with\nfailure context injected]
    H --> I{Which gate failed?}
    I -->|Unit tests| J[Re-run: dev only]
    I -->|Functional tests| K[Re-run: dev + qe]

    J --> L[Re-run gate]
    K --> L

    L --> M{Passed?}
    M -->|Yes| C
    M -->|No| N{Attempts < max?}
    N -->|Yes| F
    N -->|No| O[Fail: max retries]

    style C fill:#22c55e,color:#fff
    style G fill:#ef4444,color:#fff
    style O fill:#ef4444,color:#fff
```

## Security Review Decision Flow

```mermaid
flowchart TD
    A[Run Security\nReviewer Agent] --> B[Parse findings]
    B --> C{Any finding >= threshold?}
    C -->|No| D[PASS - Continue]
    C -->|Yes| E{Auto-approve?}

    E -->|Yes| F[Bypass with warning\nContinue to PR]
    E -->|No| G{User: Continue anyway?}
    G -->|Yes| F
    G -->|No| H[Exit]

    style D fill:#22c55e,color:#fff
    style F fill:#f59e0b,color:#000
    style H fill:#ef4444,color:#fff
```

## PR Creation Flow

How reygent creates a pull request:

```mermaid
flowchart TD
    A[Start PR Create] --> B[Parse git remote URL]
    B --> C{Platform?}
    C -->|github.com| D[GitHub API]
    C -->|GitHub Enterprise| E[GHE API /api/v3]
    C -->|GitLab| F[GitLab API /api/v4]

    A --> G[Resolve auth token\nvia git credential fill]
    A --> H[Derive branch name\nfrom spec source]
    A --> I[Detect base branch]

    G --> J[Git Operations]
    H --> J
    I --> J

    J --> K[git add -A]
    K --> L[git checkout -b branch]
    L --> M[git commit]
    M --> N[git push -u origin branch]

    N --> D
    N --> E
    N --> F

    D --> O[PR Created]
    E --> O
    F --> O

    style O fill:#22c55e,color:#fff
```

## Branch Naming Convention

```mermaid
flowchart LR
    A[Spec Source] --> B{Type?}
    B -->|Jira| C["reygent/PROJ-123"]
    B -->|Linear| D["reygent/ENG-456"]
    B -->|Markdown| E["reygent/slugified-title"]
```

## Agent Spawning Internals

How each agent subprocess works:

```mermaid
sequenceDiagram
    participant R as Reygent Workflow
    participant C as Claude CLI Process
    participant FS as Filesystem

    R->>C: spawn claude -p <prompt> --output-format stream-json --verbose

    loop Stream JSON events
        C->>R: {"type":"assistant", "message":{...}}
        R->>R: Parse tool_use blocks (log: [agent] → ToolName detail)
        R->>R: Parse text blocks (display to user)
    end

    C->>FS: Read/Write/Edit files
    C->>R: {"type":"result", "result":"..."}
    R->>R: Extract structured JSON from result
    R->>R: Update TaskContext
```

## Complete Data Flow

How `TaskContext` flows through the reygent workflow:

```mermaid
flowchart TD
    subgraph TaskContext
        spec[spec: SpecPayload]
        plan[plan: PlannerOutput]
        impl[implement: ImplementOutput]
        gates[gates: GateOutput]
        sec[securityReview: SecurityReviewOutput]
        pr[prCreate: PRCreateOutput]
        rev[prReview: PRReviewOutput]
    end

    S1[Stage 1: Plan] --> plan
    spec --> S1

    S2[Stage 2: Implement] --> impl
    spec --> S2
    plan --> S2

    S3[Stage 3: Unit Tests] --> gates
    impl --> S3

    S4[Stage 4: Functional Tests] --> gates
    impl --> S4

    S5[Stage 5: Security] --> sec
    impl --> S5

    S6[Stage 6: PR Create] --> pr
    spec --> S6
    plan --> S6
    impl --> S6
    sec --> S6

    S7[Stage 7: PR Review] --> rev
    spec --> S7
    plan --> S7
    pr --> S7
```
