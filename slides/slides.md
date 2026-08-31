---
theme: default
title: 'Ask ONE · evidence-led proposal'
titleTemplate: '%s'
author: 'ONE'
keywords: 'Ask ONE, Ask Maersk research, AI search, GCP, Vertex AI, security, observability, cost'
info: |
  An evidence-first, stage-gated proposal for trusted AI self-service.
colorSchema: light
aspectRatio: 16/9
canvasWidth: 1280
presenter: true
browserExporter: true
exportFilename: ask-one-manager-proposal
fonts:
  provider: none
layout: cover
class: cover-slide
defaults:
  layout: default
  transition: fade
---

<img class="cover-logo" src="/one-logo.svg" alt="Ocean Network Express" />

<div class="cover-copy">
  <div class="eyebrow">Ask ONE · management proposal</div>
  <h1>A measured path<br>to AI self-service.</h1>
  <p>What Ask Maersk visibly delivers today—and how ONE can assess a comparable, governed and observable customer experience.</p>
</div>

<div class="cover-meta">Competitive benchmark → controlled feasibility → measured expansion · 31 August 2026</div>

<!--
The story starts with the customer experience already visible in the market. Ask Maersk is a useful benchmark, not a target to criticize or a claim that ONE will automatically surpass it.

[Sources]
- Internal: reports/maersk-research-2026-08-31.md
- Internal: docs/plan.md
- Visual reference: ../payloadcms-demo-main/apps/slides
-->

---

<div class="eyebrow">Executive recommendation</div>

# Approve a small, governed feasibility assessment

<p class="lede">The opportunity is credible, the first scope is intentionally narrow, and the larger investment remains conditional on measured evidence.</p>

<div class="benchmark-overview parity-overview">
  <div>
    <span class="overview-number">01 · Start</span>
    <h2>Small and useful</h2>
    <strong>Public knowledge first</strong>
    <p>English, single-question, CMS content and governed Hub uploads.</p>
  </div>
  <div>
    <span class="overview-number">02 · Prove</span>
    <h2>Evidence before scale</h2>
    <strong>Four management gates</strong>
    <p>Quality, safety, reliability and readiness with observable AI cost.</p>
  </div>
  <div>
    <span class="overview-number">03 · Decide</span>
    <h2>Expand selectively</h2>
    <strong>Continuous improvement</strong>
    <p>Add APIs, languages, conversation and services only after proof.</p>
  </div>
</div>

<div class="callout"><b>Decision today:</b> approve evidence-building—not a full production commitment.</div>

<!--
[Sources]
- Internal: docs/plan.md, sections 11–15
- Internal synthesis: reports/maersk-research-2026-08-31.md
-->

---

<div class="eyebrow">Competitive benchmark · What customers see</div>

# Ask Maersk sets a credible self-service benchmark

<p class="lede">Its public English experience combines an AI answer with discovery and fallback patterns that help customers continue their journey.</p>

<div class="discovery-flow">
  <div class="discovery-core"><span>Primary result</span><strong>AI answer</strong></div>
  <div class="discovery-arrow">+</div>
  <div class="discovery-item"><span>Common needs</span><strong>Top FAQs</strong></div>
  <div class="discovery-arrow">+</div>
  <div class="discovery-item"><span>Next action</span><strong>Popular services</strong></div>
  <div class="discovery-arrow">+</div>
  <div class="discovery-item"><span>Learn more</span><strong>Insights</strong></div>
</div>

<div class="translation-strip benchmark-summary">
  <div><b>When supported</b><span>Answer · related links · feedback · copy · redo</span></div>
  <div><b>When unsupported</b><span>Rephrase · common topics · search · support · Help Centre</span></div>
  <div><b>Observed boundary</b><span>English · single-question · apparently non-streaming</span></div>
</div>

<div class="callout soft"><b>Balanced interpretation:</b> use the visible experience as a design benchmark; do not infer competitor accuracy, adoption, architecture, security or operating cost.</div>

<!--
This is a respectful summary of visible behavior, not a competitor scorecard.

