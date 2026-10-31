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
    delete from public.recettes_publiques where foyer_id = f;   -- (table créée plus bas)
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
  delete from public.recettes_publiques where foyer_id = f;      -- (table créée plus bas)
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

-- 6 quater) Pseudos : un nom affiché à la place de l'adresse e-mail (unique, sans tenir compte des majuscules).
--    Le compte et les amis restent gérés par e-mail ; on ne voit que le pseudo des gens qu'on connaît
--    (soi-même, ses amis, les personnes qui nous ont envoyé une demande, les membres de ses foyers).
create table if not exists public.pseudos (
  email  text primary key check (email = lower(email)),
  pseudo text,
  modifie_le timestamptz not null default now()
);
-- photo de profil (chemin dans le dossier « avatars ») ; le pseudo devient facultatif
alter table public.pseudos alter column pseudo drop not null;
alter table public.pseudos add column if not exists avatar text;
create unique index if not exists pseudos_unique on public.pseudos (lower(pseudo));
alter table public.pseudos enable row level security;
revoke all on public.pseudos from anon, authenticated;

-- choisir / changer son pseudo (vide = le retirer) ; renvoie le pseudo enregistré
create or replace function public.definir_pseudo(p text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  moi text := lower(auth.jwt() ->> 'email');
  v   text := regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g');
begin
  if moi is null then raise exception 'Connexion requise'; end if;
  if v = '' then
    if exists (select 1 from public.recettes_publiques where auteur = moi and visible) then
      raise exception 'Tu as des recettes publiques : il te faut un pseudo';
    end if;
    update public.pseudos set pseudo = null, modifie_le = now() where email = moi;
    delete from public.pseudos where email = moi and avatar is null;
    return null;
  end if;
  if char_length(v) < 3 or char_length(v) > 20 then
    raise exception 'Le pseudo doit faire entre 3 et 20 caractères';
  end if;
  if v !~ '^[A-Za-z0-9À-ÖØ-öø-ÿ][A-Za-z0-9À-ÖØ-öø-ÿ ._-]*$' then
    raise exception 'Lettres, chiffres, espaces, points, tirets et _ uniquement';
  end if;
  if exists (select 1 from public.pseudos where lower(pseudo) = lower(v) and email <> moi) then
    raise exception 'Ce pseudo est déjà pris';
  end if;
  insert into public.pseudos (email, pseudo) values (moi, v)
    on conflict (email) do update set pseudo = excluded.pseudo, modifie_le = now();
  return v;
exception when unique_violation then
  raise exception 'Ce pseudo est déjà pris';
end;
$$;

-- photo de profil : chemin dans MON dossier du stockage « avatars » (vide = la retirer)
create or replace function public.definir_avatar(p text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  moi text := lower(auth.jwt() ->> 'email');
  v   text := btrim(coalesce(p, ''));
begin
  if moi is null then raise exception 'Connexion requise'; end if;
  if v = '' then
    update public.pseudos set avatar = null, modifie_le = now() where email = moi;
    delete from public.pseudos where email = moi and pseudo is null;
    return null;
  end if;
  if v !~ ('^' || encode(convert_to(moi, 'UTF8'), 'hex') || '/[A-Za-z0-9_-]{1,80}\.(webp|jpg)$') then
    raise exception 'Photo de profil invalide';
  end if;
  insert into public.pseudos (email, avatar) values (moi, v)
    on conflict (email) do update set avatar = excluded.avatar, modifie_le = now();
  return v;
end;
$$;

-- les pseudos (et photos de profil) des personnes que je connais
drop function if exists public.pseudos_connus();
create function public.pseudos_connus()
returns table (email text, pseudo text, avatar text)
language sql stable security definer set search_path = public
as $$
  with m as (select lower(auth.jwt() ->> 'email') as e),
  gens as (
    select m.e as email from m where m.e is not null
    union
    select case when d.de = m.e then d.a else d.de end
      from public.demandes_amis d, m
     where d.statut = 'accepte' and (d.de = m.e or d.a = m.e)
    union
    select d.de from public.demandes_amis d, m where d.a = m.e
    union
    select autre.email
      from public.foyer_membres moi
      join public.foyer_membres autre on autre.foyer_id = moi.foyer_id, m
     where moi.email = m.e
  )
  select p.email, p.pseudo, p.avatar from public.pseudos p join gens g on g.email = p.email;
$$;

revoke execute on function public.definir_pseudo(text) from anon, public;
revoke execute on function public.pseudos_connus()     from anon, public;
revoke execute on function public.definir_avatar(text) from anon, public;
grant  execute on function public.definir_avatar(text) to authenticated;
grant  execute on function public.definir_pseudo(text) to authenticated;
grant  execute on function public.pseudos_connus()     to authenticated;

-- 6 quinquies) Photos des recettes (Supabase Storage, dossier privé « photos »)
--    Un dossier par foyer, nommé d'après le nom du foyer en hexadécimal (les noms de fichiers
--    n'acceptent pas tous les caractères). Les photos sont compressées dans le téléphone avant l'envoi.
--    Membres du foyer : lire, ajouter, remplacer, supprimer. Amis d'un membre : lire seulement.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 2097152, array['image/webp', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.photo_dossier_membre(dossier text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.foyer_membres
     where email = lower(auth.jwt() ->> 'email')
       and encode(convert_to(foyer_id, 'UTF8'), 'hex') = dossier
  );
