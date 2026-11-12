# Payout UI instructions

### Preserve payout explanations and tooltips (John, Nov 11, 2026)

The payout page’s explainer text and help tooltips are required product content. Keep the balance, available balance, pending balance and four earnings-summary helpers, transaction guidance, billing guidance, and withdrawal/setup/security explanations visible. Preserve mouse, keyboard and tap access through PaymentHelp. Do not delete, hide in CSS, or shorten these away during design parity, copy cleanup, provider-name cleanup or merges. The earlier Nov 6 “no more explanation on screen” rule does not apply to payout explanations or tooltips. Update inaccurate copy to match current payment behavior rather than removing it. Removal requires an explicit new user instruction. Run npm run check:payout-help and npm run build after payout UI changes.
