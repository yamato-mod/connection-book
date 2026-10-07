-- 広島大学起業部 1st Penguin Club 規約（2026-10 改定）に合わせた部員管理。
--   第7条  入部は代表又は権限を付与された幹部が承認して名簿に登録する → status 'pending' → 'active'
--   第10条 休部しても資格・議決権は失わない                         → status 'on_leave'（ログイン可）
--   第11条 退部時は団体アカウントの権限を解除する                     → status 'withdrawn'（再入部は再承認）
--   第12条 名簿：氏名・資格・連絡先・入退部日・休部状況・役職           → roster columns below
--   第13条 代表・副代表・会計・幹部                                   → position
--   第35/36条 アクセスの一時制限・活動停止                            → status 'suspended' + suspended_until
--   人脈情報（名刺）は幹部と、幹部が承認した部員だけが詳細を見られる      → library_access + requests

alter table public.members
  add column position text not null default 'member'
    check (position in ('representative', 'vice_representative', 'treasurer', 'executive', 'member')),
  add column status text not null default 'active'
    check (status in ('pending', 'active', 'on_leave', 'suspended', 'withdrawn')),
  add column status_reason text not null default '',
  add column status_changed_at timestamptz not null default now(),
  add column suspended_until timestamptz,
  add column joined_at timestamptz,
  add column left_at timestamptz,
  add column contact_email text not null default '',
  add column library_access boolean not null default false,
  add column library_access_granted_by uuid references public.members(id) on delete set null,
  add column library_access_granted_at timestamptz;

-- Backfill from the old two-field model.
update public.members set
  position = case access_role when 'owner' then 'representative' when 'admin' then 'executive' else 'member' end,
  status = case when is_active then 'active' else 'withdrawn' end,
  joined_at = created_at,
  left_at = case when is_active then null else updated_at end;
update public.members m set contact_email = coalesce(u.email, '')
  from auth.users u where u.id = m.auth_user_id;

-- 代表 ⇔ owner, 副代表・会計・幹部 ⇔ admin, 部員 ⇔ member. Existing permission checks keep using access_role.
alter table public.members add constraint members_position_access_role_consistency check (
  (position = 'representative' and access_role = 'owner')
  or (position in ('vice_representative', 'treasurer', 'executive') and access_role = 'admin')
  or (position = 'member' and access_role = 'member')
);

-- One trigger keeps the derived fields consistent so older code paths can't break the rules:
--   * is_active (used by auth checks and RLS helpers) follows status
--   * position ⇔ access_role ⇔ is_admin (a position change wins; an access_role change maps onto a position)
create or replace function private.members_sync_derived() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.position is distinct from old.position then
    new.access_role := case new.position when 'representative' then 'owner' when 'member' then 'member' else 'admin' end;
  elsif tg_op = 'INSERT' or new.access_role is distinct from old.access_role then
    new.position := case
      when new.access_role = 'owner' then 'representative'
      when new.access_role = 'admin' and new.position in ('vice_representative', 'treasurer', 'executive') then new.position
      when new.access_role = 'admin' then 'executive'
      else 'member' end;
  end if;
  new.is_admin := new.access_role in ('owner', 'admin');
  new.is_active := new.status in ('active', 'on_leave');
  if new.is_active and new.joined_at is null then new.joined_at := now(); end if;
  if new.status = 'withdrawn' and new.left_at is null then new.left_at := now(); end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then new.status_changed_at := now(); end if;
  if new.status <> 'suspended' then new.suspended_until := null; end if;
  return new;
end;
$$;
create trigger members_sync_derived before insert or update on public.members
  for each row execute function private.members_sync_derived();
-- Re-run once so existing rows go through the trigger logic.
update public.members set status = status;

create index members_club_status_idx on public.members (club_id, status);

-- 部員からの名刺ライブラリ閲覧申請。
create table public.library_access_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references public.members(id) on delete set null,
  decided_at timestamptz,
  decision_note text not null default '',
  created_at timestamptz not null default now()
);
create unique index library_access_requests_one_pending_idx on public.library_access_requests (member_id) where status = 'pending';
create index library_access_requests_club_idx on public.library_access_requests (club_id, status);
alter table public.library_access_requests enable row level security;
revoke all on public.library_access_requests from anon, authenticated;

-- Owner transfer now moves the 代表 position too (new 代表 must be an active officer; the former 代表 becomes 幹部).
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
      and access_role = 'admin' and status = 'active'
  ) then raise exception 'New owner must be an active admin'; end if;
  update public.members set access_role = 'admin', is_admin = true, position = 'executive', updated_at = now()
    where id = p_current_owner_id and club_id = p_club_id;
  update public.members set access_role = 'owner', is_admin = true, position = 'representative', updated_at = now()
    where id = p_new_owner_id and club_id = p_club_id;
end;
$$;
revoke all on function public.transfer_organization_owner(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.transfer_organization_owner(uuid,uuid,uuid) to service_role;

-- The browser only uses Supabase for sign-in; every read goes through the server API, which applies the
-- position/library-access rules above. Close the direct table reads that let any signed-in member query
-- contacts, notes, mail history or the roster (incl. contact_email) with the public key.
revoke select on all tables in schema public from anon, authenticated;
