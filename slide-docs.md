# Ask ONE management deck — source document

Status: manager-optimized, evidence-first narrative  
Audience: finance, business, security, product, operations, and technical managers  
Decision requested: approve a scoped feasibility assessment and its evidence gates; consider a public MVP only after those gates pass  
Communication job: management should understand the competitive benchmark, the smallest feasible ONE response, the controls that make it safe, and the evidence required before expansion.

## Narrative and visual direction

- Open with the decision, then summarize the Ask Maersk benchmark and its implication for ONE.
- Use the light ONE visual language from `../payloadcms-demo-main/apps/slides`: Noto Sans, white paper, ONE magenta, warm dark ink, thin rules, and restrained panels.
- Use `slides/public/one-logo.svg` on the cover and in the running footer.
- Keep visible copy manager-readable; pair technical terms with their operational or financial meaning.
- Treat Ask Maersk respectfully as a credible benchmark. Do not infer unseen competitor architecture, quality, security, adoption, or economics.
- Treat security, observability, the Hub, continuous improvement, and the Golden Dataset as operating-model requirements.
- Keep cost qualitative at this stage: show the Vertex AI and model cost drivers, controls, and outcome-based unit measures without a fixed estimate.

## Scope assumptions

- ONE already operates GKE and supporting GCP services.
- Cloudflare remains the authoritative DNS, CDN, WAF, DDoS-protection, and rate-limiting edge; Google CDN and Google DNS are not proposed.
- The initial experience is anonymous, English, public knowledge, and single-question.
- Current sources are the CMS serving `www.one-line.com` and governed Hub uploads.
- Booking, schedule, and shipment APIs from ONE eCommerce are a next-release option through an authorized live-tool lane.
- More languages, controlled conversation, additional services, and Content Intelligence inside the Hub are later options.
- Voice remains research-only.

## Slide 1 — A measured path to AI self-service

Primary claim: ONE can use a visible market benchmark to assess a comparable, controlled, and measurable customer experience.

## Slide 2 — Approve a small, governed feasibility assessment

Primary claim: the opportunity is credible, the first scope is intentionally narrow, and larger investment remains conditional.

Visible content:

- Start: English, single-question, CMS content, and governed Hub uploads.
- Prove: quality, safety, reliability, readiness, observability, and AI cost.
- Decide: expand only when evidence supports it.
- Decision today: approve evidence-building, not a full production commitment.

## Slide 3 — Ask Maersk sets a credible self-service benchmark

Primary claim: the public English experience blends an answer with useful discovery and fallback patterns.

Visible content:

- AI answer plus Top FAQs, Popular services, Insights, and related links.
- Feedback, copy, redo, standard search, support, and Help Centre routes.
- Unsupported questions receive rephrasing guidance and useful alternatives.
- English, single-question, and apparently non-streaming were observed; multi-turn conversation was not observed.
- Use the visible experience as a design benchmark, not a competitor scorecard.

## Slide 4 — Target comparable usefulness with stronger operating evidence

Primary claim: ONE should first match the useful customer pattern, own its operating model, and prove outcomes before claiming improvement.

Visible content:

- Match: public knowledge, FAQs, services, insights, links, and fallback.
- Own: governed CMS/Hub sources, citations, versions, owners, and rollback.
- Prove: security, browser completion, answer quality, observability, and cost per successful outcome.

## Slide 5 — The first experience should feel simple and familiar

Primary claim: the customer receives a grounded answer and useful next step—or a clear fallback.

Visible content:

- Ask an English public-knowledge question.
- Return a grounded answer with citations and related content.
- Continue to a FAQ, service, insight, search, or support route.
- Buffer the complete answer, verify citations, screen the output, then display it; raw answer-token streaming is not proposed for the MVP.

## Slide 6 — Start small and prove the four things that matter

Primary claim: a focused assessment should prove usefulness, safety, reliability, observability, and affordability before a public MVP decision.

Visible content:

