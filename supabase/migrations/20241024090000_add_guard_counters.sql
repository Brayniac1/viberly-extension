-- Adds creation counters for manual and automated Viberly guards.
alter table public.vg_profiles
    add column custom_guards_created integer not null default 0,
    add column vg_guards_automated integer not null default 0;

-- Backfill the new columns from existing guard rows.
update public.vg_profiles vp
set
  custom_guards_created = coalesce((
    select count(*)
    from public.vg_guards g
    where g.user_id = vp.user_id
      and coalesce(g.auto_generated, false) = false
  ), 0),
  vg_guards_automated = coalesce((
    select count(*)
    from public.vg_guards g
    where g.user_id = vp.user_id
      and g.auto_generated = true
  ), 0);

-- Ensure future inserts keep the counters accurate.
create or replace function public.increment_vg_guard_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is null then
    return new;
  end if;

  if coalesce(new.auto_generated, false) then
    update public.vg_profiles
      set vg_guards_automated = vg_guards_automated + 1
      where user_id = new.user_id;
  else
    update public.vg_profiles
      set custom_guards_created = custom_guards_created + 1
      where user_id = new.user_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_vg_guards_increment_counters on public.vg_guards;

create trigger trg_vg_guards_increment_counters
after insert on public.vg_guards
for each row
execute function public.increment_vg_guard_counters();
