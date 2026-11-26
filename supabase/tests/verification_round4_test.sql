-- Verification, fourth round (20261126101000…): a registration number's
-- label is dropped only in its own country.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- R16: each country's own label; the same cases as check-registration-number.mjs
select is(public.normalise_registration_number('PT', 'NIF 519211596'), '519211596', 'R16: NIF dropped in Portugal');
select is(public.normalise_registration_number('PT', 'N.º 519 211 596'), '519211596', 'R16: N.º dropped in Portugal');
select is(public.normalise_registration_number('TR', 'Vergi No: 4837261591'), '4837261591', 'R16: Vergi No dropped in Turkey');
select is(public.normalise_registration_number('CN', '统一社会信用代码：91330100MA2B7C4D3F'), '91330100MA2B7C4D3F', 'R16: the Chinese label dropped in China');
select is(public.normalise_registration_number('CN', 'USCC: 91330100MA2B7C4D3F'), '91330100MA2B7C4D3F', 'R16: USCC dropped in China');
select is(public.normalise_registration_number('NO', 'NO 123456789 MVA'), 'NO123456789MVA', 'R16: a Norwegian number keeps its NO');
select is(public.normalise_registration_number('GB', 'VAT 123456789'), 'VAT123456789', 'R16: VAT is not a label anywhere');
select is(public.normalise_registration_number('GB', 'NIF 519211596'), 'NIF519211596', 'R16: Portugal''s label is kept elsewhere');
select is(public.normalise_registration_number('PT', 'VKN 4837261591'), 'VKN4837261591', 'R16: Turkey''s label is kept elsewhere');
select is(public.normalise_registration_number('TR', 'USCC 91330100MA2B7C4D3F'), 'USCC91330100MA2B7C4D3F', 'R16: China''s label is kept elsewhere');
select is(public.normalise_registration_number('GB', '统一社会信用代码 12345'), '统一社会信用代码12345', 'R16: the Chinese label is kept elsewhere');
select is(public.normalise_registration_number(null, 'NO 12345'), 'NO12345', 'R16: "No" without a colon is kept');
select is(public.normalise_registration_number(null, 'No: 12345'), '12345', 'R16: "No:" is dropped anywhere');
select is(public.normalise_registration_number('GB', 'Nr: 12345'), '12345', 'R16: "Nr:" is dropped anywhere');

select * from finish();
rollback;
