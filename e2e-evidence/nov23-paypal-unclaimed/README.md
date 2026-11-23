# Unclaimed PayPal withdrawal, and a year-less capacity window

Local stack, PayPal **sandbox**, Nov 23, 2026.

## B1: staff cancel an unclaimed PayPal withdrawal

Before (main): a withdrawal PayPal holds UNCLAIMED reads "Sending" with the not-claimed sentence and no button (`AdminWithdrawals.jsx`: a `paying` row with a provider reference draws nothing). The factory reads "Processing" and is not told.

After (this branch), in the PayPal sandbox:

1. `b1-1`: Kowloon Sourcing Partners (PayPal address with no account), balance $65.00. It withdraws $65.00.
2. Staff approve and pay $65.00. About 30 s later PayPal reads the item UNCLAIMED.
3. `b1-2`: the factory sees balance $0.00 and "Processing withdrawal $65.00".
4. `b1-3`: staff see the unchanged not-claimed sentence and the new **Cancel payment** button.
5. Staff press it. PayPal cancels the item (sandbox answer: RETURNED).
6. `b1-4`: the row reads Failed with the existing returned sentence.
7. `b1-5`: the factory's balance is back to $63.72. The notice is the existing one: "Withdrawal of $65.00 did not go through. $63.72 is back in your balance. PayPal kept $1.28 of it. Check your withdrawal method, then withdraw again." It was sent once, and the withdrawal row has `back_cents` 6372 and `kept_cents` 128.
8. `b1-6`: Lakeside Mills (the working sandbox receiver) withdraws $32.50. Staff pay it, PayPal answers SUCCESS, and the row reads Paid.

The race cases (two presses, a press racing the 30 s read-back, a claim between the read and the cancel, a lost answer, a refused cancel, a row no longer being sent) are pinned by `npm run check:paypal-unclaimed`, which runs in the build.

## M1: a capacity window typed without a year

`m1-capacity-window-before-after.md` compares main with this branch for windows typed in November and late December.
