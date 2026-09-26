create extension if not exists pgcrypto;
create schema if not exists private;

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email_domain text,
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  role text not null default '',
  signature_display_name text not null default '',
  signature text not null default '',
  is_admin boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  device_id_hash text not null,
  label text not null default '',
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (club_id, device_id_hash)
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null,
  kind text not null default 'company' check (kind in ('company','university','government','other')),
  website text,
  created_at timestamptz not null default now(),
  unique (club_id, name)
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  owner_member_id uuid references public.members(id) on delete set null,
  name text not null,
  company_name text not null default '',
  university_name text not null default '',
  organization_name text not null default '',
  role text not null default '',
  email text,
  email_normalized text generated always as (lower(trim(email))) stored,
  phone text not null default '',
  phone_normalized text not null default '',
  address text not null default '',
  website text not null default '',
  classification text not null check (classification in ('important','courtesy','undecided','no_contact')),
  first_contact_at timestamptz not null default now(),
  last_contact_at timestamptz not null default now(),
  created_by uuid not null references public.members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_cards (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  captured_by uuid not null references public.members(id),
  image_google_file_id text,
  image_sha256 text,
  ocr_provider text not null default 'tesseract',
  ocr_raw_text text,
  ocr_corrected boolean not null default false,
  captured_at timestamptz not null default now(),
  check (image_google_file_id is not null or image_sha256 is not null)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text not null default '',
  is_current boolean not null default false,
  created_by uuid not null references public.members(id),
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);

create unique index events_one_current_per_club_idx on public.events(club_id) where is_current;

create table public.event_contacts (
  event_id uuid not null references public.events(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  met_by uuid not null references public.members(id),
  met_at timestamptz not null default now(),
  primary key (event_id, contact_id)
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null,
  color text not null default '#176b45',
  unique (club_id, name)
);

create table public.contact_tags (
  contact_id uuid not null references public.contacts(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  primary key (contact_id, tag_id)
);

create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null,
  default_subject text not null,
  default_body text not null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid not null references public.members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, name)
);

create unique index email_templates_one_default_idx on public.email_templates(club_id) where is_default and is_active;

create table public.email_logs (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  recipient_email text not null,
  sender_member_id uuid not null references public.members(id) on delete restrict,
  template_id uuid references public.email_templates(id) on delete set null,
  event_id uuid references public.events(id) on delete set null,
  final_subject text not null,
  final_body text not null,
  sent_at timestamptz not null,
  gmail_message_id text unique,
  duplicate_override boolean not null default false,
  duplicate_override_reason text,
  created_at timestamptz not null default now(),
  check (not duplicate_override or nullif(trim(duplicate_override_reason), '') is not null)
);

