-- Baby Day Book — schéma Supabase (toutes les tables commencent par babydaybook_)
-- À coller dans Supabase > SQL Editor > Run. Idempotent : peut être relancé sans risque.

-- ───────────── Enfants ─────────────
create table if not exists public.babydaybook_children (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  birthdate   date,
  gender      text check (gender in ('fille','garcon')),
  photo_url   text,
  notes       text,
  created_at  timestamptz not null default now()
);

-- ───────────── Activités ─────────────
-- Les dates sont stockées en UTC (timestamptz) ; l'app affiche l'heure de Paris.
-- Événements instantanés : ended_at = started_at. Chrono en cours (allaitement, sommeil) : ended_at null.
create table if not exists public.babydaybook_events (
  id            uuid primary key default gen_random_uuid(),
  child_id      uuid not null references public.babydaybook_children(id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type          text not null check (type in ('allaitement','tirelait','biberon','repas','couche','sommeil','medicament')),
  started_at    timestamptz not null,
  ended_at      timestamptz,
  left_sec      integer not null default 0,   -- allaitement : secondes sein gauche
  right_sec     integer not null default 0,   -- allaitement : secondes sein droit
  active_side   text check (active_side in ('left','right')),  -- chrono d'allaitement en cours
  active_since  timestamptz,
  quantity_ml   numeric,                      -- biberon
  left_ml       numeric,                      -- tire-lait
  right_ml      numeric,                      -- tire-lait
  quantity_g    numeric,                      -- repas
  diaper_type   text check (diaper_type in ('urine','selles','mixte')),
  label         text,                         -- repas : aliment · médicament : nom · biberon : contenu
  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists babydaybook_children_user_idx  on public.babydaybook_children (user_id);
create index if not exists babydaybook_events_child_idx   on public.babydaybook_events (child_id, started_at desc);
create index if not exists babydaybook_events_user_idx    on public.babydaybook_events (user_id);
create index if not exists babydaybook_events_running_idx on public.babydaybook_events (child_id) where ended_at is null;

-- ───────────── Sécurité (RLS) ─────────────
alter table public.babydaybook_children enable row level security;
alter table public.babydaybook_events   enable row level security;

revoke all on public.babydaybook_children from anon;
revoke all on public.babydaybook_events   from anon;
grant select, insert, update, delete on public.babydaybook_children to authenticated;
grant select, insert, update, delete on public.babydaybook_events   to authenticated;

drop policy if exists babydaybook_children_select on public.babydaybook_children;
drop policy if exists babydaybook_children_insert on public.babydaybook_children;
drop policy if exists babydaybook_children_update on public.babydaybook_children;
drop policy if exists babydaybook_children_delete on public.babydaybook_children;

create policy babydaybook_children_select on public.babydaybook_children
  for select to authenticated using ((select auth.uid()) = user_id);
create policy babydaybook_children_insert on public.babydaybook_children
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy babydaybook_children_update on public.babydaybook_children
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy babydaybook_children_delete on public.babydaybook_children
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists babydaybook_events_select on public.babydaybook_events;
drop policy if exists babydaybook_events_insert on public.babydaybook_events;
drop policy if exists babydaybook_events_update on public.babydaybook_events;
drop policy if exists babydaybook_events_delete on public.babydaybook_events;

create policy babydaybook_events_select on public.babydaybook_events
  for select to authenticated using ((select auth.uid()) = user_id);
create policy babydaybook_events_insert on public.babydaybook_events
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.babydaybook_children c where c.id = child_id and c.user_id = (select auth.uid()))
  );
create policy babydaybook_events_update on public.babydaybook_events
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.babydaybook_children c where c.id = child_id and c.user_id = (select auth.uid()))
  );
create policy babydaybook_events_delete on public.babydaybook_events
  for delete to authenticated using ((select auth.uid()) = user_id);
