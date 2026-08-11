-- ============================================================
--  Lebensmitteleinkauf - Datenbankschema fuer Supabase
-- ============================================================
--  Diese Datei ist die Zusammenfassung der vier Teildateien:
--    teil1-tabellen.sql, teil2-funktionen.sql,
--    teil3-rechte.sql, teil4-realtime.sql
--
--  Am Rechner: diese Datei in einem Rutsch in den SQL Editor.
--  Am Handy: lieber die vier Teile einzeln - ein langer Text
--  wird beim Einfuegen gern abgeschnitten.
--
--  Das Skript ist wiederholbar: mehrfaches Ausfuehren schadet
--  nicht. Anleitung: SUPABASE.md
-- ============================================================


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

-- TEIL 2 von 4: Funktionen und Trigger
-- Erst ausfuehren, wenn Teil 1 mit "Success" durchgelaufen ist.

create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = auth.uid()
  );
$$;

create or replace function public.generate_join_code()
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  i integer;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.households h where h.join_code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := greatest(now(), coalesce(new.updated_at, now()));
  return new;
end;
$$;

create or replace function public.create_household(household_name text default 'Haushalt',
                                                   member_name text default null)
returns table (id uuid, name text, join_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  code text;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;
  code := public.generate_join_code();
  insert into public.households (name, join_code)
  values (coalesce(nullif(trim(household_name), ''), 'Haushalt'), code)
  returning households.id into new_id;
  insert into public.household_members (household_id, user_id, display_name)
  values (new_id, auth.uid(), member_name);
  return query select h.id, h.name, h.join_code from public.households h where h.id = new_id;
end;
$$;

create or replace function public.join_household(code text, member_name text default null)
returns table (id uuid, name text, join_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  cleaned text;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;
  cleaned := upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
  select h.id into target from public.households h where h.join_code = cleaned;
  if target is null then
    raise exception 'Kein Haushalt mit diesem Code gefunden';
  end if;
  insert into public.household_members (household_id, user_id, display_name)
  values (target, auth.uid(), member_name)
  on conflict (household_id, user_id)
  do update set display_name = coalesce(excluded.display_name, public.household_members.display_name);
  return query select h.id, h.name, h.join_code from public.households h where h.id = target;
end;
$$;

create or replace function public.my_households()
returns table (id uuid, name text, join_code text)
language sql
stable
security definer
set search_path = public
as $$
  select h.id, h.name, h.join_code
  from public.households h
  join public.household_members m on m.household_id = h.id
  where m.user_id = auth.uid()
  order by m.joined_at;
$$;

drop trigger if exists touch_households on public.households;
create trigger touch_households before insert or update on public.households
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_stores on public.stores;
create trigger touch_stores before insert or update on public.stores
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_items on public.items;
create trigger touch_items before insert or update on public.items
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_staples on public.staples;
create trigger touch_staples before insert or update on public.staples
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_item_memory on public.item_memory;
create trigger touch_item_memory before insert or update on public.item_memory
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_trips on public.trips;
create trigger touch_trips before insert or update on public.trips
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_receipts on public.receipts;
create trigger touch_receipts before insert or update on public.receipts
  for each row execute function public.touch_updated_at();

-- TEIL 3 von 4: Zugriffsschutz
-- Ohne Mitgliedschaft im Haushalt gibt die Datenbank nichts heraus.

alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.stores            enable row level security;
alter table public.items             enable row level security;
alter table public.staples           enable row level security;
alter table public.item_memory       enable row level security;
alter table public.trips             enable row level security;
alter table public.receipts          enable row level security;

drop policy if exists households_select on public.households;
create policy households_select on public.households
  for select using (public.is_household_member(id));

drop policy if exists households_update on public.households;
create policy households_update on public.households
  for update using (public.is_household_member(id))
  with check (public.is_household_member(id));

drop policy if exists members_select on public.household_members;
create policy members_select on public.household_members
  for select using (user_id = auth.uid() or public.is_household_member(household_id));

drop policy if exists members_delete on public.household_members;
create policy members_delete on public.household_members
  for delete using (user_id = auth.uid());

drop policy if exists stores_all on public.stores;
create policy stores_all on public.stores for all
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists items_all on public.items;
create policy items_all on public.items for all
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists staples_all on public.staples;
create policy staples_all on public.staples for all
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists item_memory_all on public.item_memory;
create policy item_memory_all on public.item_memory for all
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists trips_all on public.trips;
create policy trips_all on public.trips for all
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists receipts_all on public.receipts;
create policy receipts_all on public.receipts for all
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on
  public.households, public.household_members, public.stores,
  public.items, public.staples, public.item_memory, public.trips,
  public.receipts
  to authenticated;

grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household(text, text)   to authenticated;
grant execute on function public.my_households()              to authenticated;
grant execute on function public.is_household_member(uuid)    to authenticated;

-- TEIL 4 von 4: Sofortige Aktualisierung zwischen Geraeten
-- Dieser Teil ist der einzige, der scheitern darf. Ohne ihn gleicht
-- die App alle 60 Sekunden ab statt sofort - nutzbar bleibt sie.

alter table public.stores      replica identity full;
alter table public.items       replica identity full;
alter table public.staples     replica identity full;
alter table public.item_memory replica identity full;
alter table public.trips       replica identity full;
alter table public.receipts    replica identity full;

do $$
declare
  t text;
begin
  foreach t in array array['stores', 'items', 'staples', 'item_memory', 'trips', 'receipts', 'households'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then null;
    end;
  end loop;
end;
$$;

-- Fertig. Als naechstes in den Projekt-Einstellungen:
--   Authentication -> Sign In / Providers -> "Anonymous sign-ins" einschalten.