[Sources]
- Internal: reports/maersk-research-2026-08-31.md, Capability Map and Evidence Gaps
- User-provided Ask Maersk screenshots in this conversation
-->

---

<div class="eyebrow">Ask ONE direction · What the benchmark means</div>

# Target comparable usefulness—with stronger operating evidence

<div class="benchmark-overview parity-overview">
  <div>
    <span class="overview-number">01 · Match</span>
    <h2>Customer experience</h2>
    <strong>Useful discovery</strong>
    <p>English public knowledge, relevant FAQs, services, insights, links and a clear fallback path.</p>
  </div>
  <div>
    <span class="overview-number">02 · Own</span>
    <h2>ONE operating model</h2>
    <strong>Governed evidence</strong>
    <p>CMS and Hub sources, citations, version history, accountable owners and controlled improvement.</p>
  </div>
  <div>
    <span class="overview-number">03 · Prove</span>
    <h2>Decision confidence</h2>
    <strong>Measured controls</strong>
    <p>Security, browser completion, answer quality, observability and cloud cost per successful outcome.</p>
  </div>
</div>

<div class="callout soft"><b>Prudent ambition:</b> establish credible parity with evidence. Any improvement beyond the benchmark must be demonstrated—not promised.</div>

<!--
This slide resets the competitive posture: match the useful experience, apply ONE's own governance, and let measured results determine further investment.

[Sources]
- Internal synthesis: reports/maersk-research-2026-08-31.md
- Internal proposed controls: docs/plan.md, sections 4–10
-->

---

<div class="eyebrow">Customer experience</div>

# The first experience should feel simple and familiar

<div class="observed-system ask-one-experience">
  <div class="system-node"><span>Customer</span><strong>Ask in English</strong><small>public ONE question</small></div>
  <div class="system-arrow">→</div>
  <div class="system-node primary"><span>Ask ONE</span><strong>Grounded response</strong><small>answer · citation · related content</small></div>
  <div class="system-arrow">→</div>
  <div class="system-node"><span>Next step</span><strong>Continue confidently</strong><small>FAQ · service · insight · support</small></div>
</div>

<div class="telemetry-lane fallback-lane">
  <div><span class="status inference">When no answer is supported</span><strong>Keep the journey useful</strong></div>
  <div class="event-sequence"><span>explain</span><span>suggest topics</span><span>ONE search</span><span>support</span></div>
</div>

<div class="translation-strip">
  <div><b>Visible promise</b><span>Answer or useful next step</span></div>
  <div><b>Behind the scenes</b><span>Buffer → verify citations → screen output → display; no raw answer-token streaming in the MVP.</span></div>
</div>

<!--
The interaction follows the useful benchmark without copying competitor implementation details. The first release remains English, public knowledge and single-question, with no multi-turn conversation.

[Sources]
- Internal benchmark: reports/maersk-research-2026-08-31.md
- Internal proposed experience: docs/plan.md, sections 4–5 and 11
- Gemini streaming behavior: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/send-chat-prompts-gemini
-->

---

<div class="eyebrow">Feasibility decision</div>

# Start small and prove the four things that matter

<div class="lesson-list">
  <div><span>01</span><strong>Useful + grounded</strong><p>Customers receive a supported answer, relevant referral or clear fallback—with valid sources.</p></div>
  <div><span>02</span><strong>Safe</strong><p>Critical injection, sensitive-data and unsupported-answer cases are blocked or safely refused.</p></div>
  <div><span>03</span><strong>Reliable + observable</strong><p>One query ID explains browser completion, latency, retrieval, model, policy and platform behavior.</p></div>
  <div><span>04</span><strong>Affordable to operate</strong><p>AI model and Vertex usage are measured per completed turn and successful grounded answer.</p></div>
</div>

<div class="callout"><b>Decision rule:</b> pass the agreed gates → consider a public MVP; miss a critical gate → remediate once or stop.</div>

<!--
[Sources]
- Internal synthesis: reports/maersk-research-2026-08-31.md
- Internal: docs/plan.md, sections 4–15
-->

---

