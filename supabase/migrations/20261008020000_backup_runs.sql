-- 組織Googleドライブへのバックアップの記録。サーバー（service role）からだけ読み書きする。
create table if not exists public.backup_runs (
  id bigint generated always as identity primary key,
  club_id uuid not null references public.clubs(id) on delete cascade,
  trigger text not null check (trigger in ('scheduled', 'manual')),
  status text not null check (status in ('succeeded', 'failed')),
  file_name text,
  drive_file_id text,
  bytes integer,
  row_count integer,
  error_message text check (error_message is null or char_length(error_message) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists idx_backup_runs_club on public.backup_runs(club_id, created_at desc);
alter table public.backup_runs enable row level security;
grant select, insert, update, delete on table public.backup_runs to service_role;
grant usage, select on sequence public.backup_runs_id_seq to service_role;
