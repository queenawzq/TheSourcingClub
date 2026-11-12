# Verification score: the contract between A (scoring), B (screen) and C (Run again)

Nov 12, builder A. The shape is the `verification` object of the approved mock
(`src/admin-prototype/verification-mock.js` on `claude/review-ui-mock-573cf7`),
computed from the real records, plus a few fields the live page needs to act
(marked **live**). Everything the mock reads is here with the same name and
meaning, so `VerificationScore.jsx` can draw a live result without a mapping
layer. The live page never falls back to `verificationMockProfiles`.

## Read

```js
import { verificationScore } from "src/lib/domain/verification-score.js";
const v = await verificationScore(orgId, { urls: true }); // staff only; throws on refusal
```

- One RPC, `admin_verification_score_input(target_org)` (staff only, `is_platform_admin()`
  first), returns every record the score needs. The arithmetic is plain JS in
  `src/shared/verification-score.mjs` (`scoreVerification(input)`), shared by the page,
  the queue and `npm run check:verification-score`, the same way levels were.
- `urls: true` (default) signs file and photo URLs for the evidence pane (one batch).
  The queue passes `{ urls: false }`: it needs only `overall` / `standing`.

```ts
type Verification = {
  overall: number;                 // 0–100, Business registration × 60% + Company information × 40%
  standing: { word: "Strong" | "Needs a look" | "Flagged", tone: "strong" | "potential" | "low" };
  tier: "strong" | "good" | "potential" | "low";   // colour of the overall figure
  weakest: { key, label, group, score, verdict } | null;   // lowest counted check that HAS a score
  approvalProblem: string | null;  // live: registry_approval_problem() code, same as today
  approvalBlock: string | null;    // live: approvalBlockText() words, or null when Approve is open
  facts: Fact[];                   // Review details panel
  groups: Group[];                 // always 3, in this order: business_registration, company_information, certification
};

type Fact = { key: string, label: string, value: string, ok?: boolean };
// keys: terms, registration, details, address, age, submittedBy. `ok` only on yes/no facts.

type Group = {
  key: "business_registration" | "company_information" | "certification";
  label: string;
  score: number | null;            // live: scoreGroup(); null for certification with nothing uploaded
  tier: "strong" | "good" | "potential" | "low" | "none";
  verdict: string;                 // one line on the card
  why: string;                     // the modal's one line under the verdict
  checking: boolean;               // live: an automatic check is still running → card shows "Checking…" and "—"
  evidence: Evidence;
  readAt: string;                  // "Read Nov 11, 10:42" (reader's zone) or ""
  readAtIso: string | null;        // live
  stale: string | null;            // amber footer: "Read from an earlier upload, Nov 9" | "Read before the number changed"
  fields: Field[];                 // "What the AI read"
  checks: Check[];
};

type Field = {
  key: string, label: string, value: string,
  copy?: true, wide?: true, multiline?: true,
  typed?: string,                  // red "Typed: …" line: what the factory typed when it differs
  licence?: string,                // "Licence: …" line under Factory address when it differs
  duplicate?: { with: string,      // "Same number as <names>"
                orgIds: string[],  // live
                explained: { text, by, at } | null },   // Explain → explainSharedNumber()
  editable?: true,                 // live: Run again (C) may send an edited value for it
};

type Check = {
  key: string;                     // licence | registry | scope | address | photos | certificate:<certificationId>
  label: string;
  weight?: number;                 // 30/30 and 10/15/15; absent = shown, not counted (certificates)
  score: number | null;            // null = "Not checked yet" / "Couldn't check" / "Renamed since the check" (counts as 0, not "Weakest")
  verdict: string;
  kind?: "registry" | "certificate";   // has a record form
  subjectId?: string;              // live: the certification id (certificate) — photos carry theirs per tile
  reasonKey: string;               // live: what saveCheckReason() takes (same as key without ":<id>")
  canReason: boolean;              // live: false when nothing was uploaded for it ("Add reason" hidden)
  reason?: { text, by, at };       // saved staff reason; a score under 60 is already lifted to 60
  registry?: {                     // record forms (registry and certificate)
    source: string,                // "QCC", "GİB", "EU VIES", "Issuer's list"
    sourceKey: string,             // live: what recordRegistryResult() takes (qcc, gib, vies…)
    by: string,                    // "Maya Chen, Nov 10" | "Checked automatically" | ""
    for?: string | null,           // name the check was made for, when renamed since
    result: "found" | "name_differs" | "not_found" | "could_not_check" | "expired" | null,
    reference: string,             // link or reference staff gave
    name?: string,                 // name on the registry (prefill: the legal name)
  };
  lookup?: { label: string, href: string, copy?: string };   // "Open QCC", "Open map", "Open issuer's list"
};

type Evidence =
  | { kind: "licence", files: { id, name, when, mimeType, url? }[] }        // newest first; "1 of N" switcher
  | { kind: "photos", photos: Photo[] }
  | { kind: "certificate", name, number, valid, holder, file: { id, name, mimeType, url? } | null }
  | { kind: "none" };

type Photo = {
  id: string, name: string, src?: string,          // src = signed URL when urls: true
  result: "own" | "elsewhere" | "unchecked" | "could_not",
  flag?: "stock" | "office" | "tsc",                // AI or fingerprint findings; a flag decides the tile's points
  where?: string, others?: number,                  // "On alibaba.com", "On 2 other TSC companies"
  by?: string, link?: string,                       // live: who recorded it, the link they gave
  searchLinks: { key, label, href }[],              // live: "Search image"
};
```

