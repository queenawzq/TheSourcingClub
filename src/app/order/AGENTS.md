# Payout UI instructions

### Preserve payout explanations and tooltips (John, Nov 11, 2026)

The payout page’s explainer text and help tooltips are required product content. Keep the balance, available balance, pending balance and four earnings-summary helpers, transaction guidance, billing guidance, and withdrawal/setup/security explanations visible. Preserve mouse, keyboard and tap access through PaymentHelp. Do not delete, hide in CSS, or shorten these away during design parity, copy cleanup, provider-name cleanup or merges. The earlier Nov 6 “no more explanation on screen” rule does not apply to payout explanations or tooltips. Update inaccurate copy to match current payment behavior rather than removing it. Removal requires an explicit new user instruction. Run npm run check:payout-help and npm run build after payout UI changes.

### Preserve John's reviewed withdrawal UI and copy (Nov 16, 2026)

The payout UI and text reviewed with John on `claude/nov16-withdrawals` are approved product decisions. Do not rewrite, restore older copy, remove, hide, restyle or rearrange them during backend work, design parity, cleanup or merges. Change them only when the user explicitly requests that particular UI or text change. This instruction supersedes older preservation guidance where John explicitly simplified the content below.

- Keep the four earnings tooltips exactly as reviewed: Total earnings — "Your earnings from funded payments for the selected client, or all clients. Includes payments awaiting approval." Awaiting approval — "Funds waiting for the brand to approve the milestone. Once approved, they move toward your available balance." Pending — "Payments still processing and withdrawals on their way to you." (changed Nov 20: under one balance, Pending also holds withdrawals on their way) Paid out — "Money that has been paid out to you". Do not restore the removed "No action is needed" sentence or the older Paid out explanation.
- Keep the Withdraw dialog in the shared TSC modal: destination dropdown with arrow first; amount below with the "Withdraw full amount" button beside its label; available balance underneath; Cancel and Withdraw in the footer. The full-amount button fills the input, and entering more than available immediately caps the input at the available amount. Do not restore the removed fee, receive-amount or processing-time prose in this dialog. Preserve server validation and refusal messages.
- Keep the reviewed Withdrawal methods layout: compact Add button, aligned provider icon/details/menu, actual PayPal logo, and subdued sentence-case Default badge under the account details. Preserve mobile wrapping and alignment.
- Keep the client filter's dropdown arrow.
- Keep balance and main actions in the top row of the balance card, with the pending withdrawal amount, destination and owner's Cancel action in a separate full-width row under a divider. Preserve the compact mobile stack; do not restore the large blank gap or nest the pending row inside the balance column.
- Saving the first/default withdrawal method must refresh the withdrawal balance immediately; never require a browser refresh to reveal Withdraw. Preserve the default-method dependency on `useWithdrawalBalance` in both the payout page and card.

Before merging, check the diff for accidental changes to these decisions. Run `npm run check:payout-help`, `npm run check:css` and `npm run build` for payout UI changes.

### One balance, one card (Nov 20, 2026)

Every factory has the same Earnings card, however it withdraws or with no method yet: "Available balance (USD)" ("(estimated USD)" only when money in its own Stripe account was converted), its number the server's Available. The hand-paid "Balance (USD)" card and its help are gone; do not bring a second version back.

- The four figures and the card come from the server only: `factory_balance(org)` (and `factory_balance(org, client)` for the client filter), with the owner's Stripe money added by `/api/stripe-connect` `balance` → `figures` (`withStripePart` keeps it while the database is read again). Total earnings is the four added up (`summaryFrom`), never worked out on its own. Never sum payments into a figure in the browser.
- If the balance call answers 502 with `figures` (Stripe unreachable), show those figures; never blank the card.
- Withdraw when `has_method`, else "Add withdrawal method" (D6). Each Withdraw dialog's Available is what that method reaches (`withdrawReach`: the server's `reach` / `my_withdrawal_balance()`): Stripe = cleared owed money + money already in its Stripe account; PayPal/Wise = cleared owed money + the balance kept for them, never the Stripe account's.
- An approved step reads "Added to your balance", never "Pending", unless all its money is in Pending (a card payment still clearing). Withdrawals on their way keep their own rows and words.
- The four tooltips above stay word for word unless Youssef approves a change. Pending was reworded on Nov 20 because it now also holds withdrawals on their way.

Run `npm run check:earnings`, `npm run check:payout-help` and `npm run build` after changing the card or the figures.