<div class="eyebrow">MVP boundary</div>

# Start with one useful, governed experience

<div class="scope-compare">
  <section>
    <h2>Prove now</h2>
    <ul class="scope-list in">
      <li>Anonymous · English · single-question</li>
      <li>CMS content serving one-line.com</li>
      <li>Governed uploads through the Hub</li>
      <li>Grounded answers with visible sources</li>
      <li>Feedback, evaluation, guardrails and exact cache</li>
      <li>Source lineage, observability and minimum Hub</li>
    </ul>
  </section>
  <div class="scope-divider"><span>Risk boundary</span></div>
  <section class="later-scope">
    <h2>Add after proof</h2>
    <ul class="scope-list later">
      <li><b>Next:</b> booking, schedule and shipment APIs</li>
      <li>Guided clarification + source comparison</li>
      <li>Smart handoff + opt-in alerts</li>
      <li>More languages + controlled conversation</li>
      <li>Hub intelligence + more services</li>
      <li>Voice / transactions · research-only, TBD/TBC</li>
    </ul>
  </section>
</div>

<div class="callout soft"><b>Small is intentional:</b> future customer and Hub capabilities remain separately gated; voice is not part of the committed roadmap.</div>

<!--
[Sources]
- Internal: docs/plan.md, sections 5, 9, 11 and 12
- Project context: https://www.one-line.com/
- Future integration context: https://ecomm.one-line.com/one-ecom
-->

---
class: diagram-slide
---

<div class="diagram-frame">
  <img src="/diagrams/ask-one-gcp-architecture.drawio.svg" alt="Proposed Cloudflare and GCP architecture for Ask ONE" />
</div>

<div class="diagram-note"><b>Reuse what exists:</b> Cloudflare remains the DNS/CDN/security edge; GKE/GCP remains the origin; Ask ONE adds governed RAG and Vertex AI.</div>

<!--
Manager translation: reuse the platform already operated by ONE. No Google CDN or Cloud DNS is proposed. Cloud SQL with pgvector is an initial feasibility candidate, not a permanent architecture commitment.
Future sources remain TBD/TBC until ownership, classification, interface, security and cost are confirmed.

[Sources]
- Internal: docs/plan.md, section 7
- ONE website: https://www.one-line.com/
- ONE eCommerce portal: https://ecomm.one-line.com/one-ecom
- Cloudflare secure application delivery: https://developers.cloudflare.com/reference-architecture/design-guides/secure-application-delivery/
- Cloudflare proxied DNS: https://developers.cloudflare.com/learning-paths/prevent-ddos-attacks/baseline/proxy-dns-records/
- Cloudflare icon: https://simpleicons.org/?q=cloudflare
- Google Cloud product icons: https://cloud.google.com/icons
- GKE: https://cloud.google.com/kubernetes-engine/docs
- Vertex AI: https://cloud.google.com/vertex-ai/generative-ai/docs
- Cloud SQL PostgreSQL: https://cloud.google.com/sql/docs/postgres
-->

---
class: diagram-slide
---

<div class="diagram-frame">
  <img src="/diagrams/ask-one-security-chain.drawio.svg" alt="Ask ONE defense-in-depth security chain" />
</div>

<div class="diagram-note"><b>Defense in depth:</b> network, input, source, grounding, output and audit controls must all pass—or the user receives a safe fallback.</div>

<!--
Security is not delegated to Gemini. Model Armor is one layer inside a broader control chain. Least privilege, allowlisted sources, auditability and a kill switch remain required.

[Sources]
- Internal: docs/plan.md, section 6
- Model Armor: https://docs.cloud.google.com/model-armor/overview
- Cloudflare secure application delivery: https://developers.cloudflare.com/reference-architecture/design-guides/secure-application-delivery/
- Cloudflare icon: https://simpleicons.org/?q=cloudflare
- Google Cloud product icons: https://cloud.google.com/icons
-->

---
class: diagram-slide
---

<div class="diagram-frame">
  <img src="/diagrams/ask-one-knowledge-quality-loop.drawio.svg" alt="Governed knowledge ingestion and continuous improvement loop" />
