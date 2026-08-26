# 06: Build and run the representative research corpus

**What to build:** Give the researcher a bounded corpus covering Ask Maersk’s capabilities, tracking, schedules, knowledge, conversational context, authentication, and guardrails. Cases can be selected individually or by category and aggregate into one inspectable run summary without using unauthorized customer data.

**Blocked by:** 04: Capture multi-turn research journeys; 05: Turn evidence into a cited structured finding.

**Status:** ready-for-agent

- [ ] The corpus contains the planned 15–25 representative cases across all seven research categories.
- [ ] Cases requiring shipment or customer data use fake or explicitly authorized test identifiers and are marked for manual execution when automation is unstable or inappropriate.
- [ ] A researcher can run one case or one category and obtain an immutable summary that links each case to its evidence and finding.
- [ ] Failed or skipped cases remain visible in the summary and do not erase completed case results.
- [ ] Batch analysis uses the configured cost-conscious model policy and reports aggregate token usage so the researcher can understand the spend.
- [ ] Tests verify selection, ordering, partial failure, resumability expectations, and summary aggregation without invoking live browser or model services.
