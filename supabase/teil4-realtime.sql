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
