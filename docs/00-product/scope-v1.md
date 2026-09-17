# V1 scope

## Scope status

This is the initial product boundary based on the supplied direction, not a claim of implementation or a finalized delivery sequence. Module depth and release acceptance criteria require Product Owner decisions and module requirements. The current task delivers governance only.

## In scope — conceptual baseline

| System | Intended responsibility |
| --- | --- |
| Player | Level, EXP, stats, achievements |
| Quest Engine | Main, side, daily/weekly, recurring quests; rewards, deadlines, completion, failure and penalty handling |
| Planning | Goals, projects, calendar and deadlines |
| Health / Recovery | Workload/energy estimates, daily check-in, recovery recommendations and quests, overload-based waivers |
| Penalties | Physical/custom penalties, savings allocations, EXP penalties, justified waivers without recursive escalation |
| Growth / Criteria | Activities, criteria and evidence; configurable university training-score, scholarship, Sinh viên 5 tốt and other application requirements |
| Achievement Ledger / Evidence Vault | Certificates, proof, awards, projects and activities retained for later reuse |
| Knowledge | Books and book notes, general notes, Video Lab, journal |
| Finance | Income, expenses, savings/funds and dedicated funds, separate from EXP |
| Life | Recurring chores, life issues requiring action, routines and personal tasks |
| Integrations | Google Calendar integration within an explicit application boundary; sync details remain undecided |

## Not yet / future

- Potential Notion and other integrations, pending prioritization.
- Later CV, portfolio and application reuse workflows; capture evidence now, define output workflows separately.
- Ideas added to the backlog without explicit V1 acceptance.

Medical diagnosis, recursively escalating penalties, and treating external services as the primary database are excluded by product principles, not deferred features.

Before implementation, define each module's requirements, states, edge cases and acceptance criteria. Do not infer algorithms, schemas, financial automation, or integration sync behavior from this scope table.
