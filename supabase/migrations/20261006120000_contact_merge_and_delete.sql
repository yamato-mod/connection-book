-- 1) Re-registering a business card for someone already in the library no longer creates a second contact row.
--    The user chooses: 'overwrite' (new non-empty values replace the old ones) or 'append' (keep existing values,
--    record the new card's differing values next to them as a note). Either way the new card image, event
--    attendance, note and follow-up attach to the existing contact.
create or replace function public.merge_business_card_into_contact(
  p_club_id uuid,
  p_member_id uuid,
  p_event_id uuid,
  p_target_contact_id uuid,
  p_mode text,
  p_contact jsonb,
  p_ocr_raw_text text,
  p_ocr_corrected boolean,
  p_image_sha256 text,
  p_image_name text,
  p_image_mime_type text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare existing public.contacts%rowtype;
declare matched_organization_id uuid;
declare diff text := '';
declare v text;
begin
  if p_mode not in ('overwrite', 'append') then
    raise exception 'invalid merge mode %', p_mode;
  end if;
  select * into existing from public.contacts where id = p_target_contact_id and club_id = p_club_id for update;
  if not found then
    raise exception 'contact not found' using errcode = 'P0002';
  end if;

  if p_mode = 'overwrite' then
    if nullif(trim(coalesce(p_contact->>'company','')), '') is not null then
      insert into public.organizations (club_id, name, website)
      values (p_club_id, p_contact->>'company', nullif(p_contact->>'website',''))
      on conflict (club_id, name) do update
        set website = coalesce(excluded.website, public.organizations.website)
      returning id into matched_organization_id;
    end if;
    -- Empty values on the new card never wipe existing information.
    update public.contacts set
      organization_id = coalesce(matched_organization_id, existing.organization_id),
      name = coalesce(nullif(trim(p_contact->>'name'),''), existing.name),
      company_name = coalesce(nullif(trim(p_contact->>'company'),''), existing.company_name),
      role = coalesce(nullif(trim(p_contact->>'role'),''), existing.role),
      email = coalesce(nullif(trim(p_contact->>'email'),''), existing.email),
      phone = coalesce(nullif(trim(p_contact->>'phone'),''), existing.phone),
      phone_normalized = case when nullif(trim(p_contact->>'phone'),'') is null then existing.phone_normalized
                              else regexp_replace(p_contact->>'phone', '[^0-9]', '', 'g') end,
      address = coalesce(nullif(trim(p_contact->>'address'),''), existing.address),
      website = coalesce(nullif(trim(p_contact->>'website'),''), existing.website),
      classification = coalesce(nullif(p_contact->>'classification',''), existing.classification),
      last_contact_at = now(),
      updated_at = now()
    where id = existing.id;
  else
    -- 併記: keep current values, list what the new card says differently.
    v := nullif(trim(p_contact->>'name'),'');    if v is not null and v <> existing.name then diff := diff || E'\n氏名: ' || v; end if;
    v := nullif(trim(p_contact->>'company'),''); if v is not null and v <> existing.company_name then diff := diff || E'\n会社・団体: ' || v; end if;
    v := nullif(trim(p_contact->>'role'),'');    if v is not null and v <> existing.role then diff := diff || E'\n役職: ' || v; end if;
    v := nullif(trim(p_contact->>'email'),'');   if v is not null and lower(v) <> coalesce(existing.email_normalized,'') then diff := diff || E'\nメール: ' || v; end if;
    v := nullif(trim(p_contact->>'phone'),'');   if v is not null and regexp_replace(v,'[^0-9]','','g') <> existing.phone_normalized then diff := diff || E'\n電話: ' || v; end if;
    v := nullif(trim(p_contact->>'address'),''); if v is not null and v <> existing.address then diff := diff || E'\n住所: ' || v; end if;
    v := nullif(trim(p_contact->>'website'),''); if v is not null and v <> existing.website then diff := diff || E'\nWeb: ' || v; end if;
    if diff <> '' then
      insert into public.notes (club_id, contact_id, author_member_id, body)
      values (p_club_id, existing.id, p_member_id, '【別の名刺の情報（併記）】' || diff);
    end if;
    update public.contacts set last_contact_at = now(), updated_at = now() where id = existing.id;
  end if;

  insert into public.business_cards (
    club_id, contact_id, captured_by, image_sha256, image_name,
    image_mime_type, ocr_raw_text, ocr_corrected
  ) values (
    p_club_id, existing.id, p_member_id, p_image_sha256, p_image_name,
    p_image_mime_type, p_ocr_raw_text, p_ocr_corrected
  );

  if nullif(trim(coalesce(p_contact->>'notes','')), '') is not null then
    insert into public.notes (club_id, contact_id, author_member_id, body)
    values (p_club_id, existing.id, p_member_id, p_contact->>'notes');
  end if;

  if p_event_id is not null then
    insert into public.event_contacts (event_id, contact_id, club_id, met_by)
    values (p_event_id, existing.id, p_club_id, p_member_id)
    on conflict (event_id, contact_id) do nothing;
  end if;

  if p_contact->>'classification' = 'important' then
    insert into public.followups (club_id, contact_id, assigned_member_id, due_at, content)
    values (p_club_id, existing.id, p_member_id, now(), '要手動対応');
  end if;

  insert into public.audit_logs (club_id, actor_member_id, action, entity_type, entity_id, metadata)
  values (p_club_id, p_member_id, 'contact_merged', 'contact', existing.id, jsonb_build_object('mode', p_mode));
  return existing.id;
end;
$$;
revoke all on function public.merge_business_card_into_contact(uuid,uuid,uuid,uuid,text,jsonb,text,boolean,text,text,text) from public, anon, authenticated;
grant execute on function public.merge_business_card_into_contact(uuid,uuid,uuid,uuid,text,jsonb,text,boolean,text,text,text) to service_role;

-- 2) Owners/admins can delete a contact. email_logs / email_send_requests reference contacts with
--    ON DELETE RESTRICT, which is why deletion was impossible once a thank-you mail had been sent.
--    They are removed in the same transaction; everything else cascades. Returns the Drive file ids
--    of the card images so the API can move them to the Drive trash.
create or replace function public.delete_contact(
  p_club_id uuid,
  p_member_id uuid,
  p_contact_id uuid
) returns text[]
language plpgsql
security invoker
set search_path = ''
as $$
declare files text[];
declare mail_count integer;
begin
  if not exists (select 1 from public.contacts where id = p_contact_id and club_id = p_club_id) then
    raise exception 'contact not found' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(f), '{}') into files from (
    select google_file_id as f from public.google_files where contact_id = p_contact_id and club_id = p_club_id
    union
    select image_google_file_id from public.business_cards where contact_id = p_contact_id and club_id = p_club_id and image_google_file_id is not null
  ) x;
  select count(*) into mail_count from public.email_logs where contact_id = p_contact_id and club_id = p_club_id;
  delete from public.email_send_requests where contact_id = p_contact_id and club_id = p_club_id;
  delete from public.email_logs where contact_id = p_contact_id and club_id = p_club_id;
  delete from public.contacts where id = p_contact_id and club_id = p_club_id;
  -- No personal data in the audit trail, only that a deletion happened.
  insert into public.audit_logs (club_id, actor_member_id, action, entity_type, entity_id, metadata)
  values (p_club_id, p_member_id, 'contact_deleted', 'contact', p_contact_id, jsonb_build_object('email_logs_removed', mail_count, 'files', coalesce(array_length(files,1),0)));
  return files;
end;
$$;
revoke all on function public.delete_contact(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.delete_contact(uuid,uuid,uuid) to service_role;
