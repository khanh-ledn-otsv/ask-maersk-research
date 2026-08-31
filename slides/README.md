# Ask ONE manager proposal

This Slidev project presents an evidence-first proposal for Ask ONE. Its 16-slide story opens with the management decision, summarizes a respectful Ask Maersk benchmark, then shows how ONE can start small on its existing Cloudflare + GKE/GCP foundation, improve continuously through governed evidence, and selectively expand into eCommerce APIs, guided clarification, source transparency, smart support handoff, opt-in alerts, more languages, controlled conversation, Content Intelligence inside the Hub, and additional service integrations. Voice remains research-only.

## Run locally

```bash
pnpm install
pnpm dev
```

Open the URL printed by Slidev. Press `p` for presenter mode and speaker notes.

## Build and export

```bash
pnpm build
pnpm export
```

The export command creates `ask-one-manager-proposal.pdf`.

## Source structure

- `slides.md` — the 16-slide deck and presenter notes
- `style.css` and `global-bottom.vue` — presentation styling
- `public/one-logo.svg` and `public/fonts/` — ONE logo and Noto Sans assets reused from the Payload CMS demo deck
- `public/diagrams/*.drawio.svg` — diagrams with editable draw.io XML embedded
- `public/icons/` — Google Cloud product/category icons and a Cloudflare edge icon
- `scripts/generate-diagrams.mjs` — regenerates native `.drawio` sources for diagram maintenance

The narrative, assumptions, evidence map, and cost framing are documented in [`../slide-docs.md`](../slide-docs.md). The finance view focuses on measured Vertex AI model, Model Armor, retrieval, and evaluation usage rather than a fixed estimate.
