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

-- 6 ter) Amis : demandes par e-mail, acceptation, et partage des RECETTES uniquement
--   La table n'est lisible par personne directement : tout passe par les
--   fonctions ci-dessous, qui ne donnent accès qu'à ses propres demandes et,
--   pour les amis acceptés, à la seule liste de leurs recettes (jamais leur
--   calendrier ni leur liste de courses).
create table if not exists public.demandes_amis (
  de      text        not null check (de = lower(de)),
  a       text        not null check (a = lower(a)),
  statut  text        not null default 'attente' check (statut in ('attente', 'accepte')),
  cree_le timestamptz not null default now(),
  primary key (de, a),
  check (de <> a)
);
alter table public.demandes_amis enable row level security;          -- aucune règle : illisible directement
revoke all on public.demandes_amis from anon, authenticated;

-- envoyer une demande (si l'autre m'en a déjà envoyé une : on devient amis directement)
create or replace function public.demander_ami(email text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  moi   text := lower(auth.jwt() ->> 'email');
  cible text := lower(btrim(coalesce(email, '')));
begin
  if moi is null then raise exception 'Connexion requise'; end if;
  if cible !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Adresse e-mail invalide'; end if;
  if cible = moi then raise exception 'C''est ta propre adresse'; end if;
  if exists (select 1 from public.demandes_amis d where d.statut = 'accepte'
             and ((d.de = moi and d.a = cible) or (d.de = cible and d.a = moi))) then
    return 'deja';
  end if;
  if exists (select 1 from public.demandes_amis d where d.de = cible and d.a = moi and d.statut = 'attente') then
    update public.demandes_amis set statut = 'accepte' where de = cible and a = moi;
    return 'accepte';
  end if;
  insert into public.demandes_amis (de, a) values (moi, cible) on conflict do nothing;
  return 'envoyee';
end;
$$;

-- accepter ou refuser une demande reçue
create or replace function public.repondre_ami(email text, accepter boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  moi text := lower(auth.jwt() ->> 'email');
  de_ text := lower(btrim(coalesce(email, '')));
begin
  if moi is null then raise exception 'Connexion requise'; end if;
  if accepter then
    update public.demandes_amis set statut = 'accepte' where de = de_ and a = moi and statut = 'attente';
  else
    delete from public.demandes_amis where de = de_ and a = moi and statut = 'attente';
  end if;
  if not found then raise exception 'Demande introuvable'; end if;
end;
$$;

-- retirer un ami, ou annuler une demande envoyée
create or replace function public.retirer_ami(email text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  moi   text := lower(auth.jwt() ->> 'email');
  autre text := lower(btrim(coalesce(email, '')));
begin
  if moi is null then raise exception 'Connexion requise'; end if;
  delete from public.demandes_amis where (de = moi and a = autre) or (de = autre and a = moi);
end;
$$;

-- mes amis et mes demandes : etat = 'ami' | 'recue' | 'envoyee'
-- foyers = les foyers que j'ai en commun avec cette personne (leurs recettes me sont déjà partagées)
drop function if exists public.mes_amis();
create function public.mes_amis()
returns table (email text, etat text, foyers text[])
language sql stable security definer set search_path = public
as $$
  select x.autre, x.etat,
         coalesce((select array_agg(f1.foyer_id order by f1.foyer_id)
                     from public.foyer_membres f1
                     join public.foyer_membres f2 on f2.foyer_id = f1.foyer_id
                    where f1.email = x.moi and f2.email = x.autre), '{}')
    from (select case when d.de = m.e then d.a else d.de end as autre,
                 case when d.statut = 'accepte' then 'ami' when d.de = m.e then 'envoyee' else 'recue' end as etat,
                 m.e as moi
            from public.demandes_amis d, (select lower(auth.jwt() ->> 'email') as e) m
           where m.e is not null and (d.de = m.e or d.a = m.e)) x
   order by 1;
$$;

-- les recettes de mes amis (celles des foyers dont ils sont membres), sans rien d'autre,
-- hors foyers dont je suis moi-même membre (leurs recettes sont déjà les miennes)
create or replace function public.recettes_amis()
returns table (ami text, recette jsonb)
language sql stable security definer set search_path = public
as $$
  with m as (select lower(auth.jwt() ->> 'email') as e),
  amis as (
    select case when d.de = m.e then d.a else d.de end as ami
      from public.demandes_amis d, m
     where m.e is not null and d.statut = 'accepte' and (d.de = m.e or d.a = m.e)
  )
  select distinct on (amis.ami, r ->> 'id') amis.ami, r
    from amis
    join public.foyer_membres fm on fm.email = amis.ami
    join public.recettes_app ra  on ra.id = fm.foyer_id
    cross join m
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(ra.data -> 'recipes') = 'array' then ra.data -> 'recipes' else '[]'::jsonb end) r
   where r ->> 'id' is not null
     and not exists (select 1 from public.foyer_membres moi
                      where moi.foyer_id = fm.foyer_id and moi.email = m.e)
   order by amis.ami, r ->> 'id';
$$;

revoke execute on function public.demander_ami(text)          from anon, public;
revoke execute on function public.repondre_ami(text, boolean) from anon, public;
revoke execute on function public.retirer_ami(text)           from anon, public;
revoke execute on function public.mes_amis()                  from anon, public;
revoke execute on function public.recettes_amis()             from anon, public;
grant  execute on function public.demander_ami(text)          to authenticated;
grant  execute on function public.repondre_ami(text, boolean) to authenticated;
grant  execute on function public.retirer_ami(text)           to authenticated;
grant  execute on function public.mes_amis()                  to authenticated;
grant  execute on function public.recettes_amis()             to authenticated;

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
