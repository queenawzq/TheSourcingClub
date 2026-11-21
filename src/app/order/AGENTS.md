# Payout UI instructions

### Preserve payout explanations and tooltips (John, Nov 11, 2026)

The payout page’s explainer text and help tooltips are required product content. Keep the balance, available balance, pending balance and four earnings-summary helpers, transaction guidance, billing guidance, and withdrawal/setup/security explanations visible. Preserve mouse, keyboard and tap access through PaymentHelp. Do not delete, hide in CSS, or shorten these away during design parity, copy cleanup, provider-name cleanup or merges. The earlier Nov 6 “no more explanation on screen” rule does not apply to payout explanations or tooltips. Update inaccurate copy to match current payment behavior rather than removing it. Removal requires an explicit new user instruction. Run npm run check:payout-help and npm run build after payout UI changes.

### Preserve John's reviewed withdrawal UI and copy (Nov 16, 2026)

The payout UI and text reviewed with John on `claude/nov16-withdrawals` are approved product decisions. Do not rewrite, restore older copy, remove, hide, restyle or rearrange them during backend work, design parity, cleanup or merges. Change them only when the user explicitly requests that particular UI or text change. This instruction supersedes older preservation guidance where John explicitly simplified the content below.

- Keep the four earnings tooltips exactly as reviewed: Total earnings — "Your earnings from funded payments for the selected client, or all clients. Includes payments awaiting approval and withdrawals being processed." (changed Nov 21: Total includes withdrawals in progress, which no tile shows) Awaiting approval — "Funds waiting for the brand to approve the milestone. Once approved, they move toward your available balance." Pending — "Payments still processing and money on hold." (changed Nov 21: Pending is earnings not yet available, card payments clearing and disputed steps; withdrawals in progress are `processing_cents`, in Total only) Paid out — "Money that has been paid out to you". Do not restore the removed "No action is needed" sentence or the older Paid out explanation.
- Keep the Withdraw dialog in the shared TSC modal: destination dropdown with arrow first; amount below with the "Withdraw full amount" button beside its label; available balance underneath; Cancel and Withdraw in the footer. The full-amount button fills the input. Changed Nov 20 (local test, fix every problem): more than available is no longer capped silently; the dialog says "You can withdraw up to $X.", and the fee and what arrives are shown in one line under Available, in the factory's existing sentence ("Payout fee $X is taken from this payment: you receive $Y."). Do not add processing-time prose. "Cancel withdrawal" asks first, in the Cancel withdrawals dialog. Preserve server validation and refusal messages.
- Keep the reviewed Withdrawal methods layout: compact Add button, aligned provider icon/details/menu, actual PayPal logo, and subdued sentence-case Default badge under the account details. Preserve mobile wrapping and alignment.
- Keep the client filter's dropdown arrow.
- Keep balance and main actions in the top row of the balance card, with the pending withdrawal amount, destination and owner's Cancel action in a separate full-width row under a divider. Preserve the compact mobile stack; do not restore the large blank gap or nest the pending row inside the balance column.
- Saving the first/default withdrawal method must refresh the withdrawal balance immediately; never require a browser refresh to reveal Withdraw. Preserve the default-method dependency on `useWithdrawalBalance` in both the payout page and card.

Before merging, check the diff for accidental changes to these decisions. Run `npm run check:payout-help`, `npm run check:css` and `npm run build` for payout UI changes.

### One balance, one card (Nov 20, 2026)

Every factory has the same Earnings card, however it withdraws or with no method yet: "Available balance (USD)" ("(estimated USD)" only when money in its own Stripe account was converted), its number the server's Available. The hand-paid "Balance (USD)" card and its help are gone; do not bring a second version back.

- The four figures and the card come from the server only: `factory_balance(org)` (and `factory_balance(org, client)` for the client filter), with the owner's Stripe money added by `/api/stripe-connect` `balance` → `figures` (`withStripePart` keeps it while the database is read again). Total earnings is the server's figures added up (`summaryFrom`: the four plus `processing_cents`), never worked out on its own. Never sum payments into a figure in the browser.
- If the balance call answers 502 with `figures` (Stripe unreachable), show those figures; never blank the card.
- Withdraw when `has_method`, else "Add withdrawal method" (D6). Each Withdraw dialog's Available is what that method reaches (`withdrawReach`: the server's `reach` / `my_withdrawal_balance()`): Stripe = cleared owed money + money already in its Stripe account; PayPal/Wise = cleared owed money + the balance kept for them, never the Stripe account's.
- Refunded after it was withdrawn (20261121200000): Available already counts the debt and may read below zero; the card adds one line, "You owe TSC $X. A payment was refunded after you withdrew it." (`owedToTscLine`), and never promises to take it from later earnings (not decided). A refund or a lost dispute is its own dated row below zero ("Refunded" / "Dispute lost"); the step's row is never rewritten. A waiting withdrawal's block shows what it still holds, with "$X refunded" for the rest.
- An approved step reads "Added to your balance", never "Pending", unless all its money is in Pending (a card payment still clearing). Withdrawals on their way keep their own rows and words.
- The four tooltips above stay word for word unless Youssef approves a change. Pending was reworded on Nov 20 because it now also holds withdrawals on their way.

Run `npm run check:earnings`, `npm run check:payout-help` and `npm run build` after changing the card or the figures.