The mock's helpers work on this unchanged: `scoreGroup`, `scoreOverall`,
`weakestCheck`, `tierFor`, `standingFor`, `photoCaption`, `photoCheck`. The Photos
check already arrives computed from the tiles (no need for `withPhotoCheck`), and
`withReason` / `recordedCheck` are for the mock only: live, re-read after a write.

## Write (all staff only; each refuses a staff member who belongs to the company)

After every write: re-read `verificationScore(orgId)` (the score moves at once, no
Run again) **and** the approval block (`registryApprovalBlock(orgId)` / the decision
card) **and** reload the queue row. That is PICKS C "Recording a check re-checks the
approval block and reloads the queue".

```js
import {
  recordRegistryResult, recordCertificateResult, recordPhoto, saveCheckReason, explainSharedNumber,
} from "src/lib/domain/verification-score.js";

// Registry record form: Found / Name differs / Not found / Couldn't check.
// name_differs needs `reason` (that reason IS the confirmation; no checkboxes).
// Found while another source shows a different name or number is refused with
// "Another source shows a different name or number: choose Name differs and say why".
// Found on VIES counts as "I checked VIES myself".
await recordRegistryResult(orgId, { source: check.registry.sourceKey, result, reference, name, reason });

// Certificate record form: Found / Expired / Not found / Couldn't check.
await recordCertificateResult(orgId, check.subjectId, { result, reference, note });

// Photo tile: Own / Found elsewhere (needs `link`) / Couldn't check.
await recordPhoto(orgId, photo.id, { result: "own" | "found_elsewhere" | "could_not_check", link, note });

// "Add reason" on any sub-row. Lifts a scored check under 60 to 60; an unscored one stays unscored.
// For scope it is also what lets a trading-only licence be approved.
await saveCheckReason(orgId, check.reasonKey, text, check.subjectId);

// "Explain" under a shared number (a sentence of three words or more).
await explainSharedNumber(orgId, text);
```

Editing the number field is the existing `adminSetRegistrationNumber(orgId, number, note, country)`
(saves it as the staff number with who and when, and clears number_check_digit_fails /
number_needs_staff). Run again (C) owns re-reading.

## Approval blocks and the action that clears each

| `approvalProblem` | Cleared on the new screen by |
|---|---|
| `no_check` | Registry: Found or Name differs |
| `renamed` | Registry: record again (Update check) |
| `name_differs`, `document_differs` | Registry: Name differs + reason |
| `duplicate` | Explain under the shared number |
| `trading_only` | Factory or trader: Add reason |
| `number_check_digit_fails`, `number_needs_staff` | Edit the number field (staff number) |
| `number_unread` | Ask for a clearer licence (Request more information) |

## Scores (approved Nov 12)

- Licence: clean reading 95; tax plate (TR vergi levhası) 70; name cut short or a near
  miss / unsure / missing field 70; differs from what was typed 50; edited 40;
  **watermarked copy 40** ("Copy, not the original licence"); sample or unreadable 10;
  same licence uploaded by another company first 5; not read / no file: no score.
- Registry: Found 90, Name differs 60, Not found 5, Couldn't check no score, renamed since
  the check no score. Automatic VIES alone: registered + name matches 90, name partly
  matches 80, name differs 60, not registered 5.
- Factory or trader: making (code or licence words) 100, trading only 10, can't tell no score.
- Address: same as the licence 90, a part below the city differs 70, another city or the
  licence and registry disagree 15; residential or office site caps at 55; placed by
  district only caps at 30; only the map to go on: industrial 60, home/office 40.
- Photos per tile: own 100, not checked / couldn't check 50, found elsewhere or on other
  TSC companies 0, stock 10, office 40; the check is the average. A flag decides the tile,
  except that staff recording "Own" overrules the AI's "stock" (an office stays an office,
  a later copy stays a copy).
- Certificate (not counted): Found 90, Expired 15 (also when the date has passed and no
  one checked), Not found 5, Couldn't check no score.
- A staff reason lifts a scored check under 60 to 60.
- Tiers 90 / 75 / 60; standing 85+ Strong, 60–84 Needs a look, under 60 Flagged.
