# Reference workload: tenant-scoped work tracker

A signed-in organization member browses boards and maintains work items. Every read and write is
scoped to the member's organization, updates carry an expected version, and accepted mutations
append an audit entry. The web client exposes the board and work item flow through one public
feature entrypoint per feature; the API separates transport, application, domain, and
infrastructure responsibilities and shares one published contract package.

Deliverables: session handling, organization membership, boards, stateful work items with
optimistic concurrency, audit entries, pagination, one compatible migration, deterministic unit,
integration, contract, security, migration, observability, performance, and browser checks, plus
local startup documentation.

Out of scope: external identity providers, payments, email delivery, cloud deployment, and
production provisioning. All records and identities in this workload are synthetic.
