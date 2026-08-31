Yes. Since you’re already using a **ChatGPT Project**, I’d make one response inside the project your **Master Plan / source of truth**, save it as a project source, and then iterate it as our research progresses.

Projects are designed for exactly this: chats, files, saved responses, and project instructions can stay together, and chats inside the project can reference other project conversations. You can save a useful assistant response from its message menu with **Save to project / Add to project sources**. 

I would use the following as **v0.2**.

# Ask ONE — AI Search Proposal Master Plan

**Status:** Proposal / Discovery  
**Current version:** v0.2  
**Goal:** Obtain management approval to proceed with an Ask ONE MVP.

## 1. Proposal Objective

Investigate whether ONE should build an AI-powered search/self-service experience similar to Ask Maersk, but designed around:

- trusted ONE-owned information;
- strong correctness and grounding;
- transparent sources;
- enterprise guardrails;
- measurable quality;
- continuous improvement;
- the existing ONE GKE/GCP platform behind the existing Cloudflare edge;
- a clear evolution path from:
  **English single-question → eCommerce API integration → guided answers/support → multilingual/conversational access → broader service integrations**.

The delivery posture is deliberately incremental: start with the smallest useful governed experience, measure it, improve continuously, and expand only after quality, security, reliability, and incremental-AI cost gates pass.

We are **not designing the complete production implementation yet**.

The current goal is to collect enough evidence to answer:

> Is this valuable, feasible, safe, and worth approving as an MVP initiative?

---

# 2. Proposal Workstreams

We will work on **7 workstreams**, and the final manager proposal will summarize their findings.

## A. Ask Maersk Competitor Analysis

### Goal

Understand what Ask Maersk actually does, where it works well, and where ONE can improve.

### Main approach

Build a **browser-driven benchmark harness**, likely using Playwright.

```text
Question Dataset
      ↓
Browser Automation
      ↓
Ask Maersk
      ↓
Network + UI Capture
      ↓
Structured Benchmark Results
      ↓
Evaluation
```

### Capture

- question;
- answer;
- raw AI-search response;
- response time;
- citations/links;
- FAQs;
- related services;
- advisories/insights;
- clarification behavior;
- fallback behavior;
- screenshots;
- errors;
- language behavior.

### Test categories

- normal FAQs;
- paraphrased questions;
- shipping terminology;
- regional questions;
- current/recent information;
- ambiguous questions;
- unsupported questions;
- false premises;
- typos;
- long questions;
- multiple intents;
- non-English;
- transactional questions;
- prompt injection;
- follow-up attempts.

### Important investigations

We already discovered:

```text
enableClarification=true
languageCode=en
single-question UI; no multi-turn conversation observed
100-char UI limit
related FAQs
related services
related advisories
feedback controls
Redo
```

Continue investigating:

- raw `ai-search` response;
- clarification API behavior;
- Redo request;
- thumbs-up/down API;
- language handling;
- fallback/no-answer behavior;
- service-recommendation source;
- streaming behavior;
- other APIs used by Ask Maersk.

### Output

**Ask Maersk Benchmark Report**

Including:

- strengths;
- weaknesses;
- capability matrix;
- screenshots;
- benchmark scores;
- opportunities for ONE.

---

# 3. ONE Content & Product Readiness

### Goal

Determine whether ONE currently has enough authoritative information to power the experience.

Inventory:

- Drupal CMS;
- FAQs;
- Help content;
- service/product pages;
- regional/local information;
- advisories;
- documentation;
- uploaded documents;
- other public knowledge sources.

Determine:

- content ownership;
- authoritative sources;
- update frequency;
- locale/region metadata;
- outdated/duplicate content;
- Drupal synchronization capability.

### Key principle

The AI does not define truth.

```text
AI answer
   ↓
ONE source
   ↓
ONE content owner
```

### Output

**ONE Knowledge Readiness Assessment**

---

# 4. Golden Dataset & Evaluation

