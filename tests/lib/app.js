/* ============================================================
   Outils communs aux tests : ouvrir l'application dans un navigateur
   (téléphone simulé), avec ou sans faux Supabase, et vérifier.
   ------------------------------------------------------------
   L'application est servie depuis les fichiers du dépôt : on teste
   exactement le code de la branche, sans rien publier.
   Aucune connexion internet n'est nécessaire (polices et services
   extérieurs sont simulés).
   ============================================================ */
const fs = require('fs'), path = require('path');
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const FIX = path.resolve(__dirname, '..', 'fixtures');
const APP = 'https://qmichaud.github.io/CalendCook/';
const SHOTS = process.env.SHOTS || '';                 // dossier où enregistrer les captures (facultatif)

/* ---------- résultats ---------- */
function suite(name){
  let ok = 0, ko = 0;
  console.log('\n■ ' + name);
  return {
    check(cond, msg){ cond ? ok++ : ko++; console.log((cond ? '  ✓ ' : '  ✗ ') + msg); return !!cond; },
    section(t){ console.log(t); },
    done(){ console.log(`\n${ok} OK, ${ko} échec(s)`); process.exitCode = ko ? 1 : 0; return ko; }
  };
}

/* bibliothèque de conversion HEIC (facultative : npm install dans tests/) */
function heicLib(){
  try{ return require.resolve('heic2any/dist/heic2any.min.js'); }catch(e){ return null; }
}

/* ---------- faux Supabase en mémoire ----------
   db.data : données du foyer ; db.store : fichiers (photos) ; db.calls : appels reçus ;
   db.rpc[nom] = (corps) => résultat : fonctions SQL simulées */
