-- ============================================================
--  Lebensmitteleinkauf - Datenbankschema fuer Supabase
-- ============================================================
--  Einmal komplett in den SQL Editor von Supabase kopieren
--  und ausfuehren. Das Skript ist wiederholbar: es loescht
--  vorhandene Policies und Funktionen sauber vorher weg.
--
--  Anleitung Schritt fuer Schritt: siehe SUPABASE.md
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tabellen
-- ------------------------------------------------------------

-- Ein Haushalt ist die geteilte Einkaufsliste. Wer den
-- Beitrittscode kennt, kann Mitglied werden.
create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Haushalt',
  join_code   text not null unique,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Verknuepfung Benutzer <-> Haushalt. Die Benutzer sind
-- anonyme Supabase-Konten, die im Hintergrund erzeugt werden;
-- niemand muss ein Passwort setzen.
create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text,
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- Laeden in der Reihenfolge, in der eingekauft wird.
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

-- Artikel der aktuellen Einkaufsliste.
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

-- Vorlagen fuer den Wocheneinkauf: Artikel, die immer wieder
-- gebraucht werden und per Knopfdruck in die Liste wandern.
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

-- Artikel-Gedaechtnis: welcher Laden, welche Einheit, welcher
-- Preis gehoert erfahrungsgemaess zu welchem Artikelnamen.
-- prices haelt je Laden den zuletzt bezahlten und den mittleren
-- Preis - das ist die Datengrundlage fuer den Ladenvergleich in
-- der Quittungs-Analyse.
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

-- Falls das Schema schon einmal ohne prices angelegt wurde.
alter table public.item_memory
  add column if not exists prices jsonb not null default '{}'::jsonb;

-- Analysierte Quittungen: Foto-Positionen, erkannte Summen und
-- die Sparvorschlaege, damit man spaeter nachschauen kann.
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

-- Abgeschlossene Einkaeufe mit Summen. payload haelt die
-- Artikelzeilen als JSON, damit der Verlauf beliebig
-- detailliert bleibt, ohne eine zweite Tabelle zu brauchen.
create table if not exists public.trips (
  id           uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  finished_at  timestamptz not null default now(),
  total        numeric not null default 0,
  payload      jsonb not null default '{}'::jsonb,
  deleted      boolean not null default false,
  updated_at   timestamptz not null default now()
);

create index if not exists items_household_idx      on public.items (household_id);
create index if not exists items_updated_idx        on public.items (household_id, updated_at desc);
create index if not exists stores_household_idx     on public.stores (household_id);
create index if not exists staples_household_idx    on public.staples (household_id);
create index if not exists memory_household_idx     on public.item_memory (household_id);
create index if not exists trips_household_idx      on public.trips (household_id, finished_at desc);
create index if not exists receipts_household_idx   on public.receipts (household_id, purchased_at desc);
create index if not exists members_user_idx         on public.household_members (user_id);

-- ------------------------------------------------------------
-- 2. Hilfsfunktionen
-- ------------------------------------------------------------

-- Mitgliedschaftspruefung als SECURITY DEFINER, damit die
-- Policies auf household_members sich nicht selbst aufrufen
-- (sonst Endlosrekursion in der RLS-Auswertung).
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members m
    where m.household_id = hid
      and m.user_id = auth.uid()
  );
$$;

-- Beitrittscode aus einem Alphabet ohne verwechselbare
-- Zeichen (kein O/0, kein I/1) - laesst sich am Telefon
-- durchgeben, ohne dass jemand nachfragen muss.
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