This is a core part of the platform, not something added after launch.

### Golden Dataset v1

Start approximately with:

**100–200 questions**

Cover:

- common questions;
- difficult questions;
- unsupported questions;
- current information;
- regional information;
- misleading questions;
- safety/adversarial questions.

Each test case conceptually has:

```text
Question
Expected facts
Expected source(s)
Should answer? YES / NO
Category
Risk level
```

### Evaluation layers

```text
                  Golden Dataset
                        │
          ┌─────────────┼──────────────┐
          ▼             ▼              ▼
        Ragas       Vertex Eval     Human Review
          │             │              │
          └─────────────┼──────────────┘
                        ▼
                  Quality Gate
```

### Ragas

Evaluate whether it provides value for:

- faithfulness;
- context precision;
- context recall;
- answer relevance;
- retrieval experiments;
- regression testing.

Ragas specifically provides RAG-oriented metrics including Context Precision, Context Recall, Faithfulness, and Response Relevancy, so it fits this project well. 

We should still combine it with:

- Vertex AI evaluation;
- deterministic citation, schema, policy, and regression checks;
- ONE-specific metrics;
- human review.

Ragas is an evaluation framework, not the release authority. LLM-judge metrics must be calibrated against human-rated Golden Dataset cases, and no single aggregate score can override a critical correctness or security failure.

### Human-in-the-loop

Human review should cover:

- negative feedback;
- questionable answers;
- high-risk questions;
- new intents;
- random production samples;
- content conflicts.

---

# 5. Continuous Improvement Loop

This should become one of the central design principles.

```text
                    Users
                      │
                      ▼
                   Ask ONE
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
     Feedback                     Metrics
        │                           │
        └──────────────┬────────────┘
                       ▼
                  Review Queue
                       │
                  Human Review
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
       Content problem        AI problem
             │                   │
        Drupal update       Retrieval /
                           Prompt / Model
             │                   │
             └─────────┬─────────┘
                       ▼
                Golden Dataset
                       │
                  Regression Eval
                       │
                   Quality Gate
                       │
                     Release
```

User feedback must **not automatically train/change the system**.

Feedback creates evidence.

Humans decide what should change.

---

# 6. Guardrails & Trust

Guardrails are a major workstream.

High-level defense:

```text
User
 ↓
Cloudflare authoritative DNS / CDN / WAF / DDoS / rate limiting
 ↓
Application validation
 ↓
Model Armor INPUT
 ↓
Retrieval / RAG
 ↓
Gemini
 ↓
Grounding / citation validation
 ↓
Model Armor OUTPUT
 ↓
User
```

Evaluate protection against:

- prompt injection;
- jailbreaks;
- sensitive data;
- malicious URLs;
- harmful content;
- unsupported answers;
- indirect prompt injection from RAG documents.

Also maintain a dedicated:

**Security / Adversarial Golden Dataset**

The proposal should cover:

- Model Armor;
- Cloudflare edge security and abuse controls;
- rate limiting;
- privacy;
- data retention;
- auditability;
- kill switch/fallback.

---

# 7. High-Level Cloudflare + GCP Architecture

Current **working architecture hypothesis**, not yet a final design:

```text
                     User
                      │
 Cloudflare authoritative DNS / CDN / WAF / DDoS
                      │
                      ▼
             Existing GKE ingress / API
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
     Memorystore   Model Armor    RAG
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
                Embeddings     Ranking      Retrieval
                   Vertex AI / Cloud SQL / managed RAG
                                  │
                                  ▼
                                Gemini
                                  │
                             Model Armor
                                  │
                                Answer
```

Knowledge pipeline:

```text
Drupal                     Knowledge HUB
   │                            │
   └──────────────┬─────────────┘
                  ▼
            Cloud Storage
                  │
               Pub/Sub
                  │
             RAG ingestion
                  │
              Vertex AI
                  │
             Search index
```

Candidate GCP components:

