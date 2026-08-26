# 06: Build and run the representative research corpus

**What to build:** Give the researcher a bounded corpus covering Ask Maersk’s capabilities, tracking, schedules, knowledge, conversational context, authentication, and guardrails. Cases can be selected individually or by category and aggregate into one inspectable run summary without using unauthorized customer data.

**Blocked by:** 04: Capture multi-turn research journeys; 05: Turn evidence into a cited structured finding.

**Status:** completed

- [x] The corpus contains the planned 15–25 representative cases across all seven research categories.
- [x] Cases requiring shipment or customer data use fake or explicitly authorized test identifiers and are marked for manual execution when automation is unstable or inappropriate.
- [x] A researcher can run one case or one category and obtain an immutable summary that links each case to its evidence and finding.
- [x] Failed or skipped cases remain visible in the summary and do not erase completed case results.
- [x] Batch analysis uses the configured cost-conscious model policy and reports aggregate token usage so the researcher can understand the spend.
- [x] Tests verify selection, ordering, partial failure, resumability expectations, and summary aggregation without invoking live browser or model services.

## Comments

- 2026-08-26: Added 21 cases across the seven categories. Fake and authorized-data cases are manual-only and carry explicit data-policy metadata and handling notes.
- 2026-08-26: Added immutable corpus summaries, partial-failure/skip visibility, model-policy and usage aggregation, and resume-to-a-new-summary behavior. The full test suite passes without live browser or model services.
