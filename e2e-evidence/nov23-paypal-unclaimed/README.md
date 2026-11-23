# Unclaimed PayPal withdrawal, and a year-less capacity window

Local stack, PayPal **sandbox**, Nov 23, 2026.

## B1: an unclaimed PayPal withdrawal goes back to the factory's balance by itself

**Before (main):**
- A withdrawal PayPal holds UNCLAIMED (no PayPal account at the address) reads "Sending" for 30 days, with no action for staff.
- The factory reads "Processing" and is not told (`b1-factory-before-unclaimed-processing.jpg`, taken during the first sandbox run).

**After (this branch):** an item unclaimed for a day (from PayPal's `time_processed`) is cancelled by the next read. Until then staff read "Not claimed: no PayPal account at this address. Returning it to the factory's balance a day after it was sent."

**The cancel in the PayPal sandbox, with nobody pressing anything after Pay.** This run was made before the one-day wait was added, so the cancel came on the first read. The cancel call and what is recorded afterwards are unchanged; the wait is pinned by the fake PayPal below.
1. Kowloon Sourcing Partners (PayPal address with no account) withdraws $63.72. Staff approve and pay it; PayPal batch `2MJJ7RJ4GJCPG`, item `7NKWMLGFSSMQU`, reads UNCLAIMED.
2. The next read of the board (the 30 s read-back) found the item UNCLAIMED. It claimed the cancel (`read_back_at` stamped 16:50:09 UTC), and PayPal cancelled the item, which then read RETURNED.
3. `b1-staff-after-auto-cancel.jpg`: the row reads Failed, with the existing returned sentence.
4. `b1-factory-after-auto-cancel.jpg`: the factory's balance is $62.47. Its one notice is the existing one: "Withdrawal of $63.72 did not go through. $62.47 is back in your balance. PayPal kept $1.25 of it. Check your withdrawal method, then withdraw again." The row has `back_cents` 6247 and `kept_cents` 125.
5. `b1-staff-working-receiver-paid.jpg`: Lakeside Mills, the working sandbox receiver, withdrew $32.50 and it reached Paid.

**PayPal's fee:** PayPal keeps its Payouts fee on a returned item. A sandbox probe in round 38 found this, and PayPal's user agreement says unclaimed funds return "less any applicable fees". So the factory gets back what was sent, as on any PayPal return (the factory pays withdrawal fees).

The races are pinned by `npm run check:paypal-unclaimed`, which runs in the build:
- reads at once (board sync in two tabs plus the webhook)
- a refused cancel, as a 500 or a 4xx
- a lost answer
- a claim meanwhile
- PayPal's own 30-day return
- one cancel per 10 minutes
- not a day yet: no cancel, and the waiting line; a day passed: one cancel, one credit
- claimed within the day: Paid, nothing credited
- no time from PayPal: never cancelled by us (PayPal's own 30-day return still credits it)

## M1: a capacity window typed without a year

`m1-capacity-window-before-after.md` compares main with this branch for windows typed in November and late December.