- Vertex AI / Gemini;
- Google Gen AI SDK;
- Model Armor;
- GKE;
- Cloud SQL PostgreSQL;
- Memorystore;
- Cloud Storage;
- Pub/Sub;
- BigQuery;
- Cloud Logging / Monitoring / Trace;
- Secret Manager;
- IAM / Workload Identity;
- possibly Vertex ranking/search/RAG services.

Edge boundary:

- Cloudflare remains the authoritative DNS, CDN, WAF, DDoS-protection, and rate-limiting layer.
- Google Cloud CDN and Google Cloud DNS are not proposed.
- Existing GKE and shared GCP platform services are reused rather than re-costed to Ask ONE.

### Important open decision

Do **not** prematurely select:

```text
Cloud SQL + pgvector

vs

Vertex managed retrieval / RAG
```

Validate during PoC.

---

# 8. Caching

Caching should be considered from the start, but correctness takes priority.

Initial concept:

```text
question
+
language
+
corpus version
+
prompt version
+
model configuration
        ↓
    Memorystore
```

Avoid aggressive semantic caching initially.

Content changes should invalidate old answers through corpus/version changes.

---

# 9. Knowledge & Quality HUB

The MVP Hub is intentionally a minimum operating control plane. It should support the source and release actions required for safe operation without becoming a large custom administration product.

Think:

## AI Knowledge & Quality Hub

MVP capabilities:

```text
Knowledge
- uploaded documents
- Drupal content
- ingestion status
- enable/disable
- reindex

Quality
- Golden Dataset
- evaluation runs
- failed evaluations

Operations
- feedback
- review queue
- release history
- audit trail
```

Future **Content Intelligence** capabilities inside the same Hub:

```text
- unanswered-intent and content-gap analysis
- stale or conflicting source detection
- FAQ and content-improvement suggestions
- emerging-topic and usage trends
- owner recommendations and prioritization
```

These are future additions, not MVP commitments. Suggested content or actions always require human review and approval.

---

# 10. KPI & Success Framework

We need measurable success criteria before asking management to fund an MVP.

## AI quality

- answer correctness;
- groundedness / faithfulness;
- answer relevance and completeness;
- citation correctness;
- citation coverage;
- unsupported-claim rate;
- context precision / recall and ranking quality;
- correct refusal rate;
- hallucination rate;
- guardrail effectiveness.

Use deterministic checks plus Ragas, Vertex AI Evaluation, and human review. The Golden Dataset remains the governing reference.

## Model and runtime diagnostics

- input and output token counts;
- time to first generated token;
- output tokens per second;
- model generation duration;
- p50/p95/p99 latency by retrieval, screening, model, validation, and response stages;
- model errors, retries, timeouts, and safety blocks;
- cost per question, completed turn, and successful grounded answer.

## User experience

- Helpful / Not Helpful;
- task success;
- response latency;
- source click-through;
- Redo rate;
- abandonment;
- no-answer rate.

## Knowledge quality

- content coverage;
- content freshness;
- unanswered intents;
- content gap rate;
- stale-content incidents.

## Reliability & safety

- availability;
- error rate;
- latency;
- rate-limit events;
- safety blocks;
- privacy/security incidents.

## Product impact

Later measure:

- adoption;
- repeat usage;
- self-service completion;
- support deflection;
- successful navigation toward ONE services.

### Important KPI

**Content Gap Rate**

Example:

```text
"How long is free time in Vietnam?"

Queries:            6,000
Successfully answered: 52%
```

That provides ONE's content teams with actionable evidence about what users need.

---

# 11. MVP Scope

Keep MVP deliberately narrow.

## MVP

```text
Anonymous
English
Single-question
Public ONE knowledge
Grounded answers
Visible sources
Relevant ONE links/services
User feedback
Drupal synchronization
Knowledge HUB
Evaluation
Guardrails
Rate limiting
Caching
Monitoring
Buffered, citation-verified and output-screened final answer
```

## Not MVP

