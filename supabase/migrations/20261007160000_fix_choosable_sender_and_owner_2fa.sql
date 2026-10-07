-- ============================================================
-- 20261007130000 の修正
-- 1) 幹部の送信元に「送信時に選択（choosable）」を保存できるようにする
-- 2) オーナー二段階認証を、ログイン（Supabaseのsession_id）ごと・用途ごとに記録する
-- ============================================================

-- 1) admin_sender_mode の CHECK 制約を作り直す（元の制約名に依存しないよう、該当する制約を探して消す）
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'organization_mail_settings'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%admin_sender_mode%'
  loop
    execute format('alter table public.organization_mail_settings drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.organization_mail_settings
  add constraint organization_mail_settings_admin_sender_mode_check
  check (admin_sender_mode in ('organization_email', 'personal_email', 'choosable'));

-- 2) 二段階認証の記録に「用途」「送信先」「どのログインか」を持たせる
--    （前回のマイグレーションで作ったばかりで、正しく動く記録は1件もないので消してから列を足す）
delete from public.owner_2fa_verifications;
delete from public.owner_2fa_attempts;

alter table public.owner_2fa_verifications
  add column if not exists purpose text not null default 'login' check (purpose in ('login', 'register_email')),
  add column if not exists target_email text check (target_email is null or char_length(target_email) <= 320),
  add column if not exists auth_session_id text;

create index if not exists idx_owner_2fa_verifications_login
  on public.owner_2fa_verifications(member_id, purpose, auth_session_id, verified_at desc);
create index if not exists idx_owner_2fa_verifications_created
  on public.owner_2fa_verifications(member_id, created_at desc);

-- 個人メールは「その時点のオーナー本人」のもの。オーナーが替わったら新しいオーナーが登録し直す。
create index if not exists idx_owner_2fa_emails_member on public.owner_2fa_emails(member_id);

-- これらの表はサーバー（service role）からだけ読み書きする。ブラウザから直接は読ませない。
drop policy if exists "Owner can read own 2fa email" on public.owner_2fa_emails;
