-- Operational state for real Google integrations and per-device event selection.
alter table public.devices add column selected_event_id uuid references public.events(id) on delete set null;
alter table public.members add column selected_event_id uuid references public.events(id) on delete set null;

alter table public.contacts
  add column google_person_resource_name text,
  add column people_sync_status text not null default 'pending' check (people_sync_status in ('pending','processing','synced','failed','skipped')),
  add column people_sync_error text,
  add column gmail_draft_id text,
  add column gmail_draft_status text not null default 'pending' check (gmail_draft_status in ('pending','processing','created','failed','skipped')),
  add column gmail_draft_error text;

alter table public.business_cards
  add column image_name text,
  add column image_mime_type text,
  add column drive_status text not null default 'pending' check (drive_status in ('pending','processing','uploaded','failed','skipped')),
  add column drive_error text;

alter table public.followups
  add column google_calendar_event_id text,
  add column calendar_status text not null default 'pending' check (calendar_status in ('pending','processing','created','failed','skipped')),
  add column calendar_error text;

alter table public.email_logs
  add column template_subject text,
  add column template_body text;

create table public.integration_jobs (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  operation text not null check (operation in ('drive_upload','people_sync','gmail_draft','gmail_send','calendar_create')),
  status text not null default 'pending' check (status in ('pending','processing','succeeded','failed')),
  idempotency_key uuid not null unique,
  requested_by uuid not null references public.members(id) on delete restrict,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index devices_selected_event_id_idx on public.devices(selected_event_id);
create index members_selected_event_id_idx on public.members(selected_event_id);
create index contacts_club_people_status_idx on public.contacts(club_id, people_sync_status) where people_sync_status <> 'synced';
create index followups_club_status_due_idx on public.followups(club_id, status, due_at);
create index integration_jobs_club_status_idx on public.integration_jobs(club_id, status, created_at desc);
create index integration_jobs_contact_id_idx on public.integration_jobs(contact_id);
create index integration_jobs_requested_by_idx on public.integration_jobs(requested_by);

alter table public.integration_jobs enable row level security;
revoke all on public.integration_jobs from anon, authenticated;
grant select on public.integration_jobs to authenticated;
create policy integration_jobs_read on public.integration_jobs for select to authenticated
using (club_id=(select private.current_club_id()));

-- Server handlers own writes to integration_jobs. Existing table updates remain
-- available to authenticated club members and are constrained by RLS.

create or replace function public.register_business_card_contact(
  p_club_id uuid,
  p_member_id uuid,
  p_event_id uuid,
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
declare new_contact_id uuid;
declare matched_organization_id uuid;
begin
  if nullif(trim(coalesce(p_contact->>'company','')), '') is not null then
    insert into public.organizations (club_id, name, website)
    values (p_club_id, p_contact->>'company', nullif(p_contact->>'website',''))
    on conflict (club_id, name) do update
      set website = coalesce(excluded.website, public.organizations.website)
    returning id into matched_organization_id;
  end if;

  insert into public.contacts (
    club_id, organization_id, owner_member_id, name, company_name, role, email, phone,
    phone_normalized, address, website, classification, created_by
  ) values (
    p_club_id, matched_organization_id, p_member_id, p_contact->>'name', coalesce(p_contact->>'company',''),
    coalesce(p_contact->>'role',''), nullif(p_contact->>'email',''),
    coalesce(p_contact->>'phone',''), regexp_replace(coalesce(p_contact->>'phone',''), '[^0-9]', '', 'g'),
    coalesce(p_contact->>'address',''), coalesce(p_contact->>'website',''),
    p_contact->>'classification', p_member_id
  ) returning id into new_contact_id;

  insert into public.business_cards (
    club_id, contact_id, captured_by, image_sha256, image_name,
    image_mime_type, ocr_raw_text, ocr_corrected
  ) values (
    p_club_id, new_contact_id, p_member_id, p_image_sha256, p_image_name,
    p_image_mime_type, p_ocr_raw_text, p_ocr_corrected
  );

  if nullif(trim(coalesce(p_contact->>'notes','')), '') is not null then
    insert into public.notes (club_id, contact_id, author_member_id, body)
    values (p_club_id, new_contact_id, p_member_id, p_contact->>'notes');
  end if;

  if p_event_id is not null then
    insert into public.event_contacts (event_id, contact_id, club_id, met_by)
    values (p_event_id, new_contact_id, p_club_id, p_member_id);
  end if;

  if p_contact->>'classification' = 'important' then
    insert into public.followups (club_id, contact_id, assigned_member_id, due_at, content)
    values (p_club_id, new_contact_id, p_member_id, now(), '要手動対応');
  end if;

  insert into public.audit_logs (club_id, actor_member_id, action, entity_type, entity_id)
  values (p_club_id, p_member_id, 'contact_registered', 'contact', new_contact_id);
  return new_contact_id;
end;
$$;
revoke all on function public.register_business_card_contact(uuid,uuid,uuid,jsonb,text,boolean,text,text,text) from public, anon, authenticated;
grant execute on function public.register_business_card_contact(uuid,uuid,uuid,jsonb,text,boolean,text,text,text) to service_role;
