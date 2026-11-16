# Payout UI instructions

### Preserve payout explanations and tooltips (John, Nov 11, 2026)

The payout page’s explainer text and help tooltips are required product content. Keep the balance, available balance, pending balance and four earnings-summary helpers, transaction guidance, billing guidance, and withdrawal/setup/security explanations visible. Preserve mouse, keyboard and tap access through PaymentHelp. Do not delete, hide in CSS, or shorten these away during design parity, copy cleanup, provider-name cleanup or merges. The earlier Nov 6 “no more explanation on screen” rule does not apply to payout explanations or tooltips. Update inaccurate copy to match current payment behavior rather than removing it. Removal requires an explicit new user instruction. Run npm run check:payout-help and npm run build after payout UI changes.

### Preserve John's reviewed withdrawal UI and copy (Nov 16, 2026)

The payout UI and text reviewed with John on `claude/nov16-withdrawals` are approved product decisions. Do not rewrite, restore older copy, remove, hide, restyle or rearrange them during backend work, design parity, cleanup or merges. Change them only when the user explicitly requests that particular UI or text change. This instruction supersedes older preservation guidance where John explicitly simplified the content below.

- Keep the four earnings tooltips exactly as reviewed: Total earnings — "Your earnings from funded payments for the selected client, or all clients. Includes payments awaiting approval." Awaiting approval — "Funds waiting for the brand to approve the milestone. Once approved, they move toward your available balance." Pending — "Pending payments become available to withdraw after processing." Paid out — "Money that has been paid out to you". Do not restore the removed "No action is needed" sentence or the older Paid out explanation.
- Keep the Withdraw dialog in the shared TSC modal: destination dropdown with arrow first; amount below with the "Withdraw full amount" button beside its label; available balance underneath; Cancel and Withdraw in the footer. The full-amount button fills the input, and entering more than available immediately caps the input at the available amount. Do not restore the removed fee, receive-amount or processing-time prose in this dialog. Preserve server validation and refusal messages.
- Keep the reviewed Withdrawal methods layout: compact Add button, aligned provider icon/details/menu, actual PayPal logo, and subdued sentence-case Default badge under the account details. Preserve mobile wrapping and alignment.
- Keep the client filter's dropdown arrow.
- Keep balance and main actions in the top row of the balance card, with the pending withdrawal amount, destination and owner's Cancel action in a separate full-width row under a divider. Preserve the compact mobile stack; do not restore the large blank gap or nest the pending row inside the balance column.
- Saving the first/default withdrawal method must refresh the withdrawal balance immediately; never require a browser refresh to reveal Withdraw. Preserve the default-method dependency on `useWithdrawalBalance` in both the payout page and card.

Before merging, check the diff for accidental changes to these decisions. Run `npm run check:payout-help`, `npm run check:css` and `npm run build` for payout UI changes.
