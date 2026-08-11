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
