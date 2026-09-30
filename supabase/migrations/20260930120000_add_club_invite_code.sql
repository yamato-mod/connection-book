-- Add an invite code to clubs so members can self-join by entering the code.
-- The code is auto-generated as an 8-character uppercase alphanumeric string.

alter table public.clubs
  add column invite_code text unique;

-- Generate invite codes for existing clubs
update public.clubs
set invite_code = upper(substr(md5(random()::text || id::text), 1, 8))
where invite_code is null;

-- Make it not null after filling existing rows
alter table public.clubs
  alter column invite_code set not null,
  alter column invite_code set default upper(substr(md5(random()::text), 1, 8));

-- Add a check constraint for format
alter table public.clubs
  add constraint clubs_invite_code_format check (invite_code ~ '^[A-Z0-9]{6,12}$');

-- Index for quick lookups
create index clubs_invite_code_idx on public.clubs (invite_code);

-- Notify PostgREST to pick up the schema change
notify pgrst, 'reload schema';
