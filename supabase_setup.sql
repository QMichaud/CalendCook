-- ============================================================
--  CalendCook — connexion par e-mail + foyers partagés
--  À exécuter UNE FOIS dans Supabase : SQL Editor → New query → Run
--  (le script peut être relancé sans risque)
-- ============================================================

-- 0) Les données de chaque foyer (recettes, calendrier, courses)
create table if not exists public.recettes_app (
  id         text        primary key,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

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

-- 3 bis) Quitter un foyer : si plus personne n'en fait partie, ses données sont effacées
create or replace function public.quitter_foyer(f text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  moi text := lower(auth.jwt() ->> 'email');
begin
  if moi is null then raise exception 'Connexion requise'; end if;
  delete from public.foyer_membres where foyer_id = f and email = moi;
  if not found then raise exception 'Tu ne fais pas partie de ce foyer'; end if;
  if not exists (select 1 from public.foyer_membres where foyer_id = f) then
    delete from public.recettes_app where id = f;
  end if;
end;
$$;

-- 3 ter) Supprimer un foyer pour tout le monde (membres + données)
create or replace function public.supprimer_foyer(f text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.jwt() ->> 'email' is null then raise exception 'Connexion requise'; end if;
  if not public.est_membre(f) then raise exception 'Tu ne fais pas partie de ce foyer'; end if;
  delete from public.recettes_app  where id = f;
  delete from public.foyer_membres where foyer_id = f;
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
revoke execute on function public.quitter_foyer(text)   from anon, public;
revoke execute on function public.supprimer_foyer(text) from anon, public;
grant select, insert, update on public.recettes_app  to authenticated;
grant select, insert, delete on public.foyer_membres to authenticated;
grant execute on function public.creer_foyer(text) to authenticated;
grant execute on function public.quitter_foyer(text)   to authenticated;
grant execute on function public.supprimer_foyer(text) to authenticated;
grant execute on function public.est_membre(text)  to authenticated;

-- 6 bis) Transfert de connexion vers l'app de l'écran d'accueil (iPhone)
--   L'app installée sur l'écran d'accueil ne partage pas ses données avec
--   Safari : quand le lien de l'e-mail s'ouvre dans Safari, Safari dépose ici
--   la connexion sous un identifiant secret (64 caractères aléatoires, connu
--   seulement de l'app et du lien), et l'app vient la chercher une seule fois.
create table if not exists public.connexions_en_attente (
  id            text        primary key,
  access_token  text        not null,
  refresh_token text        not null,
  expires_at    bigint,
  cree_le       timestamptz not null default now()
);
alter table public.connexions_en_attente enable row level security;   -- aucune règle : illisible directement
revoke all on public.connexions_en_attente from anon, authenticated;

create or replace function public.deposer_session(pair text, jeton text, jeton_refresh text, expire bigint)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.jwt() ->> 'email' is null then raise exception 'Connexion requise'; end if;
  if length(coalesce(pair, '')) < 32 then raise exception 'Identifiant invalide'; end if;
  delete from public.connexions_en_attente where cree_le < now() - interval '15 minutes';
  insert into public.connexions_en_attente (id, access_token, refresh_token, expires_at)
    values (pair, jeton, jeton_refresh, expire)
    on conflict (id) do nothing;
end;
$$;

create or replace function public.recuperer_session(pair text)
returns table (access_token text, refresh_token text, expires_at bigint)
language sql security definer set search_path = public
as $$
  delete from public.connexions_en_attente c
   where c.id = pair and c.cree_le > now() - interval '15 minutes'
  returning c.access_token, c.refresh_token, c.expires_at;
$$;

revoke execute on function public.deposer_session(text, text, text, bigint) from anon, public;
revoke execute on function public.recuperer_session(text)                  from public;
grant  execute on function public.deposer_session(text, text, text, bigint) to authenticated;
grant  execute on function public.recuperer_session(text)                  to anon, authenticated;

-- 7) Recharge le cache de l'API pour que l'app voie tout de suite les fonctions
notify pgrst, 'reload schema';

-- 8) (Facultatif) Les foyers se créent depuis l'app (« Mon foyer » → Créer).
--    Pour rattacher à la main des adresses à un foyer existant, retire les
--    « -- » des 4 lignes ci-dessous et mets vos adresses (en minuscules) :
-- insert into public.foyer_membres (foyer_id, email) values
--   ('foyerRatMic', 'ton.adresse@exemple.fr'),
--   ('foyerRatMic', 'adresse.de.l.autre.personne@exemple.fr')
-- on conflict do nothing;

-- 9) (Facultatif) Données de foyers qui ne sont plus rattachés à personne.
--    Pour les voir :
-- select id, updated_at from public.recettes_app
--   where id not in (select foyer_id from public.foyer_membres);
--    Pour les effacer (définitif) :
-- delete from public.recettes_app
--   where id not in (select foyer_id from public.foyer_membres);
