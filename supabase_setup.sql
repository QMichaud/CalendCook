-- ============================================================
--  CalendCook — connexion par e-mail + foyers partagés
--  À exécuter UNE FOIS dans Supabase : SQL Editor → New query → Run
--  (le script peut être relancé sans risque)
-- ============================================================

-- 1) Qui appartient à quel foyer (un foyer = plusieurs adresses e-mail)
create table if not exists public.foyer_membres (
  foyer_id  text        not null,
  email     text        not null check (email = lower(email)),
  ajoute_le timestamptz not null default now(),
  primary key (foyer_id, email)
);

-- 2) « Suis-je membre de ce foyer ? » (d'après l'e-mail vérifié de la session)
create or replace function public.est_membre(f text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.foyer_membres
    where foyer_id = f and email = lower(auth.jwt() ->> 'email')
  );
$$;

-- 3) Créer un nouveau foyer (celui qui le crée en devient membre)
create or replace function public.creer_foyer(nom text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  moi text := lower(auth.jwt() ->> 'email');
  f   text := btrim(nom);
begin
  if moi is null then raise exception 'Connexion requise'; end if;
  if f is null or length(f) < 3 then raise exception 'Nom de foyer trop court'; end if;
  if exists (select 1 from public.foyer_membres where foyer_id = f)
     or exists (select 1 from public.recettes_app where id = f) then
    raise exception 'Ce nom de foyer est déjà pris';
  end if;
  insert into public.foyer_membres (foyer_id, email) values (f, moi);
  return f;
end;
$$;

-- 4) Sécurité des membres : on ne voit / gère que les membres de SES foyers
alter table public.foyer_membres enable row level security;
drop policy if exists "membres: voir"    on public.foyer_membres;
drop policy if exists "membres: inviter" on public.foyer_membres;
drop policy if exists "membres: retirer" on public.foyer_membres;
create policy "membres: voir"    on public.foyer_membres for select to authenticated using (email = lower(auth.jwt() ->> 'email') or public.est_membre(foyer_id));
create policy "membres: inviter" on public.foyer_membres for insert to authenticated with check (public.est_membre(foyer_id));
create policy "membres: retirer" on public.foyer_membres for delete to authenticated using (public.est_membre(foyer_id));

-- 5) Sécurité des données : seuls les membres du foyer lisent / écrivent
alter table public.recettes_app enable row level security;
do $$
declare p record;
begin
  -- supprime les anciennes règles (dont celles qui laissaient tout le monde accéder)
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'recettes_app' loop
    execute format('drop policy %I on public.recettes_app', p.policyname);
  end loop;
end $$;
create policy "foyer: lire"     on public.recettes_app for select to authenticated using (public.est_membre(id));
create policy "foyer: créer"    on public.recettes_app for insert to authenticated with check (public.est_membre(id));
create policy "foyer: modifier" on public.recettes_app for update to authenticated using (public.est_membre(id)) with check (public.est_membre(id));

-- 6) Plus aucun accès sans connexion
revoke all on public.recettes_app  from anon;
revoke all on public.foyer_membres from anon;
revoke execute on function public.creer_foyer(text) from anon, public;
grant select, insert, update on public.recettes_app  to authenticated;
grant select, insert, delete on public.foyer_membres to authenticated;
grant execute on function public.creer_foyer(text) to authenticated;
grant execute on function public.est_membre(text)  to authenticated;

-- 7) ⚠️ À ADAPTER : rattache ton foyer actuel à vos adresses e-mail (en minuscules)
insert into public.foyer_membres (foyer_id, email) values
  ('foyerRatMic', 'ton.adresse@exemple.fr'),
  ('foyerRatMic', 'adresse.de.l.autre.personne@exemple.fr')
on conflict do nothing;
