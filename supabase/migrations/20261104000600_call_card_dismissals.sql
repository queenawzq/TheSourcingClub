-- Deleting a declined card affects only the viewer, retaining shared call history.
create table public.call_card_dismissals (
  call_id uuid not null references public.calls(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (call_id, user_id)
);
alter table public.call_card_dismissals enable row level security;
grant select, insert, update on public.call_card_dismissals to authenticated;
create policy call_card_dismissals_read on public.call_card_dismissals for select to authenticated using (user_id = auth.uid());
create policy call_card_dismissals_insert on public.call_card_dismissals for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.calls c where c.id = call_id and c.status = 'declined' and public.is_thread_party(c.thread_id))
);
create policy call_card_dismissals_update on public.call_card_dismissals for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid() and exists (select 1 from public.calls c where c.id = call_id and c.status = 'declined' and public.is_thread_party(c.thread_id))
);
notify pgrst, 'reload schema';