$$;
create or replace function public.photo_dossier_lisible(dossier text)
returns boolean
language sql stable security definer set search_path = public
as $$
  with m as (select lower(auth.jwt() ->> 'email') as e)
  select public.photo_dossier_membre(dossier) or exists (
    select 1
      from public.demandes_amis d
      join m on d.statut = 'accepte' and (d.de = m.e or d.a = m.e)
      join public.foyer_membres fm on fm.email = case when d.de = m.e then d.a else d.de end
     where encode(convert_to(fm.foyer_id, 'UTF8'), 'hex') = dossier
  );
$$;
revoke execute on function public.photo_dossier_membre(text)  from anon, public;
revoke execute on function public.photo_dossier_lisible(text) from anon, public;
grant  execute on function public.photo_dossier_membre(text)  to authenticated;
grant  execute on function public.photo_dossier_lisible(text) to authenticated;

drop policy if exists "photos lecture"     on storage.objects;
drop policy if exists "photos ajout"       on storage.objects;
drop policy if exists "photos remplacement" on storage.objects;
drop policy if exists "photos suppression" on storage.objects;
create policy "photos lecture" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.photo_dossier_lisible((storage.foldername(name))[1]));
create policy "photos ajout" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.photo_dossier_membre((storage.foldername(name))[1]));
create policy "photos remplacement" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and public.photo_dossier_membre((storage.foldername(name))[1]))
  with check (bucket_id = 'photos' and public.photo_dossier_membre((storage.foldername(name))[1]));
create policy "photos suppression" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.photo_dossier_membre((storage.foldername(name))[1]));

-- 6 sexies) Photos de profil (dossier privé « avatars ») : un dossier par personne (adresse en hexadécimal).
--    Chacun gère la sienne ; elle est visible par ceux qui voient son pseudo
--    (soi, ses amis, les personnes qui lui ont envoyé une demande, les membres de ses foyers).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 524288, array['image/webp', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.avatar_dossier_lisible(dossier text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select dossier = encode(convert_to(lower(auth.jwt() ->> 'email'), 'UTF8'), 'hex')
      or exists (select 1 from public.pseudos_connus() c where encode(convert_to(c.email, 'UTF8'), 'hex') = dossier);
$$;
revoke execute on function public.avatar_dossier_lisible(text) from anon, public;
grant  execute on function public.avatar_dossier_lisible(text) to authenticated;

drop policy if exists "avatars lecture"      on storage.objects;
drop policy if exists "avatars ajout"        on storage.objects;
drop policy if exists "avatars remplacement" on storage.objects;
drop policy if exists "avatars suppression"  on storage.objects;
create policy "avatars lecture" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.avatar_dossier_lisible((storage.foldername(name))[1]));
create policy "avatars ajout" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = encode(convert_to(lower(auth.jwt() ->> 'email'), 'UTF8'), 'hex'));
create policy "avatars remplacement" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = encode(convert_to(lower(auth.jwt() ->> 'email'), 'UTF8'), 'hex'))
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = encode(convert_to(lower(auth.jwt() ->> 'email'), 'UTF8'), 'hex'));
create policy "avatars suppression" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = encode(convert_to(lower(auth.jwt() ->> 'email'), 'UTF8'), 'hex'));

