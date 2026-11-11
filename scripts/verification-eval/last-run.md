# Verification eval — last run

Run 2026-11-11T15:46:13.546Z · model `anthropic/claude-haiku-5.5` · 17 documents · code at `this worktree`

| Score | Result |
|---|---|
| Fields read correctly | 69/70 |
| Traders caught | 3/3 |
| Mismatches caught (name, number, address) | 3/3 (address n/a on 1) |
| Specimen / edited caught | 15/16 |
| Verification watermark reported (not a specimen) | 1/1 |
| Unreadable caught | 1/1 |
| Documents not read (service failure, not scored) | 0 |
| False alarms | 0 (of 94 checks that should stay quiet) |

## Per document

| Document | Fields | Flags expected | Flags raised | Verdict | ms |
|---|---|---|---|---|---|
| cn-address-differs | 5/5 | address_differs, specimen_or_edited | address_differs, specimen_or_edited | ok | 3217 |
| cn-edited-number | 5/5 | specimen_or_edited | specimen_or_edited | ok | 2628 |
| cn-factory | 5/5 | specimen_or_edited | specimen_or_edited | ok | 2872 |
| cn-name-differs | 5/5 | name_differs, specimen_or_edited | name_differs, specimen_or_edited | ok | 3222 |
| cn-photo-skewed | 5/5 | specimen_or_edited | specimen_or_edited | ok | 3090 |
| cn-photo-unreadable | – | specimen_or_edited, unreadable | unreadable | missed specimen_or_edited | 2166 |
| cn-trader | 5/5 | trading_scope, specimen_or_edited | trading_scope, specimen_or_edited | ok | 3116 |
| cn-watermark | 6/6 | verification_watermark | verification_watermark | ok | 2621 |
| cn-zero-width | 4/5 | specimen_or_edited | specimen_or_edited | wrong address | 2509 |
| pt-cae-confeccao | 4/4 | specimen_or_edited | specimen_or_edited | ok | 2805 |
| pt-cae-trader | 3/3 | trading_scope, specimen_or_edited | trading_scope, specimen_or_edited | ok | 3006 |
| pt-factory | 4/4 | specimen_or_edited | specimen_or_edited | ok | 2647 |
| pt-number-differs | 2/2 | number_differs, specimen_or_edited | number_differs, specimen_or_edited | ok | 2658 |
| tr-factory | 5/5 | specimen_or_edited | specimen_or_edited | ok | 3509 |
| tr-nace-14 | 4/4 | specimen_or_edited | specimen_or_edited | ok | 3736 |
| tr-trader | 4/4 | trading_scope, specimen_or_edited | trading_scope, specimen_or_edited | ok | 2858 |
| tr-zero-width-typed | 3/3 | specimen_or_edited | specimen_or_edited | ok | 3364 |

## Field misses

- **cn-zero-width** address: expected `福建省晋江市陈埭镇鞋都工业区5号`, read `福建省晋江市区5号`

## Database reads answered empty

The handler asked for these; the eval answered nothing. Add them to run.mjs if they matter:

- `GET /rest/v1/documents`

Made-up documents carry a SPECIMEN / 测试样本 stamp, so "specimen" should fire on them, except cn-watermark: it carries only a "仅供The Sourcing Club认证使用 他用无效" watermark, which must NOT read as a specimen (its false alarm is the one measured here).
