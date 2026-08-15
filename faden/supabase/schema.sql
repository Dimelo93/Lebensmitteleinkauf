-- ============================================================
--  Faden - Datenbankschema fuer Supabase
-- ============================================================
--  Kann in dasselbe Supabase-Projekt wie die Einkaufsliste: alle
--  Namen tragen das Praefix faden_, nichts kollidiert.
--
--  Der Sync-Raum ist absichtlich NICHT der Haushalt der
--  Einkaufsliste: die Liste teilst du mit dem Partner, die Notizen
--  sind persoenlich. Den Faden-Code gibt man nur auf den eigenen
--  Geraeten ein.
--
--  Das Skript ist wiederholbar: mehrfaches Ausfuehren schadet
--  nicht. Anleitung: faden/README.md
-- ============================================================


-- TEIL 1 von 4: Tabellen
-- Danach muss unten "Success. No rows returned" stehen.

create table if not exists public.faden_raeume (
  id            uuid primary key default gen_random_uuid(),
  name          text not null default 'Mein Faden',
  beitrittscode text not null unique,
  erstellt      timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.faden_mitglieder (
  raum_id    uuid not null references public.faden_raeume(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  beigetreten timestamptz not null default now(),
  primary key (raum_id, user_id)
);

create table if not exists public.faden_notizen (
  id         uuid primary key,
  raum_id    uuid not null references public.faden_raeume(id) on delete cascade,
  titel      text not null default '',
  text       text not null default '',
  typ        text not null default 'notiz',
  status     text,
  naechster  text,
  inbox      boolean not null default false,
  tags       jsonb not null default '[]'::jsonb,
  angeheftet boolean not null default false,
  geloescht  boolean not null default false,
  erstellt   timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists faden_notizen_raum_idx    on public.faden_notizen (raum_id);
create index if not exists faden_notizen_updated_idx on public.faden_notizen (raum_id, updated_at desc);
create index if not exists faden_mitglieder_user_idx on public.faden_mitglieder (user_id);

-- TEIL 2 von 4: Funktionen und Trigger
-- Erst ausfuehren, wenn Teil 1 mit "Success" durchgelaufen ist.

create or replace function public.faden_ist_mitglied(rid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.faden_mitglieder m
    where m.raum_id = rid and m.user_id = auth.uid()
  );
$$;

create or replace function public.faden_code_erzeugen()
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
    exit when not exists (select 1 from public.faden_raeume r where r.beitrittscode = code);
  end loop;
  return code;
end;
$$;

create or replace function public.faden_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := greatest(now(), coalesce(new.updated_at, now()));
  return new;
end;
$$;

-- Konfliktloesung fuer Notizen: der Zeitstempel des Geraets zaehlt,
-- und eine aeltere Fassung darf eine neuere nie ueberschreiben.
--
-- Warum nicht einfach touch_updated_at wie bei den Raeumen? Das
-- wuerde jeden Push auf now() stempeln - dann gewinnt, wer zuletzt
-- SENDET, nicht wer zuletzt SCHREIBT. Ein Geraet, das nach zwei
-- Tagen offline seine alte Fassung hochschiebt, wuerde damit die
-- neuere Arbeit des anderen Geraets ausloeschen. Der Waechter
-- verwirft solche veralteten Upserts einfach (return null).
create or replace function public.faden_notizen_lww()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and new.updated_at is not null
     and old.updated_at is not null
     and new.updated_at < old.updated_at then
    return null;
  end if;
  new.updated_at := coalesce(new.updated_at, now());
  return new;
end;
$$;

create or replace function public.faden_raum_anlegen(raum_name text default 'Mein Faden')
returns table (id uuid, name text, beitrittscode text)
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
  code := public.faden_code_erzeugen();
  insert into public.faden_raeume (name, beitrittscode)
  values (coalesce(nullif(trim(raum_name), ''), 'Mein Faden'), code)
  returning faden_raeume.id into new_id;
  insert into public.faden_mitglieder (raum_id, user_id)
  values (new_id, auth.uid());
  return query select r.id, r.name, r.beitrittscode from public.faden_raeume r where r.id = new_id;
end;
$$;

create or replace function public.faden_raum_beitreten(code text)
returns table (id uuid, name text, beitrittscode text)
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
  select r.id into target from public.faden_raeume r where r.beitrittscode = cleaned;
  if target is null then
    raise exception 'Kein Sync-Raum mit diesem Code gefunden';
  end if;
  insert into public.faden_mitglieder (raum_id, user_id)
  values (target, auth.uid())
  on conflict (raum_id, user_id) do nothing;
  return query select r.id, r.name, r.beitrittscode from public.faden_raeume r where r.id = target;
end;
$$;

create or replace function public.faden_meine_raeume()
returns table (id uuid, name text, beitrittscode text)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.name, r.beitrittscode
  from public.faden_raeume r
  join public.faden_mitglieder m on m.raum_id = r.id
  where m.user_id = auth.uid()
  order by m.beigetreten;
$$;

drop trigger if exists faden_touch_raeume on public.faden_raeume;
create trigger faden_touch_raeume before insert or update on public.faden_raeume
  for each row execute function public.faden_touch_updated_at();

drop trigger if exists faden_touch_notizen on public.faden_notizen;
create trigger faden_touch_notizen before insert or update on public.faden_notizen
  for each row execute function public.faden_notizen_lww();

-- TEIL 3 von 4: Zugriffsschutz
-- Ohne Mitgliedschaft im Raum gibt die Datenbank nichts heraus.

alter table public.faden_raeume     enable row level security;
alter table public.faden_mitglieder enable row level security;
alter table public.faden_notizen    enable row level security;

drop policy if exists faden_raeume_select on public.faden_raeume;
create policy faden_raeume_select on public.faden_raeume
  for select using (public.faden_ist_mitglied(id));

drop policy if exists faden_raeume_update on public.faden_raeume;
create policy faden_raeume_update on public.faden_raeume
  for update using (public.faden_ist_mitglied(id))
  with check (public.faden_ist_mitglied(id));

drop policy if exists faden_mitglieder_select on public.faden_mitglieder;
create policy faden_mitglieder_select on public.faden_mitglieder
  for select using (user_id = auth.uid() or public.faden_ist_mitglied(raum_id));

drop policy if exists faden_mitglieder_delete on public.faden_mitglieder;
create policy faden_mitglieder_delete on public.faden_mitglieder
  for delete using (user_id = auth.uid());

drop policy if exists faden_notizen_all on public.faden_notizen;
create policy faden_notizen_all on public.faden_notizen for all
  using (public.faden_ist_mitglied(raum_id))
  with check (public.faden_ist_mitglied(raum_id));

grant usage on schema public to anon, authenticated;

grant select, insert, delete on
  public.faden_raeume, public.faden_mitglieder, public.faden_notizen
  to authenticated;
grant update on public.faden_mitglieder, public.faden_notizen to authenticated;

-- Am Raum selbst darf ein Mitglied nur den Namen aendern. Der
-- Beitrittscode ist der Schluessel zu den Notizen - koennte ihn
-- jedes Mitglied per Update ueberschreiben, waeren die anderen
-- Geraete beim naechsten Wiedereintritt ausgesperrt.
revoke update on public.faden_raeume from authenticated;
grant update (name) on public.faden_raeume to authenticated;

grant execute on function public.faden_raum_anlegen(text)   to authenticated;
grant execute on function public.faden_raum_beitreten(text) to authenticated;
grant execute on function public.faden_meine_raeume()       to authenticated;
grant execute on function public.faden_ist_mitglied(uuid)   to authenticated;

-- TEIL 4 von 4: Sofortige Aktualisierung zwischen Geraeten
-- Dieser Teil ist der einzige, der scheitern darf. Ohne ihn gleicht
-- die App alle 60 Sekunden ab statt sofort - nutzbar bleibt sie.

alter table public.faden_notizen replica identity full;

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.faden_notizen';
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end;
$$;

-- Fertig. Falls noch nicht geschehen (fuer die Einkaufsliste schon
-- erledigt): Authentication -> Sign In / Providers ->
-- "Anonymous sign-ins" einschalten.