</div>

<div class="diagram-note"><b>Controlled improvement:</b> quarantine → validate → RAG process → approve → evaluate → publish or rollback. Raw feedback never trains the system automatically.</div>

<!--
Golden Dataset = governed evaluation cases. Golden Database = its registry and review history in Cloud SQL. Both are versioned and auditable.

[Sources]
- Internal: docs/plan.md, sections 3–5 and 9
- Google Cloud product icons: https://cloud.google.com/icons
-->

---
class: diagram-slide
---

<div class="diagram-frame">
  <img src="/diagrams/ask-one-hub-operating-model.drawio.svg" alt="Knowledge and Quality Hub operating model" />
</div>

<div class="diagram-note"><b>Minimum Hub now:</b> source control and governed releases. Content Intelligence remains a future capability inside the same Hub.</div>

<!--
The Hub is not a large admin application in the MVP. It provides the operating view and minimum controlled actions required to manage sources safely. Content gaps, stale/conflicting-content detection, FAQ suggestions and trend intelligence are future additions—not MVP commitments.

[Sources]
- Internal: docs/plan.md, sections 5 and 9
- Google Cloud product icons: https://cloud.google.com/icons
-->

---

<div class="eyebrow">End-to-end observability</div>

# One query ID explains outcome, risk, latency and cost

<div class="observability-chain">
  <div><strong>Experience</strong><span>completion · source click · helpful · abandonment</span></div>
  <div><strong>Retrieval</strong><span>context precision/recall · ranking · empty retrieval</span></div>
  <div><strong>Answer quality</strong><span>correctness · faithfulness · relevance · citations</span></div>
  <div><strong>Model + runtime</strong><span>tokens · TTFT · tokens/sec · p50/p95 · cost</span></div>
</div>

<div class="observability-bottom">
  <div class="otel"><span>Evaluation backbone</span><strong>Golden Dataset + one query ID</strong><p>Ragas · Vertex AI Evaluation · deterministic checks · human review</p></div>
  <div class="manager-view"><span>Manager view</span><ul><li>Correct grounded answers</li><li>Cost per successful answer</li><li>p50/p95 by processing stage</li><li>Quality and safety regression</li></ul></div>
</div>

<div class="callout soft"><b>Why this matters:</b> when a customer turn fails, operations can see whether the cause was frontend, retrieval, model, policy, source or platform.</div>

<!--
[Sources]
- Internal: reports/maersk-research-2026-08-31.md, reliability observations
- Internal: docs/plan.md, sections 9 and 10
- Google Cloud Observability: https://cloud.google.com/products/observability
- Ragas evaluation metrics: https://docs.ragas.io/en/stable/getstarted/rag_eval/
- Vertex AI evaluation: https://docs.cloud.google.com/vertex-ai/generative-ai/docs
-->

---

<div class="eyebrow">Go / no-go scorecard</div>

# Public launch requires all four gates to pass

<div class="gate-scorecard">
  <div><span class="gate-number">01</span><h2>Quality</h2><strong>≥90%</strong><p>citation correctness</p><strong>≥85%</strong><p>grounded correctness</p></div>
  <div><span class="gate-number">02</span><h2>Safety</h2><strong>100%</strong><p>critical attack cases safe</p><strong>≥95%</strong><p>correct refusal</p></div>
  <div><span class="gate-number">03</span><h2>Reliability</h2><strong>≥99%</strong><p>browser completion</p><strong>≤5s</strong><p>p95 test workload</p></div>
  <div><span class="gate-number">04</span><h2>Readiness + cost</h2><strong>≥80%</strong><p>priority content governed</p><strong>Within</strong><p>approved AI budget envelope</p></div>
</div>

<div class="callout"><b>No averaging away risk:</b> any unresolved critical security case blocks launch, even when overall scores look healthy.</div>

<p class="fine-print">Proposed PoC thresholds; product, security, content, operations and finance ratify them before execution.</p>

<!--
[Sources]
- Internal KPI framework: docs/plan.md, section 10
- Proposed thresholds and assumptions: slide-docs.md
-->

