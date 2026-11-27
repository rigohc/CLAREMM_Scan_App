-- Run after all active scanners have been updated and their pending captures
-- verified in the relational inventory. Preserve the archive and its history.
do $$
begin
  if to_regclass('public.inventory_items') is not null then
    revoke select, insert, update, delete on public.inventory_items from public, anon, authenticated;
  end if;
end;
$$;
