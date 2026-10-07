-- 2026-10-07〜08 に SQL Editor で作った表に、サーバー（service role）の権限を明示する。
-- 既に付いていても害はない。ブラウザ側（anon / authenticated）には付けない。
grant select, insert, update, delete on table
  public.login_link_requests,
  public.owner_2fa_emails,
  public.owner_2fa_verifications,
  public.owner_2fa_attempts,
  public.announcements,
  public.job_postings,
  public.business_contests
to service_role;
grant usage, select on sequence public.login_link_requests_id_seq to service_role;
