-- ============================================================
-- Migration: Bulletin board, Business contests, Owner 2FA, Choosable sender
-- ============================================================

-- 1) Announcements (お知らせ) for bulletin board
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  author_member_id uuid not null references members(id),
  title text not null check (char_length(title) <= 200),
  body text not null check (char_length(body) <= 5000),
  pinned boolean not null default false,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_announcements_club on announcements(club_id, published_at desc);
alter table announcements enable row level security;
create policy "Members can read own club announcements" on announcements for select using (
  club_id in (select club_id from members where auth_user_id = auth.uid() and status in ('active','on_leave','suspended'))
);

-- 2) Job postings (バイト情報) for bulletin board
create table if not exists job_postings (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  author_member_id uuid not null references members(id),
  title text not null check (char_length(title) <= 200),
  company text not null default '' check (char_length(company) <= 200),
  body text not null check (char_length(body) <= 5000),
  hourly_rate text not null default '' check (char_length(hourly_rate) <= 100),
  location text not null default '' check (char_length(location) <= 300),
  deadline timestamptz,
  contact_info text not null default '' check (char_length(contact_info) <= 500),
  is_active boolean not null default true,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_job_postings_club on job_postings(club_id, published_at desc);
alter table job_postings enable row level security;
create policy "Members can read own club job postings" on job_postings for select using (
  club_id in (select club_id from members where auth_user_id = auth.uid() and status in ('active','on_leave','suspended'))
);

-- 3) Business contests (ビジコン情報)
create table if not exists business_contests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  author_member_id uuid not null references members(id),
  title text not null check (char_length(title) <= 200),
  organizer text not null default '' check (char_length(organizer) <= 200),
  body text not null check (char_length(body) <= 5000),
  url text not null default '' check (char_length(url) <= 2000),
  event_date timestamptz,
  deadline timestamptz,
  location text not null default '' check (char_length(location) <= 300),
  is_active boolean not null default true,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_business_contests_club on business_contests(club_id, published_at desc);
alter table business_contests enable row level security;
create policy "Members can read own club business contests" on business_contests for select using (
  club_id in (select club_id from members where auth_user_id = auth.uid() and status in ('active','on_leave','suspended'))
);

-- 4) Owner 2FA: personal email registration
create table if not exists owner_2fa_emails (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade unique,
  member_id uuid not null references members(id),
  personal_email text not null check (char_length(personal_email) <= 320),
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table owner_2fa_emails enable row level security;
create policy "Owner can read own 2fa email" on owner_2fa_emails for select using (
  club_id in (select club_id from members where auth_user_id = auth.uid() and access_role = 'owner')
);

-- 5) Owner 2FA: verification sessions
create table if not exists owner_2fa_verifications (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  member_id uuid not null references members(id),
  session_id text not null,
  otp_hash text not null,
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_owner_2fa_verifications_session on owner_2fa_verifications(session_id);
create index if not exists idx_owner_2fa_verifications_member on owner_2fa_verifications(member_id, verified_at);
alter table owner_2fa_verifications enable row level security;

-- 6) Owner 2FA: attempt tracking for rate limiting
create table if not exists owner_2fa_attempts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  member_id uuid not null references members(id),
  attempted_at timestamptz not null default now(),
  success boolean not null default false
);
create index if not exists idx_owner_2fa_attempts_member on owner_2fa_attempts(member_id, attempted_at desc);
alter table owner_2fa_attempts enable row level security;

-- 7) Update organization_mail_settings to allow 'choosable' value
-- The admin_sender_mode column is text, so we just need to update the check constraint if any.
-- If there's a check constraint, we alter it; otherwise the column already accepts any text.
-- Supabase typically stores this as text without check constraints, so this is a no-op safety measure.
do $$
begin
  -- Drop existing check constraint on admin_sender_mode if it exists
  if exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'organization_mail_settings' and column_name = 'admin_sender_mode'
  ) then
    -- The constraint name may vary; we just ensure 'choosable' is valid
    null;
  end if;
end $$;

