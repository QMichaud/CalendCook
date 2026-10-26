/* Fonction Supabase « import-recette » : lecture de la fiche recette d'une page, sécurité (adresses, connexion) */
const { suite, loadImportFunction, readFixture } = require('./lib/app');
const t = suite('Fonction « import-recette »');

(async () => {
  /* environnement Supabase simulé : Deno.env et les accès réseau */
  const sites = {};                                       // adresse → réponse simulée
  const fetched = [];
  globalThis.Deno = { env: { get: k => ({ SUPABASE_URL: 'https://projet.supabase.co', SUPABASE_ANON_KEY: 'anon' })[k] } };
  globalThis.fetch = async (url, init = {}) => {
    fetched.push(url);
    if(url === 'https://projet.supabase.co/auth/v1/user')
      return new Response('{}', { status: (init.headers || {}).Authorization === 'Bearer bon' ? 200 : 401 });
    const s = sites[url];
    if(!s) return new Response('introuvable', { status: 404 });
    return new Response(s.body, { status: s.status || 200, headers: s.headers || { 'content-type': 'text/html; charset=utf-8' } });
  };
  const fn = await loadImportFunction();
  const call = async (body, token = 'bon', method = 'POST') => {
    const r = await fn.handle(new Request('https://projet.supabase.co/functions/v1/import-recette', {
      method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined }));
    return { status: r.status, cors: r.headers.get('access-control-allow-origin'), json: await r.json().catch(() => null) };
  };

  t.section('1. Lecture de la fiche recette (JSON-LD)');
  const m = fn.extractRecipe(readFixture('page-marmiton.html'), 'https://www.marmiton.org/recettes/tartiflette.aspx');
  t.check(m.name === 'La vraie tartiflette' && m.duration === 75 && m.yield[0] === '6 personnes', 'Marmiton : nom, 1 h 15, 6 personnes');
  t.check(m.ingredients.length === 12 && m.ingredients.includes('1 cuillère à soupe d\'huile'), '12 ingrédients, entités HTML décodées');
  t.check(m.steps.length === 4 && m.steps[2] === 'Ajouter le vin.' && m.steps[3].endsWith('200°C.'), '<br> coupe une étape, « &deg; » décodé');
  t.check(m.image.startsWith('https://assets.afcdn.com/'), 'photo');
  const w = fn.extractRecipe(readFixture('page-wordpress.html'), 'https://blog.exemple.fr/gateau/');
  t.check(w.name === 'Gâteau au yaourt' && w.duration === 45 && w.steps.length === 3, 'WordPress (@graph, sections) : préparation + cuisson = 45 min, 3 étapes');
  t.check(w.image === 'https://blog.exemple.fr/img/gateau.jpg', 'adresse de la photo complétée');
  t.check(fn.extractRecipe('<html><body>Pas de recette</body></html>', 'https://x.fr/') === null, 'page sans fiche : rien');
  t.check(fn.extractRecipe('<script type="application/ld+json">{"@type":"Recipe","name":"A",\n"recipeIngredient":["1 œuf",],}</script>', 'https://x.fr/').ingredients[0] === '1 œuf', 'JSON mal formé (virgules en trop) : lu quand même');
  t.check(fn.isoMinutes('PT1H15M') === 75 && fn.isoMinutes('P0DT45M') === 45 && fn.isoMinutes('PT90S') === 2 && fn.isoMinutes('n’importe quoi') === 0, 'durées ISO (PT1H15M, P0DT45M…)');

  t.section('2. Adresses refusées (accès au réseau interne)');
  const refus = ['http://localhost/', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/', 'http://172.16.0.1/',
    'http://[::1]/', 'ftp://exemple.fr/', 'https://user:mdp@exemple.fr/', 'https://exemple.fr:8080/', 'https://intranet/', 'https://nas.local/', 'javascript:alert(1)'];
  const passe = refus.filter(u => fn.safeTarget(u));
  t.check(!passe.length, refus.length + ' adresses refusées' + (passe.length ? ' — acceptées à tort : ' + passe.join(', ') : ''));
  t.check(!!fn.safeTarget('https://www.marmiton.org/recettes/x.aspx') && !!fn.safeTarget('http://blog.exemple.fr:443/'), 'sites publics acceptés');

  t.section('3. Appels');
  let r = await call({}, 'bon', 'OPTIONS');
  t.check(r.status === 200 && r.cors === '*', 'OPTIONS (CORS) : autorisé');
  r = await call({ url: 'https://www.marmiton.org/x' }, 'mauvais');
  t.check(r.status === 401 && /Connecte-toi/.test(r.json.error) && r.cors === '*', 'sans connexion : refusé (401)');
  r = await call({ url: 'http://127.0.0.1/admin' });
  t.check(r.status === 400 && !fetched.includes('http://127.0.0.1/admin'), 'adresse interne : refusée sans être lue');
  sites['https://www.marmiton.org/tartiflette'] = { body: readFixture('page-marmiton.html') };
  sites['https://assets.afcdn.com/recipe/20160401/38946_w1024h768c1cx2690cy1793.jpg'] = { body: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), headers: { 'content-type': 'image/jpeg' } };
  r = await call({ url: 'https://www.marmiton.org/tartiflette', image: true });
  t.check(r.status === 200 && r.json.name === 'La vraie tartiflette' && r.json.url === 'https://www.marmiton.org/tartiflette', 'recette lue');
  t.check(r.json.imageData === 'data:image/jpeg;base64,/9j/AQID', 'photo jointe (base64)');
  sites['https://bit.ly/abc'] = { status: 302, body: '', headers: { location: 'https://www.marmiton.org/tartiflette' } };
  r = await call({ url: 'https://bit.ly/abc' });
  t.check(r.status === 200 && r.json.url === 'https://www.marmiton.org/tartiflette' && !r.json.imageData, 'lien raccourci suivi, pas de photo si non demandée');
  sites['https://piege.fr/'] = { status: 302, body: '', headers: { location: 'http://169.254.169.254/latest/meta-data/' } };
  r = await call({ url: 'https://piege.fr/' });
  t.check(r.status === 502 && !fetched.some(u => u.startsWith('http://169.254')), 'redirection vers une adresse interne : bloquée');
  sites['https://www.site.fr/blog'] = { body: '<html>Bonjour</html>' };
  r = await call({ url: 'https://www.site.fr/blog' });
  t.check(r.status === 422 && /Pas de fiche recette/.test(r.json.error), 'page sans recette : message clair (422)');
  sites['https://www.site.fr/prive'] = { status: 403, body: 'non' };
  r = await call({ url: 'https://www.site.fr/prive' });
  t.check(r.status === 502 && /refuse l’accès.*403/.test(r.json.error), 'site qui refuse : « refuse l’accès (403) »');
  sites['https://www.site.fr/latin1'] = { body: Buffer.from('<script type="application/ld+json">{"@type":"Recipe","name":"Crème brûlée","recipeIngredient":["4 œufs"]}</script>'.replace('œ', 'oe'), 'latin1'), headers: { 'content-type': 'text/html; charset=iso-8859-1' } };
  r = await call({ url: 'https://www.site.fr/latin1' });
  t.check(r.status === 200 && r.json.name === 'Crème brûlée', 'page en ISO-8859-1 : accents corrects');

  t.done();
})().catch(e => { console.error(e); process.exit(1); });
