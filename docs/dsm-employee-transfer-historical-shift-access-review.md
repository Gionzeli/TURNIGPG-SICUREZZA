# Employee transfer and historical shift access review

Status: technical review only; no authorization or retention policy is approved by this document.

Branch reviewed: `codex/employee-shift-date-range-query`

## Confirmed implementation behavior

- Employee placement transfer is a Firestore transaction. It closes the previous placement at the transfer date, creates the new placement, increments `employeeControl.placementRevision`, and creates an audit event in the same transaction.
- Placement intervals use half-open boundaries: `validFrom <= date < validUntil`; a null end means open-ended.
- Transfer rejects a missing or ambiguous current placement, overlapping candidate intervals, malformed placement history, inactive target organization resources, and inconsistent/revoked UID↔Employee binding mirrors.
- Own shift listing resolves the Employee from the verified UID binding, loads each shift's placement for that shift's date, and checks that the shift's stored placement/site/department matches that historical placement.
- The listing then also checks that the principal's current membership scope includes that historical placement. The placement loader additionally requires the referenced site and department to be active.

## Important policy-dependent behavior

After an Employee moves from department A to department B, a member whose current membership scope contains only B will not receive their own historical shifts from A through `listOwn`. The request is filtered out because the historical placement is outside the current membership scope. Likewise, if the old site or department is later archived, historical shifts at that placement are filtered out.

This is fail-closed and does not grant access to another department. However, it may be stricter than an intended "employee can always read their own historical shifts" policy. The repository's Employee domain permission decision record leaves self-profile/shift permissions and lifecycle/history behavior unresolved. No policy should be inferred from this technical observation.

## Required decision before changing behavior

Product/security owners must explicitly decide whether self-service historical shift access:
1. follows current organizational scope (current implementation; old-scope history may disappear), or
2. follows the employee's verified self-binding for their own shifts, while still preventing delegated managers from seeing out-of-scope records.

If option 2 is selected, define how archived sites/departments affect historical self-access and whether the DTO remains limited to shift fields. Any change must preserve UID↔Employee binding, account isolation, date-effective placement matching, and server-side authorization.

## Test coverage gap

The existing placement emulator test covers atomic transfer and interval boundaries. The shift authorization emulator test covers a single placement and scope denial, but does not cover a transfer followed by a self shift-list request for dates on both sides of the transfer, nor archived historical organization resources.

Add synthetic emulator cases only after the policy decision above. Until then, retain the conservative deny/filter behavior.

## Scope

This review does not approve schema, permissions, manager delegation, historical retention policy, migration, UI wiring, production Firebase access, deployment, or merge to `main`. No real employee data was used. Emulator execution is not claimed.
