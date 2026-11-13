-- Places: add a Museums / Exhibits category.
alter table public.venues drop constraint if exists venues_kind_check;
alter table public.venues add constraint venues_kind_check
  check (kind in ('coffee', 'restaurant', 'bar', 'outdoors', 'movement', 'museum'));
