-- ログイン用リンクを組織Gmailから送るときの、送りすぎ防止の記録。
-- サーバー（service role）からだけ読み書きする。
create table if not exists public.login_link_requests (
  id bigint generated always as identity primary key,
  email text not null check (char_length(email) <= 320),
  ip text not null default '' check (char_length(ip) <= 100),
  created_at timestamptz not null default now()
);
create index if not exists idx_login_link_requests_email on public.login_link_requests(email, created_at desc);
create index if not exists idx_login_link_requests_ip on public.login_link_requests(ip, created_at desc);
alter table public.login_link_requests enable row level security;