-- 6 septies) Recettes publiques (onglet « Recherche ») : notes de 1 à 5, imports, signalements.
--    Une recette publiée est COPIÉE ici (le reste du foyer reste privé). Le texte de recherche est
--    préparé par l'app (sans accents, au singulier). Seuls les utilisateurs connectés y accèdent,
--    et uniquement par les fonctions ci-dessous. Il faut un pseudo pour publier.
create table if not exists public.recettes_publiques (
  pid        uuid primary key default gen_random_uuid(),
  foyer_id   text not null,
  recette_id text not null,
  auteur     text not null,
  data       jsonb not null,
  nom_cle    text not null default '',          -- titre normalisé
  ing_cles   text[] not null default '{}',      -- ingrédients normalisés
  saisons    text[] not null default '{}',
  photos     text[] not null default '{}',      -- fichiers de la photo (lisibles par tous les connectés)
  visible    boolean not null default true,
  nb_notes   int not null default 0,
  somme_notes int not null default 0,
  nb_imports int not null default 0,
  nb_signalements int not null default 0,
  cree_le    timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  unique (foyer_id, recette_id)
);
create index if not exists recettes_publiques_ing on public.recettes_publiques using gin (ing_cles);
create index if not exists recettes_publiques_photos on public.recettes_publiques using gin (photos);
create table if not exists public.notes_publiques (
  pid uuid not null references public.recettes_publiques(pid) on delete cascade,
  email text not null, note int not null check (note between 1 and 5),
  modifie_le timestamptz not null default now(), primary key (pid, email));
create table if not exists public.imports_publics (
  pid uuid not null references public.recettes_publiques(pid) on delete cascade,
  email text not null, cree_le timestamptz not null default now(), primary key (pid, email));
create table if not exists public.signalements (
  pid uuid not null references public.recettes_publiques(pid) on delete cascade,
  email text not null, motif text, cree_le timestamptz not null default now(), primary key (pid, email));
alter table public.recettes_publiques enable row level security;
alter table public.notes_publiques    enable row level security;
alter table public.imports_publics    enable row level security;
alter table public.signalements       enable row level security;
revoke all on public.recettes_publiques, public.notes_publiques, public.imports_publics, public.signalements from anon, authenticated;

-- une recette publique doit être complète : préparation, durée, nombre de personnes,
-- au moins 3 ingrédients et au moins une saison
create or replace function public.recette_complete(r jsonb, saisons text[])
returns boolean
language sql immutable
as $$
  select coalesce(
       coalesce(btrim(r ->> 'steps'), '') <> ''
       and coalesce(jsonb_typeof(r -> 'duration') = 'number' and (r ->> 'duration')::numeric > 0, false)
       and coalesce(jsonb_typeof(r -> 'servings') = 'number' and (r ->> 'servings')::numeric > 0, false)
       and coalesce(jsonb_typeof(r -> 'ingredients') = 'array'
         and (select count(*) from jsonb_array_elements(r -> 'ingredients') i where coalesce(btrim(i ->> 'name'), '') <> '') >= 3, false)
       and coalesce(array_length(saisons, 1), 0) > 0, false);   -- un champ absent compte comme manquant
$$;

-- publier (ou mettre à jour) une recette du foyer f ; renvoie son identifiant public
create or replace function public.publier_recette(f text, r jsonb, nom_cle text, ing_cles text[], saisons text[])
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  moi text := lower(auth.jwt() ->> 'email');
  dir text := encode(convert_to(f, 'UTF8'), 'hex') || '/';
  rid text := r ->> 'id';
  ph  text[] := '{}';
  out uuid;
