-- Calendar metadata for organization-owned Google Calendar events. Tokens stay
-- in organization_google_connections and are never copied into event rows.
alter table public.events
  add column description text not null default '',
  add column google_calendar_event_id text,
  add column google_html_link text,
  add column calendar_source text not null default 'app'
    check (calendar_source in ('app', 'google')),
  add column calendar_sync_status text not null default 'local'
    check (calendar_sync_status in ('local', 'pending', 'synced', 'failed')),
  add column calendar_error text,
  add column google_updated_at timestamptz,
  add column all_day boolean not null default false;

create unique index events_club_google_event_unique_idx
  on public.events(club_id, google_calendar_event_id)
  where google_calendar_event_id is not null;

create index events_club_starts_at_idx
  on public.events(club_id, starts_at);
