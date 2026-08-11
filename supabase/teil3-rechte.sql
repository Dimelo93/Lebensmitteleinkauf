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
