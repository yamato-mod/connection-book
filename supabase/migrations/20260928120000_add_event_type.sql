-- Add event_type column for calendar color coding
-- regular = 定例会 (green), guest = ゲスト参加回 (yellow), external = 外部イベント (red)
alter table public.events
  add column event_type text not null default 'regular'
    check (event_type in ('regular', 'guest', 'external'));