begin
  if moi is null then raise exception 'Connexion requise'; end if;
  if not public.est_membre(f) then raise exception 'Tu ne fais pas partie de ce foyer'; end if;
  -- nouvelle publication : il faut un pseudo (une mise à jour par un autre membre du foyer reste possible)
  if not exists (select 1 from public.recettes_publiques where foyer_id = f and recette_id = rid)
     and not exists (select 1 from public.pseudos where email = moi and pseudo is not null) then
    raise exception 'Choisis d''abord un pseudo (menu → Mon profil) pour publier';
  end if;
  if rid is null or length(rid) > 100 or coalesce(r ->> 'name', '') = '' then raise exception 'Recette invalide'; end if;
  if length(r::text) > 60000 then raise exception 'Recette trop longue pour être publiée'; end if;
  if not public.recette_complete(r, saisons) then
    raise exception 'Recette incomplète : il faut la préparation, la durée, le nombre de personnes, au moins 3 ingrédients et la saison';
  end if;
  -- photo : seulement des fichiers du dossier de CE foyer (sinon on la retire)
  if jsonb_typeof(r -> 'photo') = 'object'
     and (r -> 'photo' ->> 'f') like dir || '%' and (r -> 'photo' ->> 't') like dir || '%'
     and position('..' in (r -> 'photo' ->> 'f') || (r -> 'photo' ->> 't')) = 0 then
    ph := array[r -> 'photo' ->> 'f', r -> 'photo' ->> 't'];
  else
    r := r - 'photo';
  end if;
  insert into public.recettes_publiques as p (foyer_id, recette_id, auteur, data, nom_cle, ing_cles, saisons, photos)
  values (f, rid, moi, r, left(coalesce(nom_cle, ''), 300), (coalesce(ing_cles, '{}'))[1:80], (coalesce(saisons, '{}'))[1:4], ph)
  on conflict (foyer_id, recette_id) do update
    set data = excluded.data, nom_cle = excluded.nom_cle, ing_cles = excluded.ing_cles,
        saisons = excluded.saisons, photos = excluded.photos, visible = true, modifie_le = now()
  returning p.pid into out;
  return out;
end;
$$;

-- repasser une recette en privée (notes et imports gardés), ou l'effacer (recette supprimée)
create or replace function public.depublier_recette(f text, rid text, effacer boolean default false)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.jwt() ->> 'email' is null then raise exception 'Connexion requise'; end if;
  if not public.est_membre(f) then raise exception 'Tu ne fais pas partie de ce foyer'; end if;
  if effacer then delete from public.recettes_publiques where foyer_id = f and recette_id = rid;
  else update public.recettes_publiques set visible = false, modifie_le = now() where foyer_id = f and recette_id = rid;
  end if;
end;
$$;

-- recherche : mots (tous présents, dans le titre ou les ingrédients), ingrédients avec / sans,
-- note minimale, saison ; tri par pertinence (titre > ingrédients, puis note ajustée, puis imports).
-- amis = true : seulement les recettes des foyers de mes amis (hors foyers dont je suis membre)
drop function if exists public.chercher_recettes(text, text[], text[], numeric, text, text, int);   -- ancienne version, sans « amis »
create or replace function public.chercher_recettes(
  q text default '', avec text[] default '{}', sans text[] default '{}',
  note_min numeric default 0, saison text default '', tri text default 'pertinence', page int default 0,
  amis boolean default false)
returns table (pid uuid, data jsonb, auteur_pseudo text, auteur_avatar text, note numeric, nb_notes int,
               nb_imports int, ma_note int, mienne boolean, saisons text[], total bigint)
