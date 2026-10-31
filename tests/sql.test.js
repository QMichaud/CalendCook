/* Script supabase_setup.sql : exécuté sur un PostgreSQL local (jetable) qui imite Supabase
   (rôles anon / authenticated, auth.jwt(), schéma storage), puis droits et fonctions vérifiés.
   Ignoré si PostgreSQL n'est pas installé (PG_BIN=/chemin/vers/bin pour l'indiquer). */
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync, spawn } = require('child_process');
const { suite, ROOT } = require('./lib/app');
const t = suite('Script SQL (supabase_setup.sql)');

function pgBin(){
  const dirs = [process.env.PG_BIN, ...(fs.existsSync('/usr/lib/postgresql') ? fs.readdirSync('/usr/lib/postgresql').sort().reverse().map(v => `/usr/lib/postgresql/${v}/bin`) : []),
    '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'].filter(Boolean);
  return dirs.find(d => fs.existsSync(path.join(d, 'initdb')) && fs.existsSync(path.join(d, 'postgres')));
}

/* imitation minimale de Supabase */
const SUPABASE_STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create extension if not exists pgcrypto;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.jwt() to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to anon, authenticated; grant all on storage.objects to authenticated;
`;

(async () => {
  const bin = pgBin();
  if(!bin){ console.log('  (PostgreSQL absent : test ignoré)'); t.done(); return; }
  const root = process.getuid && process.getuid() === 0;           // initdb refuse root : on passe par l'utilisateur postgres
  const as = (cmd, args, opts = {}) => root ? execFileSync('runuser', ['-u', 'postgres', '--', path.join(bin, cmd), ...args], opts) : execFileSync(path.join(bin, cmd), args, opts);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendcook-pg-'));
  fs.chmodSync(dir, 0o777);
  if(root) execFileSync('chown', ['postgres', dir]);
  const data = path.join(dir, 'data'), port = String(54000 + Math.floor(Math.random() * 900));
  as('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C'], { stdio: 'ignore' });
  const srv = root ? spawn('runuser', ['-u', 'postgres', '--', path.join(bin, 'postgres'), '-D', data, '-k', dir, '-p', port, '-c', 'listen_addresses='], { stdio: 'ignore' })
                   : spawn(path.join(bin, 'postgres'), ['-D', data, '-k', dir, '-p', port, '-c', 'listen_addresses='], { stdio: 'ignore' });
  const stop = () => {
    try{ as('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' }); }catch(e){ try{ srv.kill('SIGKILL'); }catch(e2){} }
    fs.rmSync(dir, { recursive: true, force: true });
  };
  try{
    const psqlBin = fs.existsSync(path.join(bin, 'psql')) ? path.join(bin, 'psql') : 'psql';
    const psql = (sql, file) => execFileSync(psqlBin, ['-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAtX',
      ...(file ? ['-f', file] : ['-c', sql])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    for(let i = 0; ; i++){ try{ psql('select 1'); break; }catch(e){ if(i > 50) throw new Error('PostgreSQL ne démarre pas'); await new Promise(r => setTimeout(r, 200)); } }
    /* requête au nom d'une personne connectée (email) ou anonyme (null) ; renvoie le texte, ou « ERREUR: … » */
    const as_ = (email, sql) => {
      const who = email ? `set role authenticated; select set_config('request.jwt.claims', '{"email":"${email}"}', false);` : 'set role anon;';
      try{ return psql(`${who} ${sql}`).split('\n').slice(email ? 1 : 0).join('\n'); }
      catch(e){ return 'ERREUR: ' + String(e.stderr || e.message).replace(/^[\s\S]*?ERROR:\s*/, '').split('\n')[0]; }
    };

    t.section('1. Installation');
    psql(SUPABASE_STUB);
    const setup = path.join(ROOT, 'supabase_setup.sql');
    let ok = true, err = '';
    try{ psql(null, setup); }catch(e){ ok = false; err = String(e.stderr || e.message).split('\n')[0]; }
    t.check(ok, 'premier passage sans erreur ' + err);
    try{ psql(null, setup); }catch(e){ ok = false; err = String(e.stderr || e.message).split('\n')[0]; }
    t.check(ok, 'relancé une deuxième fois sans erreur (comme indiqué en tête du script) ' + err);

    t.section('2. Foyers et données');
    t.check(as_('alice@x.fr', `select public.creer_foyer('Famille Martin')`) === 'Famille Martin', 'Alice crée « Famille Martin »');
    t.check(/déjà pris/.test(as_('bob@x.fr', `select public.creer_foyer('Famille Martin')`)), 'Bob ne peut pas reprendre ce nom');
    t.check(/trop court/.test(as_('bob@x.fr', `select public.creer_foyer('ab')`)), 'nom trop court refusé');
    as_('alice@x.fr', `insert into public.recettes_app (id, data) values ('Famille Martin', '{"recipes":[{"id":"a","name":"Crêpes"}]}')`);
    t.check(as_('alice@x.fr', `select data->'recipes'->0->>'name' from public.recettes_app`) === 'Crêpes', 'Alice lit les données de son foyer');
    t.check(as_('bob@x.fr', `select count(*) from public.recettes_app`) === '0', 'Bob ne les voit pas');
    as_('bob@x.fr', `update public.recettes_app set data = '{}'`);
    t.check(as_('alice@x.fr', `select data->'recipes'->0->>'name' from public.recettes_app`) === 'Crêpes', 'Bob ne peut pas les modifier');
    t.check(/permission denied/.test(as_(null, `select * from public.recettes_app`)), 'sans connexion : accès refusé');
    as_('alice@x.fr', `insert into public.foyer_membres (foyer_id, email) values ('Famille Martin', 'bob@x.fr')`);
    t.check(as_('bob@x.fr', `select count(*) from public.recettes_app`) === '1', 'Bob invité par Alice : il voit le foyer');
    t.check(/permission denied|row-level/.test(as_('eve@x.fr', `insert into public.foyer_membres (foyer_id, email) values ('Famille Martin', 'eve@x.fr')`)), 'Ève ne peut pas s’inviter elle-même');

    t.section('3. Pseudos');
    t.check(/entre 3 et 20/.test(as_('alice@x.fr', `select public.definir_pseudo('Al')`)), 'pseudo trop court refusé');
    t.check(as_('alice@x.fr', `select public.definir_pseudo('  Alice   M ')`) === 'Alice M', 'pseudo « Alice M » (espaces nettoyés)');
    t.check(/déjà pris/.test(as_('bob@x.fr', `select public.definir_pseudo('alice m')`)), 'déjà pris (sans tenir compte des majuscules)');
    t.check(/permission denied/.test(as_(null, `select public.definir_pseudo('Anonyme')`)), 'sans connexion : refusé');

    t.section('4. Recettes publiques');
    const rec = c => `'${JSON.stringify(Object.assign({ id: 'a', name: 'Ratatouille', duration: 60, servings: 4, steps: 'Couper\nCuire',
      ingredients: [{ name: 'Courgette' }, { name: 'Aubergine' }, { name: 'Tomate' }] }, c))}'::jsonb`;
    t.check(/pseudo/.test(as_('bob@x.fr', `select public.publier_recette('Famille Martin', ${rec({ id: 'b' })}, 'ratatouille', '{courgette}', '{ete}')`)), 'sans pseudo : publication refusée');
    t.check(/incomplète/.test(as_('alice@x.fr', `select public.publier_recette('Famille Martin', ${rec({ steps: '' })}, 'ratatouille', '{courgette}', '{ete}')`)), 'sans préparation : refusée');
    t.check(/incomplète/.test(as_('alice@x.fr', `select public.publier_recette('Famille Martin', ${rec({})}, 'ratatouille', '{courgette}', '{}')`)), 'sans saison : refusée');
    t.check(/ce foyer/.test(as_('eve@x.fr', `select public.publier_recette('Famille Martin', ${rec({})}, 'ratatouille', '{courgette}', '{ete}')`)), 'hors du foyer : refusée');
    const pid = as_('alice@x.fr', `select public.publier_recette('Famille Martin', ${rec({ photo: { f: '../autre/x.webp', t: '../autre/y.webp' } })}, 'ratatouille', '{courgette,aubergine,tomate}', '{ete}')`);
    t.check(/^[0-9a-f-]{36}$/.test(pid), 'recette complète publiée');
    t.check(as_('postgres', `reset role; select data ? 'photo' from public.recettes_publiques`) === 'f', 'photo hors du dossier du foyer : retirée');
    t.check(/permission denied/.test(as_('eve@x.fr', `select * from public.recettes_publiques`)), 'table non lisible directement');
    const found = as_('eve@x.fr', `select auteur_pseudo || '|' || mienne from public.chercher_recettes('ratatouille')`);
    t.check(found === 'Alice M|false', 'Ève la trouve (auteur « Alice M ») : ' + found);
    t.check(as_('eve@x.fr', `select count(*) from public.chercher_recettes('', '{}', '{tomate}')`) === '0', 'filtre « sans tomate »');
    t.check(as_('eve@x.fr', `select count(*) from public.chercher_recettes('', '{}', '{}', 0, 'hiver')`) === '0', 'filtre saison « hiver »');
    t.check(/permission denied/.test(as_(null, `select * from public.chercher_recettes('')`)), 'sans connexion : recherche refusée');
    t.check(/ton foyer/.test(as_('bob@x.fr', `select public.noter_recette('${pid}', 5)`)), 'Bob (même foyer) ne peut pas noter la recette');
    as_('eve@x.fr', `select public.noter_recette('${pid}', 5)`); as_('carl@x.fr', `select public.noter_recette('${pid}', 4)`);
    t.check(as_('alice@x.fr', `select nb_notes || '|' || note from public.chercher_recettes('ratatouille')`) === '2|4.5', 'notes : 2 avis, 4,5');
    t.check(/de 1 à 5/.test(as_('eve@x.fr', `select public.noter_recette('${pid}', 6)`)) && as_('alice@x.fr', `select nb_notes from public.chercher_recettes('ratatouille')`) === '2', 'note 6 refusée');
    as_('eve@x.fr', `select public.compter_import('${pid}')`); as_('eve@x.fr', `select public.compter_import('${pid}')`);
    t.check(as_('alice@x.fr', `select nb_imports from public.chercher_recettes('ratatouille')`) === '1', 'import compté une seule fois par personne');

    t.section('5. Recettes de mes amis (Recherche → 👥 Mes amis)');
    t.check(as_('postgres', `reset role; select count(*) from pg_proc where proname = 'chercher_recettes'`) === '1', 'une seule version de chercher_recettes (l’ancienne est remplacée)');
    const amis = who => as_(who, `select count(*) from public.chercher_recettes(amis => true)`);
    t.check(amis('eve@x.fr') === '0', 'Ève, pas encore amie : aucune recette');
    as_('eve@x.fr', `select public.demander_ami('alice@x.fr')`);
    t.check(amis('eve@x.fr') === '0', 'demande seulement envoyée : toujours rien');
    t.check(as_('alice@x.fr', `select public.demander_ami('eve@x.fr')`) === 'accepte', 'Alice accepte');
    t.check(amis('eve@x.fr') === '1' && as_('eve@x.fr', `select auteur_pseudo from public.chercher_recettes(q => 'ratatouille', amis => true)`) === 'Alice M', 'Ève voit la recette publique d’Alice');
    t.check(amis('carl@x.fr') === '0' && as_('carl@x.fr', `select count(*) from public.chercher_recettes()`) === '1', 'Carl (pas ami) : rien dans « Mes amis », mais la recette reste dans « Toutes »');
    as_('bob@x.fr', `select public.demander_ami('alice@x.fr')`); as_('alice@x.fr', `select public.demander_ami('bob@x.fr')`);
    t.check(amis('bob@x.fr') === '0', 'Bob, ami d’Alice mais du même foyer : pas dans « Mes amis » (c’est déjà sa recette)');
    t.check(as_('eve@x.fr', `select count(*) from public.chercher_recettes(amis => true, saison => 'hiver')`) === '0', 'les autres filtres s’appliquent aussi');
    t.check(/permission denied/.test(as_(null, `select * from public.chercher_recettes(amis => true)`)), 'sans connexion : refusé');
    as_('alice@x.fr', `select public.depublier_recette('Famille Martin', 'a')`);
    t.check(amis('eve@x.fr') === '0', 'recette repassée en privée : elle disparaît de « Mes amis »');
    as_('alice@x.fr', `select public.publier_recette('Famille Martin', ${rec({})}, 'ratatouille', '{courgette,aubergine,tomate}', '{ete}')`);
    t.check(/pseudo/.test(as_('alice@x.fr', `select public.definir_pseudo('')`)), 'pseudo obligatoire tant qu’une recette est publique');
    as_('alice@x.fr', `select public.depublier_recette('Famille Martin', 'a')`);
    t.check(as_('eve@x.fr', `select count(*) from public.chercher_recettes('')`) === '0', 'repassée en privée : plus visible');
  } finally { stop(); }
  t.done();
})().catch(e => { console.error(e); process.exit(1); });