---

<div class="eyebrow">GCP AI cost scope</div>

# AI cost scales with Vertex usage—and remains controllable

<div class="finops-layout">
  <section>
    <div class="eyebrow">Primary cost drivers</div>
    <div class="finops-line"><strong>Vertex AI model</strong><span>Model choice, request volume and input/output tokens.</span></div>
    <div class="finops-line"><strong>Grounding pipeline</strong><span>Embeddings, retrieval, reranking and evaluation workloads.</span></div>
    <div class="finops-line"><strong>Model security</strong><span>Input/output screening through Model Armor.</span></div>
  </section>
  <section class="finops-controls">
    <div class="eyebrow">Control levers</div>
    <div class="control-grid">
      <span>Token caps + prompt discipline</span><span>Model routing by task</span>
      <span>Version-aware exact cache</span><span>Batch evaluation</span>
      <span>Budgets + anomaly alerts</span><span>Gate each future capability</span>
    </div>
  </section>
</div>

<div class="unit-economics-strip">
  <div><span>Unit measure</span><strong>cost / question</strong></div>
  <div><span>Customer measure</span><strong>cost / completed turn</strong></div>
  <div><span>Quality measure</span><strong>cost / grounded answer</strong></div>
  <div><span>Decision measure</span><strong>quality gained per AI spend</strong></div>
</div>

<div class="callout soft"><b>Finance decision:</b> set the AI budget envelope from measured Vertex usage, then scale only when cost and quality move together.</div>

<!--
[Sources]
- Internal: docs/plan.md, sections 9, 10 and 15
- Vertex AI pricing dimensions: https://cloud.google.com/vertex-ai/generative-ai/pricing
- Model Armor: https://cloud.google.com/security/products/model-armor
-->

---

<div class="eyebrow">Option-preserving roadmap</div>

# Start small now; expand the interaction later

<div class="roadmap">
  <div class="active"><span>01 · Start</span><strong>Single question</strong><p>English · CMS + Hub knowledge · grounded</p></div>
  <div><span>02 · Next</span><strong>eCommerce APIs</strong><p>Booking · schedules · shipments · authorized</p></div>
  <div><span>03</span><strong>Guided answers</strong><p>Clarification · source comparison · transparency</p></div>
  <div><span>04</span><strong>Connected support</strong><p>Smart handoff · opt-in alerts · verified events</p></div>
  <div><span>05</span><strong>Broader access</strong><p>Languages · conversation · services; voice research-only</p></div>
</div>

<div class="future-seams">
  <span>Prepare now</span>
  <b>source registry</b><b>session-ready query IDs</b><b>channel-independent API</b><b>versioned evaluation</b><b>policy + tool contracts</b>
</div>

<div class="callout soft"><b>Benchmark context:</b> Ask Maersk is English, single-question and apparently non-streaming today. Ask ONE can start there, validate full answers, then expand selectively.</div>

<!--
[Sources]
- Internal: docs/plan.md, section 12
- Internal benchmark: reports/maersk-research-2026-08-31.md
-->

---
layout: cover
class: closing-slide
---

<img class="closing-logo" src="/one-logo.svg" alt="Ocean Network Express" />

# Approve the evidence-building step

<div class="decision-list">
  <div><span>1</span><p>Approve the feasibility scope, Golden Dataset, controls and measurable exit gates.</p></div>
  <div><span>2</span><p>Name owners from product, content, security, platform, QA and finance.</p></div>
  <div><span>3</span><p>Require a gate review using quality, security, reliability and <b>AI model + Vertex cost per successful answer</b>.</p></div>
  <div><span>4</span><p>Consider public MVP funding only after that evidence is available.</p></div>
</div>

<div class="closing-statement">Proceed only if Ask ONE is useful, grounded, safe, observable, reliable and affordable.</div>

<!--
Close on the decision. The proposal does not ask management to approve the whole roadmap.

[Sources]
- Internal: docs/plan.md
- Cost and gate assumptions: slide-docs.md
-->
