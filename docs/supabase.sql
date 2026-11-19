-- Scrypture account sync: run once in the Supabase SQL Editor (safe to run again).
-- The older all-in-one table `public.saves` is left alone; the app moves its data into `items` and `profile` on first sync and keeps it as a backup.

create table if not exists public.items (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,                          -- tasks, habits, notes, mindMaps, workouts, events, worlds, levels, categories
  id text not null,
  data jsonb,                                  -- null for a deletion
  deleted boolean not null default false,      -- a deletion is kept as a row, so the other device learns about it
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, kind, id)
);
create index if not exists items_changed on public.items (user_id, updated_at);

create table if not exists public.profile (    -- settings, pet, counters, achievements ...: everything that is not a list of items
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default clock_timestamp()
);

-- the server's clock decides the version stamp, so a wrong clock on a phone cannot break the order
create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = clock_timestamp(); return new; end $$;
drop trigger if exists items_touch on public.items;
create trigger items_touch before insert or update on public.items for each row execute function public.touch_updated_at();
drop trigger if exists profile_touch on public.profile;
create trigger profile_touch before insert or update on public.profile for each row execute function public.touch_updated_at();

-- everyone sees and changes only their own rows
alter table public.items enable row level security;
alter table public.profile enable row level security;
drop policy if exists "own items" on public.items;
create policy "own items" on public.items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own profile" on public.profile;
create policy "own profile" on public.profile for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update on public.items, public.profile to authenticated;

-- live updates: the other device hears about a change straight away
do $$ begin
  begin alter publication supabase_realtime add table public.items; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.profile; exception when duplicate_object then null; end;
end $$;
