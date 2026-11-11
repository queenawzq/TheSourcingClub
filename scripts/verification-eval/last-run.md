# Verification eval — last run

Run 2026-11-11T14:47:23.177Z · model `anthropic/claude-haiku-5.5` · 13 documents · code at `this worktree`

| Score | Result |
|---|---|
| Fields read correctly | 52/53 |
| Traders caught | 2/2 |
| Mismatches caught (name, number, address) | 3/3 (address n/a on 1) |
| Specimen / edited caught | 13/13 |
| Unreadable caught | 1/1 |
| Documents not read (service failure, not scored) | 0 |
| False alarms | 0 (of 58 checks that should stay quiet) |

## Per document

| Document | Fields | Flags expected | Flags raised | Verdict | ms |
|---|---|---|---|---|---|
| cn-address-differs | 5/5 | address_differs, specimen_or_edited | address_differs, specimen_or_edited | ok | 2963 |
| cn-edited-number | 5/5 | specimen_or_edited | specimen_or_edited | ok | 2706 |
| cn-factory | 5/5 | specimen_or_edited | specimen_or_edited | ok | 3056 |
| cn-name-differs | 5/5 | name_differs, specimen_or_edited | name_differs, specimen_or_edited | ok | 2620 |
| cn-photo-skewed | 5/5 | specimen_or_edited | specimen_or_edited | ok | 2590 |
| cn-photo-unreadable | – | specimen_or_edited, unreadable | specimen_or_edited, unreadable | ok | 3456 |
| cn-trader | 5/5 | trading_scope, specimen_or_edited | trading_scope, specimen_or_edited | ok | 3547 |
| cn-zero-width | 4/5 | specimen_or_edited | specimen_or_edited | wrong address | 2433 |
| pt-factory | 4/4 | specimen_or_edited | specimen_or_edited | ok | 2654 |
| pt-number-differs | 2/2 | number_differs, specimen_or_edited | number_differs, specimen_or_edited | ok | 2403 |
| tr-factory | 5/5 | specimen_or_edited | specimen_or_edited | ok | 2678 |
| tr-trader | 4/4 | trading_scope, specimen_or_edited | trading_scope, specimen_or_edited | ok | 2581 |
| tr-zero-width-typed | 3/3 | specimen_or_edited | specimen_or_edited | ok | 3037 |

## Field misses

- **cn-zero-width** address: expected `福建省晋江市陈埭镇鞋都工业区5号`, read `福建省晋江市区5号`

Made-up documents all carry a SPECIMEN / 测试样本 stamp, so "specimen" should fire on every one of them; a false alarm for it can only be measured on a real public document (docs/public-*).
