# Integration boundary

Conceptual flow:

```text
External service (Google Calendar, potentially Notion)
    ↓
Integration layer
    ↓
Application/domain services
    ↓
Supabase
```

The integration layer translates external identifiers and payloads into application use cases. Application/domain services apply business rules and validation; Supabase holds authoritative application data. An external event is input to a use case, not permission to bypass domain rules or access controls.

This diagram expresses responsibility, not a decision that synchronization is one-way. Google Calendar is intended; Notion and other integrations remain future candidates. Outbound operations, if accepted, should use the same explicit service boundaries.

Before implementing each integration, document:

- User-facing purpose, data ownership and allowed read/write direction.
- Authentication, minimum permissions, secret storage and disconnection behavior.
- Identifier mapping, duplicates, idempotency, retries and error visibility.
- Conflict resolution, deletion semantics, time zones and recurrence where relevant.
- Access enforcement, including Supabase RLS, and verification criteria.

These policies remain undecided. No APIs, credentials, sync implementation, or schemas are introduced by this document.