function fakeSupabase(opts = {}){
  const db = {
    foyer: opts.foyer || 'Famille', email: opts.email || 'moi@x.fr',
    data: opts.data || { recipes:[], plan:{}, shopping:[], eaters:[] },
    store: new Map(), calls: [], rpc: Object.assign({
      pseudos_connus: () => [{ email: opts.email || 'moi@x.fr', pseudo: opts.pseudo === undefined ? 'Moi' : opts.pseudo, avatar: null }],
      mes_amis: () => [], recettes_amis: () => [], mes_publications: () => [], chercher_recettes: () => []
    }, opts.rpc || {}),
    fn: opts.fn || {}                                     // fonctions « edge » : db.fn['import-recette'] = (corps) => …
  };
  db.route = async r => {
    const u = new URL(r.request().url()), m = r.request().method(), pth = decodeURIComponent(u.pathname);
    const json = (x, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(x) });
    const body = () => { try{ return JSON.parse(r.request().postData() || '{}'); }catch(e){ return {}; } };
    db.calls.push(m + ' ' + pth);
    if(pth.startsWith('/storage/v1/')){
      if(m === 'POST' && pth.startsWith('/storage/v1/object/') && !pth.endsWith('/copy')){
        db.store.set(pth.replace(/^\/storage\/v1\/object\/[a-z]+\//, ''), r.request().postDataBuffer()); return json({ Key: 'x' });
      }
      if(m === 'GET'){ const o = db.store.get(pth.replace(/^\/storage\/v1\/object\/(authenticated\/)?[a-z]+\//, ''));
        return o ? r.fulfill({ body: o, contentType: 'image/webp' }) : json({ message: 'not found' }, 404); }
      if(m === 'DELETE'){ (body().prefixes || []).forEach(k => db.store.delete(k)); return json([]); }
      return json({});
    }
    if(pth.startsWith('/functions/v1/')){
      const f = db.fn[pth.replace('/functions/v1/', '')];
      if(!f) return json({ code: 'NOT_FOUND', message: 'Requested function was not found' }, 404);
      const out = await f(body(), r.request().headers());
      return json(out.body !== undefined ? out.body : out, out.status || 200);
    }
    if(pth === '/rest/v1/foyer_membres') return json([{ foyer_id: db.foyer, email: db.email }]);
    if(pth === '/rest/v1/recettes_app' && m === 'GET') return json([{ data: db.data, updated_at: 'x' }]);
    if(pth === '/rest/v1/recettes_app' && (m === 'PATCH' || m === 'POST')){ db.data = body().data || db.data; return json([{}]); }
    if(pth.startsWith('/rest/v1/rpc/')){
      const name = pth.replace('/rest/v1/rpc/', ''), f = db.rpc[name];
      db.lastRpc = db.lastRpc || {}; db.lastRpc[name] = body();
      return f ? json(await f(body())) : json(null);
    }
    if(pth.startsWith('/auth/v1/')) return json({ id: 'u1', email: db.email });
    return json([]);
  };
  return db;
}

/* ---------- ouvrir l'application ----------
   opts.device  : 'iPhone 13' (défaut), 'Pixel 7'…
   opts.cloud   : options du faux Supabase (connecté à un foyer) ; sinon données gardées sur l'appareil
   opts.data    : données de départ (recettes, calendrier, courses…)
   opts.now     : date du jour simulée (ex. '2026-09-28T10:00:00')
   opts.look    : apparence ({ btn, bg }) */
async function openApp(opts = {}){
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices[opts.device || 'iPhone 13'] });
  const db = opts.cloud ? fakeSupabase(Object.assign({ data: opts.data }, opts.cloud)) : null;
  await ctx.addInitScript(([cloud, data, look, foyer, email]) => {
    if(sessionStorage.getItem('test-init')) return;            // seulement au premier chargement
    sessionStorage.setItem('test-init', '1');
    if(cloud){
      localStorage.setItem('mesrecettes.session', JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_at: 9999999999, email }));
      localStorage.setItem('mesrecettes.foyer', foyer);
      localStorage.setItem('mesrecettes.pseudoAsked.' + email, '1');
    } else {
      localStorage.setItem('mesrecettes.localonly', '1');
      if(data) localStorage.setItem('mesrecettes.v1', JSON.stringify(data));
    }
    if(look) localStorage.setItem('mesrecettes.look', JSON.stringify(look));
  }, [!!db, opts.data || null, opts.look || null, db ? db.foyer : '', db ? db.email : '']);
  await ctx.route(APP + '**', r => {
    const f = new URL(r.request().url()).pathname.replace('/CalendCook/', '') || 'index.html';
    const file = path.join(ROOT, f);
    if(!file.startsWith(ROOT) || !fs.existsSync(file)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ body: fs.readFileSync(file), contentType: f.endsWith('.js') ? 'application/javascript' : 'text/html' });
  });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ contentType: 'text/css', body: '' }));
  const heic = heicLib();
  const ctl = { heicOffline: !!opts.heicOffline };       // app.ctl.heicOffline = true : service de conversion injoignable
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/heic2any/, r => (ctl.heicOffline || !heic) ? r.abort() : r.fulfill({ body: fs.readFileSync(heic), contentType: 'application/javascript' }));
  await ctx.route('https://*.supabase.co/**', r => db ? db.route(r) : r.fulfill({ contentType: 'application/json', body: '[]' }));
  for(const [pat, h] of (opts.routes || [])) await ctx.route(pat, h);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  p.on('dialog', d => (opts.onDialog ? opts.onDialog(d) : d.accept()));
  if(opts.now) await p.clock.setSystemTime(new Date(opts.now));
  await p.goto(APP);
  if(db) await p.waitForFunction(f => { const l = document.querySelector('#acctLab'); return l && l.textContent === f; }, db.foyer, { timeout: 15000 });
  await p.waitForTimeout(250);
  const app = {
    b, ctx, p, db, errs, ctl,
    async shot(name){ if(SHOTS){ fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + '.png') }); } },
    async tab(v){ await p.click(`nav.tabs button[data-v="${v}"]`); await p.waitForTimeout(150); },
    /* glisser du doigt (écran tactile) de (x, y1) à (x, y2) */
    async swipe(x, y1, y2, ms = 250, steps = 10){
      const cdp = app._cdp || (app._cdp = await ctx.newCDPSession(p));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y1 }] });
      for(let i = 1; i <= steps; i++){ await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y1 + (y2 - y1) * i / steps }] }); await p.waitForTimeout(ms / steps); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(350);
    },
    /* faire glisser la fenêtre ouverte vers le bas depuis sa poignée */
    async pullSheet(){
      await p.evaluate(() => { const s = document.querySelector('#sheet'); s.scrollTop = 0; if(document.activeElement) document.activeElement.blur(); });
      const g = await p.$eval('#sheet .grab', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await app.swipe(g.x, g.y, g.y + 400);
    },
    modalOpen(){ return p.evaluate(() => document.querySelector('#modal').classList.contains('on')); },
    close(){ return b.close(); }
  };
  return app;
}

/* fonction « import-recette » (supabase/functions) chargée dans Node : même code que sur Supabase */
function loadImportFunction(){
  const src = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'import-recette', 'index.ts'), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
}

const fixture = name => path.join(FIX, name);
const readFixture = name => fs.readFileSync(fixture(name), 'utf8');
/* recette de test */
const R = (id, name, ings = [], extra = {}) => Object.assign({ id, name, duration: 20, tags: [],
  ingredients: ings.map(i => typeof i === 'string' ? { name: i, qty: 1, unit: 'pcs' } : i) }, extra);
/* date ISO locale (AAAA-MM-JJ) */
const isoDay = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

module.exports = { suite, openApp, fakeSupabase, loadImportFunction, fixture, readFixture, heicLib, R, isoDay, ROOT, APP };