```text
Multilingual
Multi-turn conversation
Authenticated personalization
Shipment data
Booking actions
Invoices
Agents
Complex tool calling
Raw answer-token streaming
Content Intelligence automation
```

The MVP may stream non-content progress events such as "Searching approved content" and "Checking sources", but it should not expose model tokens before citation validation and output screening complete.

---

# 12. Option-Preserving Expansion Roadmap

These are important enough that the MVP should prepare for them.

```text
MVP
English + single-question
        │
        ▼
Phase 2
Authorized eCommerce APIs
Booking / Schedule / Shipment
        │
        ▼
Phase 3
Guided answers
Clarification / source comparison
        │
        ▼
Phase 4
Connected support
Smart handoff / opt-in alerts
        │
        ▼
Phase 5
Broader access
Languages / conversation / services
```

These are expansion options, not promises or a concrete delivery timeline. Each capability receives its own feasibility, security, quality, and cost approval.

Future Content Intelligence capabilities remain inside the existing Hub. Voice is research-only and is not part of the committed roadmap.

Therefore:

- content must contain locale metadata;
- evaluation must eventually support multilingual datasets;
- session/conversation concepts shouldn't be architecturally impossible;
- Ragas/evaluation should support future multi-turn testing.

## GCP AI cost scope

Finance evaluates the variable GCP AI consumption introduced by Ask ONE: Vertex AI model input/output tokens, Model Armor screening, and retrieval/embedding/reranking/evaluation usage. The feasibility assessment should measure cost per question, browser-completed turn, and successful grounded answer, then use those measurements to set an AI budget envelope. Each later capability receives its own cost gate before activation.

---

# 13. Proposal Discovery Team

Available overall:

```text
12 Developers
4 QA
2 BA
```

During **proposal/discovery**, use only a small subset.

Suggested:

```text
2–3 Developers
1 QA
1 BA
```

with consultation from:

- security;
- cloud/platform;
- CMS/content;
- UX;
- privacy/compliance.

The full team should not start building until approval.

---

# 14. Proposal-Stage Execution Order

### Step 1 — Competitor research

Build question taxonomy.

### Step 2 — Browser benchmark

Build lightweight Maersk reverse-engineering/benchmark tool.

### Step 3 — Maersk analysis

Run the dataset and identify strengths/gaps.

### Step 4 — ONE readiness

Inventory content and high-value use cases.

### Step 5 — Golden Dataset v1

Define our quality baseline.

### Step 6 — Evaluation strategy

Validate Ragas + Vertex Evaluation + HITL approach.

### Step 7 — Security strategy

Define guardrails, Model Armor and major threats.

### Step 8 — Small PoC

Prove:

```text
ONE content
→ retrieval
→ Gemini
→ grounded answer
→ citations
→ guardrail
→ evaluation
```

This is **not the MVP**.

### Step 9 — KPI baseline

Define what success means and establish benchmark values.

### Step 10 — High-Level Design

Select the proposed GCP architecture at an appropriate level.

### Step 11 — Risks & roadmap

Show major risks and mitigation.

### Step 12 — Manager presentation

Request approval for MVP.

---

# 15. Approval Gate

Everything before this line supports the decision:

```text
            ┌────────────────────┐
            │ MANAGEMENT REVIEW  │
            └──────────┬─────────┘
                       │
               APPROVE / REJECT
                 │           │
                 ▼           ▼
              Build MVP     Stop
```

Only after approval do we spend time on:

- detailed APIs;
- schemas;
- chunking;
- detailed prompts;
- Kubernetes sizing;
- detailed stories;
- Jira breakdown;
- CI/CD;
- detailed implementation plan.

---

# 16. Current Open Questions

Maintain this section continuously.

Current items:

