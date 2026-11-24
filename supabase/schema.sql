-- BoomBooth database. Paste into the Supabase SQL editor and run once.
-- Row Level Security is on with no policies, so only the server (secret key) can read or write.

create table if not exists sessions (
  session_id   text primary key,
  wristband_id text,
  mode         text,            -- 'wristband' or 'anonymous'
  started_at   timestamptz,
  ended_at     timestamptz,
  end_reason   text,            -- 'goodbye', 'hung_up_menu', 'hung_up_mid', 'timeout'
  voice        text,
  user_agent   text
);

create table if not exists events (
  id           bigserial primary key,
  session_id   text not null,
  wristband_id text,
  at           timestamptz,
  screen       text,
  type         text not null,
  data         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists events_session_idx on events (session_id);
create index if not exists events_type_idx on events (type);

create table if not exists wristbands (
  wristband_id text primary key,
  state        jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

alter table sessions   enable row level security;
alter table events     enable row level security;
alter table wristbands enable row level security;
