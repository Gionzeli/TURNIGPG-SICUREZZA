# Multi-employer PDF format onboarding — 2026-11-28

**Repository:** `Gionzeli/TURNIGPG-SICUREZZA`
**Branch:** `codex/employee-shift-date-range-query`
**Status:** design guardrails only; no employer-specific production parser is activated.

## Purpose

Prepare controlled onboarding of additional employers' shift schedules and payslips without mixing document layouts, employee identities, or payroll semantics. New documents are evidence for format analysis, not permission to import their contents into operational records.

## Format registry boundary

Each employer/layout must be represented by an explicit, versioned parser profile with:

- a stable employer/layout key assigned by trusted configuration, not inferred solely from text inside a PDF;
- supported document family (shift schedule or payslip), layout/version fingerprint, and parser version;
- an allowlist of source columns/labels and a canonical output allowlist;
- explicit date, locale, decimal, time and timezone conventions;
- confidence thresholds and fail-closed behavior for missing, duplicated, conflicting or unreadable fields;
- synthetic regression fixtures only, with fake identities and values;
- review history recording which rule changed and which regression case protects it.

A document must not silently fall back to another employer's profile. Unknown or ambiguous layouts are quarantined for review. A correction learned for one employer must not broaden another employer's mapping unless separately verified.

## Shift schedule extraction policy

The calendar projection remains restricted to:

- service date;
- postazione, only when an explicit and unambiguous source column or approved employer-specific mapping exists;
- start and end times;
- standard shift type assigned by application policy, not guessed from unrelated PDF columns;
- duration derived from normalized start/end times, including overnight handling in the downstream validated calculation.

Additional communications may be extracted into a separate informational field with size limits. They must never mutate date, time, postazione, shift type or calculated duration.

Do not extract totals, flags, duties, customer names, operational target descriptions or free-text notes into canonical calendar fields.

### Legacy OCR path — not an approved strict schedule source

The active legacy `local-reader.js` exposes a line-oriented `parseTurns(text)` routine. It identifies dates and time pairs from OCR text and infers post text from the remaining line content; it does not receive a verified table-column map or employer/layout profile. Consequently it cannot prove that the inferred post came from the dedicated postazione column or that unrelated columns were excluded.

Do not treat this legacy line parser as satisfying the strict PDF column policy above, and do not route its inferred post values into the canonical employee-shift ingestion path. Keep it separate from the injected-table column mapper until it is replaced or constrained by verified column geometry and employer-specific profiles. This audit does not disable the existing legacy feature or change its local data behavior.

### GESIV sample — mapping remains incomplete

The sample previously inspected appears to use service/customer/objective-style columns rather than an explicitly named `Postazione` column. Those labels are not interchangeable with postazione. Until an employer-approved semantic mapping is documented, the GESIV profile must not populate calendar postazione from customer/objective text. A row that lacks an approved postazione value must be rejected or held for review, not guessed.

## Payslip handling boundary

Payslips are a separate document family and must never be routed through the shift parser.

Format analysis may catalogue labels, page structure, decimal conventions and repeated sections. It must not turn a label match into proof of accounting meaning. Keep these concepts distinct:

- gross earnings and individual earning components;
- overtime and premiums, including their unit and calculation basis;
- allowances and benefits, including cash/non-cash treatment;
- employee contributions and tax withholdings;
- deductions, advances, reimbursements and net payment.

Do not infer missing values, derive net from partial totals, or combine a rate with a period amount. Preserve source precision and mark ambiguous items as unresolved. Bank/payment details and personal identifiers are excluded from parser fixtures, logs and repository artifacts.

The existing D-02 decision boundary and legacy compensation audit remain controlling: no payroll runtime schema, DTO, permission, loader, callable, migration or write path is introduced by this document. Payroll remains deny-by-default until the semantic mapping and authorization gates are separately approved.

## Approved-shift informational metadata

The canonical callable currently sanitizes and returns `scheduleInfo` separately from the calendar fields, and carries existing information forward when an approved update contains no replacement notes. This is a backend data contract only: the legacy calendar's `i` dialog is a separate UI and does not yet display this canonical field. Do not copy informational text into `post`, time, date, duration or shift-type fields to compensate for the missing UI integration. The future calendar UI must render notes as escaped text in a separate informational section.

## Controlled improvement loop

1. Inspect a newly supplied document without committing the original PDF or extracted personal data.
2. Identify document family, employer/layout candidate and any ambiguous fields.
3. Propose a narrowly scoped mapping change; do not silently apply it to operational data.
4. Create a synthetic fixture with invented names, dates, identifiers and amounts.
5. Add positive and negative regression cases, including cross-profile rejection and ambiguous-column rejection.
6. Review the diff and run the relevant unit tests and Emulator tests in an explicitly synthetic environment.
7. Record the parser/profile version and keep the new rule isolated to its verified layout.

This is deterministic rule and test improvement, not model training or autonomous learning from personal documents. A user correction may inform a proposed rule, but must not automatically rewrite existing shifts or compensation records.

## Existing browser OCR engine and remaining integration gap

The repository already contains a browser-side document-reading stack; it must be maintained rather than replaced:

- PDF.js 3.11.174 extracts selectable PDF text and rasterizes pages when OCR is required.
- PaddleOCR.js 0.4.2 with PP-OCRv6 Italian and ONNX Runtime WASM is the primary OCR path for payslips.
- Tesseract.js 5.1.1 with Italian and English data is the alternate OCR path for payslips and the current OCR path for shift documents.
- `local-reader.js` contains deterministic payslip and shift parsers, and `index.html` connects them to the preview-before-save flow.
- `local-qwen.js` is optional assistance for suggesting generic OCR label aliases; it is not the OCR engine and suggestions require approval.

The backend `employee-schedule-pdf-column-mapper.js` is a separate strict mapper. It consumes structured tables from an injected extraction engine; the browser-side Paddle/Tesseract stack is not currently wired into that backend composition. Do not confuse this backend boundary with absence of OCR in the application.

The legacy shift path still needs repair: it uses Tesseract rather than PaddleOCR and its line-oriented `parseTurns(text)` can infer a post from residual row text instead of proving that the text came from a dedicated `Postazione` column. It must not be treated as satisfying the strict shift-column policy. The PDF reader has also been adjusted to avoid rasterizing pages for which selectable text already contains a date and two times; payslip pages still use the PaddleOCR path.

## Integration and verification status

- Browser OCR engines are already present and connected to the legacy local import preview.
- PaddleOCR is currently used for payslips; Tesseract is currently used for shift OCR and as payslip fallback.
- The backend shift column mapper still requires an injected structured-table extraction engine and is not connected to the browser OCR stack.
- Employer-specific format registry and production document routing are not implemented here.
- No real PDFs, payslip contents, employee records, provider credentials or production Firebase services are included.
- The latest PDF rasterization change has not been executed in a browser test in this session.