-- updated_at automatisch nachfuehren, egal ob die Aenderung
-- vom Handy, vom Laptop oder aus dem SQL-Editor kommt.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := greatest(now(), coalesce(new.updated_at, now()));
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['households', 'stores', 'items', 'staples', 'item_memory', 'trips', 'receipts'] loop
    execute format('drop trigger if exists touch_%1$s on public.%1$s', t);
    execute format(
      'create trigger touch_%1$s before insert or update on public.%1$s
         for each row execute function public.touch_updated_at()', t);
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- 3. RPCs: Haushalt anlegen und beitreten
-- ------------------------------------------------------------

-- Legt einen Haushalt an und macht den Aufrufer zum Mitglied.
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

  return query
    select h.id, h.name, h.join_code
    from public.households h
    where h.id = new_id;
end;
$$;

-- Tritt einem Haushalt per Code bei. Gross-/Kleinschreibung
-- und Leerzeichen sind egal.
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

  select h.id into target
  from public.households h
  where h.join_code = cleaned;

  if target is null then
    raise exception 'Kein Haushalt mit diesem Code gefunden';
  end if;

  insert into public.household_members (household_id, user_id, display_name)
  values (target, auth.uid(), member_name)
  on conflict (household_id, user_id)
  do update set display_name = coalesce(excluded.display_name, public.household_members.display_name);

  return query
    select h.id, h.name, h.join_code
    from public.households h
    where h.id = target;
end;
$$;

-- Alle Haushalte des angemeldeten Geraets - wird beim Start
-- aufgerufen, damit die App nach einer Neuinstallation den
-- Haushalt wiederfindet.
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

-- ------------------------------------------------------------
-- 4. Row Level Security
-- ------------------------------------------------------------
-- Ohne Mitgliedschaft im Haushalt sieht ein Konto nichts.
-- Der oeffentliche anon key allein reicht also nicht, um
-- fremde Einkaufslisten zu lesen.

alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.stores            enable row level security;
alter table public.items             enable row level security;
alter table public.staples           enable row level security;
alter table public.item_memory       enable row level security;
alter table public.trips             enable row level security;
alter table public.receipts          enable row level security;

drop policy if exists households_select on public.households;
drop policy if exists households_update on public.households;
create policy households_select on public.households
  for select using (public.is_household_member(id));
create policy households_update on public.households
  for update using (public.is_household_member(id))
  with check (public.is_household_member(id));

drop policy if exists members_select on public.household_members;
drop policy if exists members_delete on public.household_members;
create policy members_select on public.household_members
  for select using (user_id = auth.uid() or public.is_household_member(household_id));
create policy members_delete on public.household_members
  for delete using (user_id = auth.uid());

-- Datentabellen: gleiche Regel fuer alle vier Operationen.
do $$
declare
  t text;
begin
  foreach t in array array['stores', 'items', 'staples', 'item_memory', 'trips', 'receipts'] loop
    execute format('drop policy if exists %1$s_all on public.%1$s', t);
    execute format(
      'create policy %1$s_all on public.%1$s
         for all
         using (public.is_household_member(household_id))
         with check (public.is_household_member(household_id))', t);
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- 5. Realtime
-- ------------------------------------------------------------
-- Damit das Abhaken im Laden sofort auf dem anderen Handy
-- sichtbar wird. Fehler beim Hinzufuegen bedeuten meist, dass
-- die Tabelle schon in der Publication ist - unkritisch.

do $$
declare
  t text;
begin
  foreach t in array array['stores', 'items', 'staples', 'item_memory', 'trips', 'receipts', 'households'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then
        raise notice 'Publication supabase_realtime fehlt - Realtime im Dashboard aktivieren.';
    end;
  end loop;
end;
$$;

-- Volle Zeilendaten bei UPDATE/DELETE mitsenden, sonst kommen
-- beim anderen Geraet nur die Primaerschluessel an.
alter table public.stores      replica identity full;
alter table public.items       replica identity full;
alter table public.staples     replica identity full;
alter table public.item_memory replica identity full;
alter table public.trips       replica identity full;
alter table public.receipts    replica identity full;

-- ------------------------------------------------------------
-- 6. Rechte
-- ------------------------------------------------------------

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

-- Fertig. Als naechstes in den Projekt-Einstellungen:
--   Authentication -> Sign In / Providers -> "Anonymous sign-ins" einschalten.
