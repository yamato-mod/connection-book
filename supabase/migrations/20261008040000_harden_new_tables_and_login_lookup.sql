-- 1) 10/07以降に作った表は、作成時の初期設定でブラウザ側（anon / authenticated）の権限が付いていた。
--    データの読み書きはすべてサーバー（service role）のAPIを通す設計なので、ブラウザ側の権限を外す。
revoke all on table
  public.announcements,
  public.job_postings,
  public.business_contests,
  public.owner_2fa_emails,
  public.owner_2fa_verifications,
  public.owner_2fa_attempts,
  public.login_link_requests,
  public.backup_runs
from anon, authenticated;

-- 2) ログインリンク送信の前に「このメールの人は既にアカウントがあるか」を調べる（アカウントを作らずに）。
--    サーバー（service role）だけが呼べる。
create or replace function public.auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1
$$;
revoke all on function public.auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_id_by_email(text) to service_role;