1. Useful and grounded: supported answer, relevant referral, or safe fallback.
2. Safe: critical attack and sensitive-data cases are blocked or refused.
3. Reliable and observable: one query ID explains the complete turn.
4. Affordable: AI model and Vertex usage are measured per outcome.

Decision rule: pass the agreed gates, consider a public MVP; miss a critical gate, remediate once or stop.

## Slide 7 — Start with one useful, governed experience

Primary claim: the first scope creates useful evidence without introducing customer-data or transactional risk.

Prove now:

- Anonymous, English, single-question.
- CMS content serving `www.one-line.com` and governed Hub uploads.
- Grounded answers, visible sources, related links, feedback, evaluation, guardrails, exact cache, source lineage, observability, and the minimum Hub.

Add after proof:

- Next: authorized booking, schedule, and shipment APIs.
- Guided clarification, source comparison, answer transparency, smart support handoff, and opt-in alerts.
- More languages, controlled conversation, more services, and Hub intelligence.
- Voice and transactions remain research-only/TBD/TBC.

## Slide 8 — Reuse the existing platform and add governed AI capability

Primary claim: Cloudflare remains the edge and GKE/GCP remains the origin; Ask ONE adds governed RAG, model security, and Vertex AI.

Technical content:

- Next.js frontend and Node.js API/Hub on GKE.
- Cloudflare DNS/CDN/WAF/DDoS/rate limiting.
- Model Armor input/output screening and Gemini on Vertex AI through the Google Gen AI SDK.
- Cloud Storage versions, Cloud SQL/PostgreSQL as operational record and initial vector candidate, Pub/Sub ingestion, and exact version-aware cache.
- CMS and Hub uploads in the knowledge lane; eCommerce APIs later in a separately authorized live-tool lane.
- Query-level observability for quality, safety, latency, and cost.

Visual: editable draw.io GCP architecture using official product icons.

## Slide 9 — Security is a chain, not a model setting

Primary claim: an answer returns only after network, request, source, grounding, output, and audit controls pass.

Control chain:

1. Cloudflare edge controls.
2. Node.js request validation.
3. Model Armor input screening.
4. Allowlisted public corpus and least-privilege identities.
5. Grounded generation from retrieved context.
6. Citation and source-version validation.
7. Model Armor output screening.
8. Audit event and kill switch.

Failure behavior: safe refusal or standard search fallback.

## Slide 10 — Improve continuously through governed releases

Primary claim: every source and change follows a controlled path into RAG; feedback never trains the system automatically.

Visible content:

- Register, quarantine, validate, process, review, and publish immutable source versions.
- Version dataset, corpus, prompt, retrieval configuration, and model together.
- Evaluate with the Golden Dataset/Database, Ragas, Vertex AI Evaluation, deterministic checks, safety tests, and human review.
- Release, remediate, stop, or rollback based on evidence.

Terminology: the Golden Dataset is the governed evaluation asset; the Golden Database stores its registry and review history in Cloud SQL.

## Slide 11 — The Hub gives ONE control over knowledge and improvement

Primary claim: one Hub starts as a minimum control plane and can later grow into Content Intelligence.

Minimum Hub now:

- Source control: registry, owners, CMS sync, and Hub uploads.
- Governed releases: review, approve, publish, disable, and rollback.
- Evidence and audit: Golden Dataset/Database results, RBAC, and history.

Future Content Intelligence inside the same Hub:

- Content-gap analysis and unanswered-intent trends.
- Stale or conflicting-source detection.
- FAQ drafts, prioritization, and improvement suggestions with human approval.

Accountable roles: content, product, QA, security, operations, and finance.

## Slide 12 — One query ID explains outcome, risk, latency, and cost

Primary claim: observability must connect the browser-visible result to every downstream decision.

Visible content:

- Experience: completion, source click, helpfulness, and abandonment.
- Retrieval: context precision/recall, ranking, and empty retrieval.
- Answer quality: correctness, faithfulness, relevance, completeness, and citations.
- Model/runtime: input/output tokens, time to first generated token, tokens per second, generation duration, errors, and safety disposition.
- Evaluation backbone: Golden Dataset, Ragas, Vertex AI Evaluation, deterministic checks, and human review.
- Manager view: grounded success, cost per successful answer, latency by stage, and regression alerts.