language sql stable security definer set search_path = public
as $$
  with m as (select lower(auth.jwt() ->> 'email') as e),
  mots as (select array_remove(string_to_array(btrim(lower(coalesce(q, ''))), ' '), '') as w),
  base as (
    select p.*,
           (3 * 3.5 + p.somme_notes)::numeric / (3 + p.nb_notes) as ajustee,
           case when p.nb_notes > 0 then round(p.somme_notes::numeric / p.nb_notes, 1) end as moyenne,
           ( select coalesce(sum(case when p.nom_cle like '%' || x || '%' then 2 else 0.6 end), 0)
               from unnest((select w from mots)) x ) as texte
      from public.recettes_publiques p, m
     where m.e is not null and p.visible and p.nb_signalements < 3
       and public.recette_complete(p.data, p.saisons)
       and exists (select 1 from public.foyer_membres fm where fm.foyer_id = p.foyer_id)
       and not exists (select 1 from unnest((select w from mots)) x
                        where p.nom_cle not like '%' || x || '%'
                          and not exists (select 1 from unnest(p.ing_cles) i where i like '%' || x || '%'))
       and p.ing_cles @> coalesce(avec, '{}')
       and not (p.ing_cles && coalesce(sans, '{}'))
       and (coalesce(saison, '') = '' or saison = any(p.saisons))
       and (coalesce(note_min, 0) <= 0 or (p.nb_notes > 0 and p.somme_notes::numeric / p.nb_notes >= note_min))
       and (not coalesce(amis, false) or (
             exists (select 1 from public.demandes_amis d
                       join public.foyer_membres fa on fa.email = case when d.de = m.e then d.a else d.de end
                      where d.statut = 'accepte' and (d.de = m.e or d.a = m.e) and fa.foyer_id = p.foyer_id)
             and not exists (select 1 from public.foyer_membres moi where moi.foyer_id = p.foyer_id and moi.email = m.e)))
  )
  select b.pid, b.data, ps.pseudo, ps.avatar, b.moyenne, b.nb_notes, b.nb_imports,
         (select n.note from public.notes_publiques n, m where n.pid = b.pid and n.email = m.e),
         exists (select 1 from public.foyer_membres fm, m where fm.foyer_id = b.foyer_id and fm.email = m.e),
         b.saisons, count(*) over ()
    from base b left join public.pseudos ps on ps.email = b.auteur
   order by case tri when 'note' then b.ajustee when 'imports' then b.nb_imports
                     when 'recent' then extract(epoch from b.modifie_le)
                     else b.texte * 2 + b.ajustee + 0.6 * ln(1 + b.nb_imports) end desc,
            b.modifie_le desc
   limit 20 offset greatest(coalesce(page, 0), 0) * 20;
$$;

-- une recette publique précise (fiche ouverte, après une note…)
create or replace function public.recette_publique(id uuid)
returns table (pid uuid, data jsonb, auteur_pseudo text, auteur_avatar text, note numeric, nb_notes int,
               nb_imports int, ma_note int, mienne boolean, saisons text[])
language sql stable security definer set search_path = public
as $$
  with m as (select lower(auth.jwt() ->> 'email') as e)
  select p.pid, p.data, ps.pseudo, ps.avatar,
         case when p.nb_notes > 0 then round(p.somme_notes::numeric / p.nb_notes, 1) end, p.nb_notes, p.nb_imports,
         (select n.note from public.notes_publiques n where n.pid = p.pid and n.email = m.e),
         exists (select 1 from public.foyer_membres fm where fm.foyer_id = p.foyer_id and fm.email = m.e),
         p.saisons
    from public.recettes_publiques p cross join m left join public.pseudos ps on ps.email = p.auteur
   where m.e is not null and p.pid = id and p.visible;
$$;

-- noter (1 à 5) ou retirer sa note (null) ; pas ses propres recettes
create or replace function public.noter_recette(id uuid, note int)
returns void
language plpgsql security definer set search_path = public
as $$
declare moi text := lower(auth.jwt() ->> 'email');
begin
  if moi is null then raise exception 'Connexion requise'; end if;
  if not exists (select 1 from public.recettes_publiques where pid = id and visible) then raise exception 'Recette introuvable'; end if;
  if exists (select 1 from public.recettes_publiques p join public.foyer_membres fm on fm.foyer_id = p.foyer_id
              where p.pid = id and fm.email = moi) then
    raise exception 'Tu ne peux pas noter une recette de ton foyer';
  end if;
  if note is null then delete from public.notes_publiques where pid = id and email = moi;
  elsif note between 1 and 5 then
    insert into public.notes_publiques (pid, email, note) values (id, moi, note)
      on conflict (pid, email) do update set note = excluded.note, modifie_le = now();
  else raise exception 'La note va de 1 à 5';
  end if;
  update public.recettes_publiques p
     set nb_notes = (select count(*) from public.notes_publiques n where n.pid = id),
         somme_notes = (select coalesce(sum(n.note), 0) from public.notes_publiques n where n.pid = id)
   where p.pid = id;
end;
$$;

