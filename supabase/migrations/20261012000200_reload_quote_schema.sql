-- PostgREST can retain its pre-migration column list briefly. Reload it now so
-- the quote UI can select unit_price_max_cents immediately after deployment.
notify pgrst, 'reload schema';