create table public.email_send_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  requested_by uuid not null references public.members(id) on delete restrict,
  idempotency_key uuid not null unique,
  status text not null check (status in ('processing','sent','failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.followups (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  assigned_member_id uuid not null references public.members(id),
  due_at timestamptz not null,
  content text not null,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  author_member_id uuid not null references public.members(id),
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.google_files (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  google_file_id text not null unique,
  kind text not null check (kind in ('business_card','related_document')),
  name text not null,
  web_view_link text,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  club_id uuid not null references public.clubs(id) on delete restrict,
  actor_member_id uuid references public.members(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index members_club_id_idx on public.members(club_id);
create index devices_member_id_idx on public.devices(member_id);
create index organizations_club_id_idx on public.organizations(club_id);
create index contacts_club_created_idx on public.contacts(club_id, created_at desc);
create index contacts_club_email_idx on public.contacts(club_id, email_normalized) where email_normalized is not null;
create index contacts_club_phone_idx on public.contacts(club_id, phone_normalized) where phone_normalized <> '';
create index contacts_club_name_company_idx on public.contacts(club_id, lower(name), lower(company_name));
create index contacts_owner_member_id_idx on public.contacts(owner_member_id);
create index contacts_organization_id_idx on public.contacts(organization_id);
create index business_cards_contact_id_idx on public.business_cards(contact_id);
create index business_cards_captured_by_idx on public.business_cards(captured_by);
create index events_created_by_idx on public.events(created_by);
create index event_contacts_contact_id_idx on public.event_contacts(contact_id);
create index event_contacts_club_id_idx on public.event_contacts(club_id);
create index tags_club_id_idx on public.tags(club_id);
create index contact_tags_tag_id_idx on public.contact_tags(tag_id);
create index contact_tags_club_id_idx on public.contact_tags(club_id);
create index email_templates_created_by_idx on public.email_templates(created_by);
create index email_logs_contact_sent_idx on public.email_logs(contact_id, sent_at desc);
create index email_logs_club_recipient_idx on public.email_logs(club_id, lower(recipient_email), sent_at desc);
create index email_logs_sender_member_id_idx on public.email_logs(sender_member_id);
create index email_logs_template_id_idx on public.email_logs(template_id);
create index email_logs_event_id_idx on public.email_logs(event_id);
create index email_send_requests_contact_id_idx on public.email_send_requests(contact_id);
create index email_send_requests_requested_by_idx on public.email_send_requests(requested_by);
create index followups_assignee_due_idx on public.followups(assigned_member_id, due_at) where status='open';
create index followups_contact_id_idx on public.followups(contact_id);
create index notes_contact_created_idx on public.notes(contact_id, created_at desc);
create index notes_author_member_id_idx on public.notes(author_member_id);
create index google_files_contact_id_idx on public.google_files(contact_id);
create index audit_logs_club_created_idx on public.audit_logs(club_id, created_at desc);
create index audit_logs_actor_member_id_idx on public.audit_logs(actor_member_id);

create or replace function private.current_club_id()
returns uuid language sql stable security definer set search_path=''
as $$ select club_id from public.members where auth_user_id=(select auth.uid()) and is_active limit 1 $$;
revoke execute on function private.current_club_id() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.current_club_id() to authenticated;

alter table public.clubs enable row level security;
alter table public.members enable row level security;
alter table public.devices enable row level security;
alter table public.organizations enable row level security;
alter table public.contacts enable row level security;
alter table public.business_cards enable row level security;
alter table public.events enable row level security;
alter table public.event_contacts enable row level security;
alter table public.tags enable row level security;
alter table public.contact_tags enable row level security;
alter table public.email_templates enable row level security;
alter table public.email_logs enable row level security;
alter table public.email_send_requests enable row level security;
alter table public.followups enable row level security;
alter table public.notes enable row level security;
alter table public.google_files enable row level security;
alter table public.audit_logs enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.clubs, public.members, public.organizations, public.contacts, public.business_cards, public.events, public.event_contacts, public.tags, public.contact_tags, public.email_templates, public.email_logs, public.followups, public.notes, public.google_files to authenticated;
grant insert, update on public.devices, public.organizations, public.contacts, public.business_cards, public.events, public.event_contacts, public.tags, public.contact_tags, public.email_templates, public.followups, public.notes, public.google_files to authenticated;
grant delete on public.event_contacts, public.contact_tags, public.followups, public.notes to authenticated;

create policy clubs_read on public.clubs for select to authenticated using (id=(select private.current_club_id()));
create policy members_read on public.members for select to authenticated using (club_id=(select private.current_club_id()));

do $$
declare table_name text;
begin
  foreach table_name in array array['devices','organizations','contacts','business_cards','events','event_contacts','tags','contact_tags','email_templates','email_logs','email_send_requests','followups','notes','google_files','audit_logs'] loop
    execute format('create policy %I on public.%I for select to authenticated using (club_id=(select private.current_club_id()))', table_name||'_read', table_name);
  end loop;
  foreach table_name in array array['devices','organizations','contacts','business_cards','events','event_contacts','tags','contact_tags','email_templates','followups','notes','google_files'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check (club_id=(select private.current_club_id()))', table_name||'_insert', table_name);
    execute format('create policy %I on public.%I for update to authenticated using (club_id=(select private.current_club_id())) with check (club_id=(select private.current_club_id()))', table_name||'_update', table_name);
  end loop;
  foreach table_name in array array['event_contacts','contact_tags','followups','notes'] loop
    execute format('create policy %I on public.%I for delete to authenticated using (club_id=(select private.current_club_id()))', table_name||'_delete', table_name);
  end loop;
end $$;

-- email_logs, email_send_requests and audit_logs intentionally have no client write grants/policies.
-- They are append-only through authenticated server Route Handlers using the secret key.