1. What exactly does Maersk's `enableClarification=true` do?
2. What does the complete `ai-search` API response look like?
3. How does Maersk feedback work?
4. How does Maersk handle unsupported questions?
5. How fresh is its search index?
6. Is language restriction frontend-only or backend-enforced?
7. Which ONE content sources are authoritative?
8. What analytics/customer-service question data can ONE provide?
9. Cloud SQL/pgvector vs managed Vertex RAG/search?
10. What ONE security/privacy standards must the solution meet?
11. Which languages should immediately follow English?
12. What should qualify as management-level MVP success?

---

# 17. Decision Log

We'll keep important conclusions here so they don't get lost across chats.

### Confirmed

- Proposal first; detailed implementation after approval.
- MVP should start English-only.
- MVP should start single-question; the observed Ask Maersk experience is also single-question and no multi-turn conversation was observed.
- Browser-driven Ask Maersk benchmark is preferred.
- Golden Dataset is required.
- Human-in-the-loop quality review is required.
- User feedback should feed continuous improvement.
- Guardrails are a first-class requirement.
- Evaluation should investigate Ragas + Vertex evaluation.
- GCP should be used extensively.
- Cloudflare remains the DNS/CDN/security edge; Google CDN and Google DNS are not proposed.
- Existing GKE/GCP and Cloudflare costs are not reallocated to the proposal; finance focuses on incremental Vertex AI, Model Armor, and retrieval usage.
- Caching should be supported.
- eCommerce APIs, guided clarification, source transparency, smart handoff, opt-in alerts, multilingual support, conversation, and more services remain separately gated expansion options.
- The MVP Hub is a minimum source/release control plane; Content Intelligence features are future additions inside the same Hub.
- Raw answer-token streaming is excluded from the MVP; only non-content progress events may stream before the complete answer passes validation and output screening.
- Voice remains research-only and is not part of the committed roadmap.

### Under evaluation

- Retrieval architecture.
- Exact MVP KPI thresholds.
- Ragas's exact role.
- Exact future Content Intelligence scope and trigger for investment.
- Exact PoC architecture.
- Initial multilingual rollout order.

---

## How to keep this plan “sticky” inside your Project

Do this **now**:

1. Open the `...` menu on this response.
2. Choose **Save to project** / **Add to project sources**.
3. Treat it as `Ask ONE — Master Plan v0.1`.

Saved responses can be reused by future conversations in the project, and project chats can also reference other chats within the same project. 

I would also put this in **Project settings → Project instructions**:

> Treat the saved “Ask ONE — Master Plan” as the source of truth for this initiative. We are currently in proposal/discovery, not detailed implementation. When new research changes an assumption, explicitly identify the change and propose an update to the Master Plan. Preserve a Decision Log and Open Questions section. Prioritize management-level business, product, architecture, trust, evaluation and roadmap information until MVP approval.

Project instructions apply throughout that project and are specifically intended for persistent project-specific guidance. 

### How we iterate from now on

You can create separate chats such as:

```text
Ask ONE — Maersk Research
Ask ONE — Golden Dataset
Ask ONE — GCP Architecture
Ask ONE — Guardrails
Ask ONE — KPI
Ask ONE — Ragas Evaluation
Ask ONE — Manager Presentation
```

After we discover something important, come back here—or even from another chat in the same Project—and say:

> **Update Master Plan with what we learned from the Maersk research.**

or:

> **Reconcile our latest architecture discussion with Master Plan v0.1 and produce v0.2.**

I'll consolidate the new decisions instead of rebuilding the proposal from scratch.

For major milestones, save another source:

```text
v0.1 — Initial direction
v0.2 — Maersk benchmark completed
v0.3 — Golden Dataset + eval decided
v0.4 — PoC results
v0.5 — Architecture proposal
v1.0 — Manager approval deck source
```

I prefer this **versioned approach** over relying solely on Project memory: Project memory is useful for context, but the Master Plan gives us an explicit, reviewable source of truth. Projects are specifically designed to preserve related chats, files, saved responses, and instructions across long-running work. 

When we're ready for the presentation, we can build it from **Master Plan v1.0**, so the slides become the final summary of all the work rather than another independent version of the proposal.
