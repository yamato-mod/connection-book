-- Organization CRM roles, two distinct Google connection types, and
-- app-originated email delivery metadata. Existing clubs/members are retained.
alter table public.members
  add column access_role text not null default 'member'
    check (access_role in ('owner', 'admin', 'member'));

update public.members set access_role = case when is_admin then 'admin' else 'member' end;

with ranked_admins as (
  select id, row_number() over (partition by club_id order by created_at, id) as rank
  from public.members
  where is_admin and is_active and auth_user_id is not null
)
update public.members as members
set access_role = 'owner'
from ranked_admins
where members.id = ranked_admins.id and ranked_admins.rank = 1;

update public.members set is_admin = access_role in ('owner', 'admin');
alter table public.members add constraint members_access_role_admin_consistency
  check (is_admin = (access_role in ('owner', 'admin')));
create unique index members_one_active_owner_per_club_idx on public.members (club_id)
  where access_role = 'owner' and is_active;

create table public.organization_google_connections (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null unique references public.clubs(id) on delete cascade,
  google_email text not null,
  encrypted_refresh_token text not null,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  connected_by_member_id uuid not null references public.members(id) on delete restrict,
  connected_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'revoked', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_google_connections (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  member_id uuid not null unique references public.members(id) on delete cascade,
  google_email text not null,
  encrypted_refresh_token text not null,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'revoked', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_mail_settings (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  admin_sender_mode text not null default 'organization_email'
    check (admin_sender_mode in ('organization_email', 'personal_email')),
  member_sender_mode text not null default 'personal_email'
    check (member_sender_mode in ('personal_email', 'organization_email')),
  auto_cc_organization_email boolean not null default true,
  allow_member_to_disable_cc boolean not null default false,
  updated_by_member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.organization_mail_settings (club_id)
select id from public.clubs on conflict (club_id) do nothing;

alter table public.email_logs
  add column actual_from_email text,
  add column sender_mode text not null default 'organization_email'
    check (sender_mode in ('organization_email', 'personal_email')),
  add column cc_emails text[] not null default '{}',
  add column bcc_emails text[] not null default '{}',
  add column gmail_thread_id text,
  add column status text not null default 'sent' check (status in ('pending', 'sent', 'failed')),
  add column error_message text;
alter table public.email_logs alter column sent_at drop not null;

create index members_auth_user_active_idx on public.members (auth_user_id, is_active)
  where auth_user_id is not null;
create index user_google_connections_club_id_idx on public.user_google_connections(club_id);
create index email_logs_club_status_created_idx on public.email_logs(club_id, status, created_at desc);

create or replace function private.current_access_role()
returns text language sql stable security definer set search_path = ''
as $$ select access_role from public.members
      where auth_user_id = (select auth.uid()) and is_active limit 1 $$;
revoke execute on function private.current_access_role() from public, anon;
grant execute on function private.current_access_role() to authenticated;

create or replace function private.current_member_id()
returns uuid language sql stable security definer set search_path = ''
as $$ select id from public.members
      where auth_user_id = (select auth.uid()) and is_active limit 1 $$;
revoke execute on function private.current_member_id() from public, anon;
grant execute on function private.current_member_id() to authenticated;

create or replace function public.transfer_organization_owner(
  p_club_id uuid,
  p_current_owner_id uuid,
  p_new_owner_id uuid
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.members
    where id = p_current_owner_id and club_id = p_club_id
      and access_role = 'owner' and is_active
  ) then raise exception 'Current owner is invalid'; end if;
  if not exists (
    select 1 from public.members
    where id = p_new_owner_id and club_id = p_club_id
      and access_role = 'admin' and is_active
  ) then raise exception 'New owner must be an active admin'; end if;
  update public.members set access_role = 'admin', is_admin = true, updated_at = now()
    where id = p_current_owner_id and club_id = p_club_id;
  update public.members set access_role = 'owner', is_admin = true, updated_at = now()
    where id = p_new_owner_id and club_id = p_club_id;
end;
$$;
revoke all on function public.transfer_organization_owner(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.transfer_organization_owner(uuid,uuid,uuid) to service_role;

alter table public.organization_google_connections enable row level security;
alter table public.user_google_connections enable row level security;
alter table public.organization_mail_settings enable row level security;
revoke all on public.organization_google_connections from anon, authenticated;
revoke all on public.user_google_connections from anon, authenticated;
revoke all on public.organization_mail_settings from anon, authenticated;
grant select on public.organization_mail_settings to authenticated;
create policy organization_mail_settings_read on public.organization_mail_settings
  for select to authenticated using (club_id = (select private.current_club_id()));

-- The browser is read-only. Every mutation is re-authorized by a server Route
-- Handler using the authenticated user's organization membership and role.
revoke insert, update, delete on all tables in schema public from authenticated;

drop policy if exists email_logs_read on public.email_logs;
create policy email_logs_role_read on public.email_logs
  for select to authenticated
  using (
    club_id = (select private.current_club_id())
    and (
      (select private.current_access_role()) in ('owner', 'admin')
      or sender_member_id = (select private.current_member_id())
    )
  );

-- Google connection rows intentionally have no browser grants or RLS policies.
-- Secret-key server handlers are the only code allowed to read token ciphertext.
