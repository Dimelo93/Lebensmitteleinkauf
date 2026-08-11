-- TEIL 1 von 4: Tabellen
-- Danach muss unten "Success. No rows returned" stehen.

create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Haushalt',
  join_code   text not null unique,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text,
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.stores (
  id           uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null,
  color        text,
  note         text,
  position     integer not null default 0,
  deleted      boolean not null default false,
  updated_at   timestamptz not null default now()
);

create table if not exists public.items (
  id           uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  store_id     uuid,
  name         text not null,
  qty          numeric,
  unit         text,
  category     text,
  price        numeric,
  note         text,
  done         boolean not null default false,
  position     integer not null default 0,
  deleted      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.staples (
  id           uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  store_id     uuid,
  name         text not null,
  qty          numeric,
  unit         text,
  category     text,
  position     integer not null default 0,
  deleted      boolean not null default false,
  updated_at   timestamptz not null default now()
);

create table if not exists public.item_memory (
  household_id uuid not null references public.households(id) on delete cascade,
  key          text not null,
  label        text not null,
  store_id     uuid,
  unit         text,
  category     text,
  price        numeric,
  prices       jsonb not null default '{}'::jsonb,
  uses         integer not null default 1,
  last_used_at timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (household_id, key)
);

alter table public.item_memory
  add column if not exists prices jsonb not null default '{}'::jsonb;

create table if not exists public.trips (
  id           uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  finished_at  timestamptz not null default now(),
  total        numeric not null default 0,
  payload      jsonb not null default '{}'::jsonb,
  deleted      boolean not null default false,
  updated_at   timestamptz not null default now()
);

create table if not exists public.receipts (
  id           uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  store_id     uuid,
  store_name   text,
  purchased_at timestamptz,
  total        numeric,
  payload      jsonb not null default '{}'::jsonb,
  deleted      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists items_household_idx    on public.items (household_id);
create index if not exists items_updated_idx      on public.items (household_id, updated_at desc);
create index if not exists stores_household_idx   on public.stores (household_id);
create index if not exists staples_household_idx  on public.staples (household_id);
create index if not exists memory_household_idx   on public.item_memory (household_id);
create index if not exists trips_household_idx    on public.trips (household_id, finished_at desc);
create index if not exists receipts_household_idx on public.receipts (household_id, purchased_at desc);
create index if not exists members_user_idx       on public.household_members (user_id);