-- compter un import (une fois par personne, pas pour son propre foyer)
create or replace function public.compter_import(id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare moi text := lower(auth.jwt() ->> 'email');
begin
  if moi is null then raise exception 'Connexion requise'; end if;
  if exists (select 1 from public.recettes_publiques p join public.foyer_membres fm on fm.foyer_id = p.foyer_id
              where p.pid = id and fm.email = moi) then return; end if;
  insert into public.imports_publics (pid, email) select id, moi
   where exists (select 1 from public.recettes_publiques where pid = id) on conflict do nothing;
  update public.recettes_publiques p set nb_imports = (select count(*) from public.imports_publics i where i.pid = id) where p.pid = id;
end;
$$;

-- signaler (une fois par personne) ; à partir de 3 signalements, la recette n'apparaît plus
create or replace function public.signaler_recette(id uuid, motif text default '')
returns void
language plpgsql security definer set search_path = public
as $$
declare moi text := lower(auth.jwt() ->> 'email');
begin
  if moi is null then raise exception 'Connexion requise'; end if;
  insert into public.signalements (pid, email, motif) select id, moi, left(coalesce(motif, ''), 300)
   where exists (select 1 from public.recettes_publiques where pid = id) on conflict do nothing;
  update public.recettes_publiques p set nb_signalements = (select count(*) from public.signalements s where s.pid = id) where p.pid = id;
end;
$$;

-- statistiques des recettes publiées d'un de mes foyers (badge dans « Recettes »)
create or replace function public.mes_publications(f text)
returns table (recette_id text, pid uuid, visible boolean, note numeric, nb_notes int, nb_imports int)
language sql stable security definer set search_path = public
as $$
  select p.recette_id, p.pid, p.visible,
         case when p.nb_notes > 0 then round(p.somme_notes::numeric / p.nb_notes, 1) end, p.nb_notes, p.nb_imports
    from public.recettes_publiques p
   where p.foyer_id = f and public.est_membre(f);
$$;

-- photos et photos de profil des recettes publiques : lisibles par tous les connectés
create or replace function public.photo_publique(nom text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.recettes_publiques p
                  where p.visible and p.nb_signalements < 3 and p.photos @> array[nom]);
$$;
create or replace function public.avatar_auteur_public(dossier text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.recettes_publiques p
                  where p.visible and encode(convert_to(p.auteur, 'UTF8'), 'hex') = dossier);
$$;
drop policy if exists "photos publiques lecture"  on storage.objects;
drop policy if exists "avatars auteurs lecture"   on storage.objects;
create policy "photos publiques lecture" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.photo_publique(name));
create policy "avatars auteurs lecture" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.avatar_auteur_public((storage.foldername(name))[1]));

revoke execute on function public.publier_recette(text, jsonb, text, text[], text[]) from anon, public;
revoke execute on function public.depublier_recette(text, text, boolean)             from anon, public;
revoke execute on function public.chercher_recettes(text, text[], text[], numeric, text, text, int, boolean) from anon, public;
revoke execute on function public.recette_publique(uuid)                             from anon, public;
revoke execute on function public.noter_recette(uuid, int)                           from anon, public;
revoke execute on function public.compter_import(uuid)                               from anon, public;
revoke execute on function public.signaler_recette(uuid, text)                       from anon, public;
revoke execute on function public.mes_publications(text)                             from anon, public;
revoke execute on function public.photo_publique(text)                               from anon, public;
revoke execute on function public.avatar_auteur_public(text)                         from anon, public;
grant  execute on function public.publier_recette(text, jsonb, text, text[], text[]) to authenticated;
grant  execute on function public.depublier_recette(text, text, boolean)             to authenticated;
grant  execute on function public.chercher_recettes(text, text[], text[], numeric, text, text, int, boolean) to authenticated;
grant  execute on function public.recette_publique(uuid)                             to authenticated;
grant  execute on function public.noter_recette(uuid, int)                           to authenticated;
grant  execute on function public.compter_import(uuid)                               to authenticated;
grant  execute on function public.signaler_recette(uuid, text)                       to authenticated;
grant  execute on function public.mes_publications(text)                             to authenticated;
grant  execute on function public.photo_publique(text)                               to authenticated;
grant  execute on function public.avatar_auteur_public(text)                         to authenticated;

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
