-- Contract selections never change the source RFQ or delete its documents.
create table public.quote_contract_attachments (
  quote_id uuid primary key references public.quotes(id) on delete cascade,
  document_ids uuid[] not null
);
alter table public.quote_contract_attachments enable row level security;
revoke all on public.quote_contract_attachments from anon, authenticated;

alter table public.production_orders add column contract_attachment_ids uuid[];

create function public.save_contract_attachments(target_quote uuid, selected_documents uuid[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.quotes; r public.rfqs;
begin
  select * into q from public.quotes where id = target_quote for update;
  select * into r from public.rfqs where id = q.rfq_id for update;
  if r.id is null or not public.is_org_owner(r.brand_org_id) then
    raise exception 'Only the requesting brand owner can edit contract attachments' using errcode = '42501';
  end if;
  if q.status <> 'submitted' or r.status <> 'open'
    or exists (select 1 from public.production_orders where quote_id = target_quote) then
    raise exception 'Contract attachments can no longer be edited' using errcode = '22023';
  end if;
  if selected_documents is null or exists (
    select 1 from unnest(selected_documents) s(id)
    where not exists (
      select 1 from public.documents d where d.id = s.id and d.org_id = r.brand_org_id
      and (d.rfq_id = r.id or (d.kind = 'contract' and d.bucket = 'org-private'
        and split_part(d.storage_path, '/', 3) = q.id::text))
    )
  ) then
    raise exception 'Choose files belonging to this request or contract' using errcode = '22023';
  end if;
  insert into public.quote_contract_attachments values (target_quote, selected_documents)
  on conflict (quote_id) do update set document_ids = excluded.document_ids;
end;
$$;

create function public.snapshot_contract_attachments()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    if new.contract_attachment_ids is distinct from old.contract_attachment_ids then
      raise exception 'Contract attachments are fixed when the order is created' using errcode = '42501';
    end if;
  else
    select document_ids into new.contract_attachment_ids
    from public.quote_contract_attachments where quote_id = new.quote_id;
    if new.contract_attachment_ids is null then
      select coalesce(array_agg(id order by created_at), '{}'::uuid[]) into new.contract_attachment_ids
      from public.documents where rfq_id = new.rfq_id and org_id = new.brand_org_id;
    end if;
  end if;
  return new;
end;
$$;
create trigger snapshot_contract_attachments before insert or update on public.production_orders
for each row execute function public.snapshot_contract_attachments();

create function public.get_contract_attachments(target_quote uuid)
returns setof public.documents language plpgsql stable security definer set search_path = public, pg_temp as $$
declare q public.quotes; r public.rfqs; o public.production_orders; ids uuid[];
begin
  select * into q from public.quotes where id = target_quote;
  select * into r from public.rfqs where id = q.rfq_id;
  select * into o from public.production_orders where quote_id = target_quote;
  if r.id is null or not (public.is_org_member(r.brand_org_id)
    or (o.id is not null and public.is_order_party(o.id))) then
    raise exception 'Contract not available' using errcode = '42501';
  end if;
  if o.id is not null then
    ids := o.contract_attachment_ids;
  else
    select document_ids into ids from public.quote_contract_attachments where quote_id = target_quote;
  end if;
  -- NULL means no selection yet (or a legacy order); [] is deliberately empty.
  return query select d.* from public.documents d
  where d.org_id = r.brand_org_id and
    ((ids is null and d.rfq_id = r.id) or d.id = any(ids))
  order by d.created_at, d.id;
end;
$$;

-- New uploads are private until awarded; both order participants can then open them.
create function public.can_read_contract_file(file_bucket text, file_path text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.production_orders o join public.documents d
      on d.id = any(o.contract_attachment_ids) and d.org_id = o.brand_org_id
    where d.bucket = file_bucket and d.storage_path = file_path and public.is_order_party(o.id)
  );
$$;
create policy documents_contract_read on public.documents for select to authenticated
using (public.can_read_contract_file(bucket, storage_path));
create policy "contract participant private read" on storage.objects for select to authenticated
using (bucket_id = 'org-private' and public.can_read_contract_file(bucket_id, name));

revoke all on function public.save_contract_attachments(uuid, uuid[]), public.get_contract_attachments(uuid),
  public.can_read_contract_file(text, text), public.snapshot_contract_attachments() from public;
grant execute on function public.save_contract_attachments(uuid, uuid[]), public.get_contract_attachments(uuid),
  public.can_read_contract_file(text, text) to authenticated;
notify pgrst, 'reload schema';
