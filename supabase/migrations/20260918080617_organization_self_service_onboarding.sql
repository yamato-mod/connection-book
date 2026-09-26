-- Self-service organization onboarding. The browser cannot insert organization
-- rows directly; an authenticated server handler calls this atomic RPC with the
-- service role after verifying the Supabase user.
alter table public.clubs
  add column organization_type text not null default 'student_organization'
    check (organization_type in ('university_club', 'student_organization', 'other')),
  add column created_by_auth_user_id uuid references auth.users(id) on delete set null;

create index clubs_created_by_auth_user_id_idx
  on public.clubs(created_by_auth_user_id)
  where created_by_auth_user_id is not null;

create or replace function public.create_organization_for_user(
  p_auth_user_id uuid,
  p_organization_name text,
  p_organization_type text,
  p_owner_name text,
  p_owner_title text default ''
) returns table (club_id uuid, member_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_club_id uuid;
  created_member_id uuid;
begin
  if p_auth_user_id is null then
    raise exception 'Authenticated user is required';
  end if;
  if length(trim(p_organization_name)) < 2 or length(trim(p_organization_name)) > 120 then
    raise exception 'Organization name is invalid';
  end if;
  if p_organization_type not in ('university_club', 'student_organization', 'other') then
    raise exception 'Organization type is invalid';
  end if;
  if length(trim(p_owner_name)) < 1 or length(trim(p_owner_name)) > 120 then
    raise exception 'Owner name is invalid';
  end if;
  if length(trim(coalesce(p_owner_title, ''))) > 120 then
    raise exception 'Owner title is invalid';
  end if;

  -- Serialize onboarding attempts for the same Auth user. The members table also
  -- has a unique auth_user_id constraint as a final race-condition guard.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_auth_user_id::text, 0)
  );

  if exists (
    select 1 from public.members where auth_user_id = p_auth_user_id
  ) then
    raise exception 'User already belongs to an organization';
  end if;

  insert into public.clubs (name, organization_type, created_by_auth_user_id)
  values (trim(p_organization_name), p_organization_type, p_auth_user_id)
  returning id into created_club_id;

  insert into public.members (
    club_id,
    auth_user_id,
    name,
    role,
    signature_display_name,
    signature,
    is_admin,
    is_active,
    access_role
  ) values (
    created_club_id,
    p_auth_user_id,
    trim(p_owner_name),
    trim(coalesce(p_owner_title, '')),
    trim(p_owner_name),
    concat_ws(E'\n', trim(p_owner_name), nullif(trim(coalesce(p_owner_title, '')), '')),
    true,
    true,
    'owner'
  ) returning id into created_member_id;

  insert into public.organization_mail_settings (
    club_id,
    updated_by_member_id
  ) values (
    created_club_id,
    created_member_id
  );

  insert into public.email_templates (
    club_id,
    name,
    default_subject,
    default_body,
    is_default,
    created_by
  ) values (
    created_club_id,
    '標準お礼メール',
    '先日はありがとうございました',
    E'{{name}} 様\n\n先日は貴重なお時間をいただき、ありがとうございました。\n今後ともどうぞよろしくお願いいたします。',
    true,
    created_member_id
  );

  insert into public.audit_logs (
    club_id,
    actor_member_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    created_club_id,
    created_member_id,
    'organization_created',
    'club',
    created_club_id,
    jsonb_build_object('organization_type', p_organization_type)
  );

  return query select created_club_id, created_member_id;
end;
$$;

revoke all on function public.create_organization_for_user(uuid,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.create_organization_for_user(uuid,text,text,text,text)
  to service_role;
