# Verification eval — last run

Run 2026-11-11T14:45:27.093Z · model `anthropic/claude-haiku-5.5` · 13 documents · code at `this worktree`

| Score | Result |
|---|---|
| Fields read correctly | 52/53 |
| Traders caught | 2/2 |
| Mismatches caught (name, number, address) | 2/2 (address n/a on 13) |
| Specimen / edited caught | n/a (not produced by this code) |
| Unreadable caught | 1/1 |
| Documents not read (service failure, not scored) | 0 |
| False alarms | 0 (of 47 checks that should stay quiet) |

## Per document

| Document | Fields | Flags expected | Flags raised | Verdict | ms |
|---|---|---|---|---|---|
| cn-address-differs | 5/5 | address_differs, specimen_or_edited | none | n/a address_differs, specimen_or_edited | 2706 |
| cn-edited-number | 5/5 | specimen_or_edited | none | n/a specimen_or_edited | 2582 |
| cn-factory | 5/5 | specimen_or_edited | none | n/a specimen_or_edited | 2125 |
| cn-name-differs | 5/5 | name_differs, specimen_or_edited | name_differs | n/a specimen_or_edited | 1940 |
| cn-photo-skewed | 5/5 | specimen_or_edited | none | n/a specimen_or_edited | 1919 |
| cn-photo-unreadable | – | specimen_or_edited, unreadable | unreadable | n/a specimen_or_edited | 1333 |
| cn-trader | 5/5 | trading_scope, specimen_or_edited | trading_scope | n/a specimen_or_edited | 3241 |
| cn-zero-width | 4/5 | specimen_or_edited | none | wrong address; n/a specimen_or_edited | 1862 |
| pt-factory | 4/4 | specimen_or_edited | none | n/a specimen_or_edited | 1998 |
| pt-number-differs | 2/2 | number_differs, specimen_or_edited | number_differs | n/a specimen_or_edited | 1817 |
| tr-factory | 5/5 | specimen_or_edited | none | n/a specimen_or_edited | 2210 |
| tr-trader | 4/4 | trading_scope, specimen_or_edited | trading_scope | n/a specimen_or_edited | 2035 |
| tr-zero-width-typed | 3/3 | specimen_or_edited | none | n/a specimen_or_edited | 2833 |

## Field misses

- **cn-zero-width** address: expected `福建省晋江市陈埭镇鞋都工业区5号`, read `福建省晋江市`

Made-up documents all carry a SPECIMEN / 测试样本 stamp, so "specimen" should fire on every one of them; a false alarm for it can only be measured on a real public document (docs/public-*).