## Slide 13 — Public launch requires all four gates to pass

Primary claim: averages cannot hide high-risk failures.

Proposed gates to ratify:

- Quality: citation correctness and grounded correctness.
- Safety: all critical attack cases safe and high correct-refusal performance.
- Reliability: browser completion and p95 latency.
- Readiness and cost: governed priority content and operation within the approved AI budget envelope.
- Any unresolved critical security case blocks launch.

Operating measures include retrieval quality, answer quality, token use, generation speed, task success, helpfulness, source click-through, no-answer rate, abandonment, content gaps, incidents, and support deflection.

## Slide 14 — AI cost scales with Vertex usage and remains controllable

Primary claim: finance can govern GCP AI cost through usage controls and outcome-based unit measures before scale.

Primary cost drivers:

- Vertex AI model choice, request volume, and input/output tokens.
- Embeddings, retrieval, reranking, and evaluation workloads.
- Model Armor input/output screening.

Control levers:

- Token caps and prompt discipline.
- Model routing by task and batch evaluation.
- Version-aware exact caching.
- Budgets, anomaly alerts, and separate approval for future capabilities.

Decision measures: cost per question, completed turn, successful grounded answer, and quality gained per AI spend. The budget envelope is set from measured Vertex usage rather than a fixed estimate in this deck.

## Slide 15 — Start small now; expand the interaction later

Primary claim: prepare clean seams now and add capability only when evidence supports it.

Expansion sequence:

1. Single-question public knowledge.
2. Authorized eCommerce APIs.
3. Guided clarification, source comparison, and transparency.
4. Smart handoff and opt-in alerts.
5. More languages, controlled conversation, additional services, and Content Intelligence; voice remains research-only.

## Slide 16 — Approve the evidence-building step

Primary claim: the proposal asks management to approve the small decision that creates evidence for the larger one.

Decision requested:

1. Approve the feasibility scope, Golden Dataset, controls, and measurable gates.
2. Name owners from product, content, security, platform, QA, and finance.
3. Require a review using quality, safety, reliability, readiness, observability, and AI cost per successful answer.
4. Consider public MVP funding only after that evidence is available.

## Diagram deliverables

- `slides/public/diagrams/ask-one-gcp-architecture.drawio.svg`
- `slides/public/diagrams/ask-one-security-chain.drawio.svg`
- `slides/public/diagrams/ask-one-knowledge-quality-loop.drawio.svg`
- `slides/public/diagrams/ask-one-hub-operating-model.drawio.svg`

Each SVG contains embedded draw.io XML, Google Cloud product icons where applicable, and the Cloudflare mark for the internet edge.

## Source register

Internal:

- `reports/maersk-research-2026-08-31.md`
- `docs/plan.md`
- Visual reference: `../payloadcms-demo-main/apps/slides`

External primary sources:

- ONE website: https://www.one-line.com/
- ONE eCommerce portal: https://ecomm.one-line.com/one-ecom
- Cloudflare secure application delivery: https://developers.cloudflare.com/reference-architecture/design-guides/secure-application-delivery/
- Google Cloud icon library: https://cloud.google.com/icons
- Vertex AI generative AI: https://cloud.google.com/vertex-ai/generative-ai/docs
- Vertex AI pricing dimensions: https://cloud.google.com/vertex-ai/generative-ai/pricing
- Model Armor: https://cloud.google.com/security/products/model-armor
- Ragas: https://www.ragas.io/
- Ragas RAG evaluation: https://docs.ragas.io/en/stable/getstarted/rag_eval/
- Google Cloud Observability: https://cloud.google.com/products/observability

## Finance framing

- This deck does not present a fixed cost estimate.
- Finance approves an AI budget envelope after measured Vertex/model usage is available.
- Cost reporting must connect model, screening, retrieval, and evaluation consumption to completed turns and successful grounded answers.
- Each future capability receives its own quality, security, operational, and cost approval.
