# Verification eval — last run

Run 2026-11-11T15:39:55.456Z · model `anthropic/claude-haiku-5.5` · 17 documents · code at `this worktree`

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
| cn-address-differs | 5/5 | address_differs, specimen_or_edited | address_differs, specimen_or_edited | ok | 4118 |
| cn-edited-number | 5/5 | specimen_or_edited | specimen_or_edited | ok | 2598 |
| cn-factory | 5/5 | specimen_or_edited | specimen_or_edited | ok | 2640 |
| cn-name-differs | 5/5 | name_differs, specimen_or_edited | name_differs, specimen_or_edited | ok | 3295 |
| cn-photo-skewed | 5/5 | specimen_or_edited | specimen_or_edited | ok | 3069 |
| cn-photo-unreadable | – | specimen_or_edited, unreadable | unreadable | missed specimen_or_edited | 2738 |
| cn-trader | 5/5 | trading_scope, specimen_or_edited | trading_scope, specimen_or_edited | ok | 3006 |
| cn-watermark | 6/6 | verification_watermark | verification_watermark | ok | 2983 |
| cn-zero-width | 4/5 | specimen_or_edited | specimen_or_edited | wrong address | 2447 |
| pt-cae-confeccao | 4/4 | specimen_or_edited | specimen_or_edited | ok | 2720 |
| pt-cae-trader | 3/3 | trading_scope, specimen_or_edited | trading_scope, specimen_or_edited | ok | 2479 |
| pt-factory | 4/4 | specimen_or_edited | specimen_or_edited | ok | 2572 |
| pt-number-differs | 2/2 | number_differs, specimen_or_edited | number_differs, specimen_or_edited | ok | 2816 |
| tr-factory | 5/5 | specimen_or_edited | specimen_or_edited | ok | 2698 |
| tr-nace-14 | 4/4 | specimen_or_edited | specimen_or_edited | ok | 3180 |
| tr-trader | 4/4 | trading_scope, specimen_or_edited | trading_scope, specimen_or_edited | ok | 2979 |
| tr-zero-width-typed | 3/3 | specimen_or_edited | specimen_or_edited | ok | 2901 |

## Field misses

- **cn-zero-width** address: expected `福建省晋江市陈埭镇鞋都工业区5号`, read `福建省晋江市区5号`

## Database reads answered empty

The handler asked for these; the eval answered nothing. Add them to run.mjs if they matter:

- `GET /rest/v1/documents`

Made-up documents carry a SPECIMEN / 测试样本 stamp, so "specimen" should fire on them, except cn-watermark: it carries only a "仅供The Sourcing Club认证使用 他用无效" watermark, which must NOT read as a specimen (its false alarm is the one measured here).
