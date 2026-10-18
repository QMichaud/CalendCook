// @ts-nocheck   (fichier écrit en JavaScript simple : pas de vérification de types)
/* ============================================================
   Mes Recettes — fonction « import-recette » (Supabase Edge Function)
   ------------------------------------------------------------
   Lit une page de recette (Marmiton, 750g, Cuisine AZ, Ptitchef…)
   et renvoie la fiche recette standard que ces sites placent dans
   leur page (données « schema.org/Recipe » au format JSON-LD) :
   titre, portions, durée, ingrédients, étapes et photo.

   Pourquoi côté serveur : un navigateur n'a pas le droit de lire
   une page d'un autre site (règle CORS). Aucune IA, aucun coût :
   le texte des ingrédients est ensuite découpé par l'application.

   Réservée aux personnes connectées à l'application.
   Installation : voir README.md (« Import depuis un site »).
   ============================================================ */

const MAX_PAGE = 4_000_000;      // octets lus au maximum pour une page
const MAX_IMAGE = 6_000_000;     // et pour la photo
const TIMEOUT = 10_000;          // ms par requête
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

/* ---------- adresses autorisées : sites publics en http(s) uniquement ---------- */
export function safeTarget(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== '80' && u.port !== '443') return null;
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!h.includes('.') || h === 'localhost' || /\.(local|internal|localhost|lan|home|corp)$/.test(h)) return null;
  if (/^\[|:/.test(h)) return null;                                   // IPv6 : refusée
  const ip = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (a === 10 || a === 127 || a === 0 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return null;
  }
  return u;
}

/* lecture plafonnée, redirections suivies à la main (chaque étape revérifiée) */
async function fetchCapped(url, max, accept) {
  let target = safeTarget(url);
  for (let hop = 0; hop < 5 && target; hop++) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const r = await fetch(target.href, { redirect: 'manual', signal: ctl.signal,
        headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.6' } });
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        target = safeTarget(new URL(r.headers.get('location'), target).href); continue;
      }
      if (!r.ok) throw Object.assign(new Error('Le site a répondu ' + r.status), { site: r.status });
      const chunks = []; let size = 0;
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length; if (size > max) { ctl.abort(); throw new Error('Page trop volumineuse'); }
        chunks.push(value);
      }
      const buf = new Uint8Array(size); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
      return { buf, type: r.headers.get('content-type') || '', url: target.href };
    } finally { clearTimeout(timer); }
  }
  throw new Error(target ? 'Trop de redirections' : 'Adresse non autorisée');
}

/* ---------- lecture de la fiche recette ---------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à',
  acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', ugrave: 'ù', icirc: 'î', iuml: 'ï', euml: 'ë', oelig: 'œ', rsquo: '’', lsquo: '‘',
  laquo: '«', raquo: '»', hellip: '…', deg: '°', frac12: '½', frac14: '¼', frac34: '¾', ndash: '–', mdash: '—' };
export const decode = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
/* texte simple : balises retirées, entités décodées, espaces resserrés */
export const clean = s => decode(decode(String(s ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ')))
  .replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

const isRecipe = n => n && typeof n === 'object' && [].concat(n['@type'] || []).some(t => /(^|\/)Recipe$/i.test(String(t)));
function findNode(x, depth = 0) {
  if (!x || typeof x !== 'object' || depth > 8) return null;
  if (Array.isArray(x)) { for (const y of x) { const f = findNode(y, depth + 1); if (f) return f; } return null; }
  if (isRecipe(x)) return x;
  for (const k of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
    const f = findNode(x[k], depth + 1); if (f) return f;
  }
  return null;
}

/* durée ISO 8601 (« PT1H15M », « P0DT45M ») → minutes */
export function isoMinutes(v) {
  const m = String(v || '').match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!m) return 0;
  return Math.round((+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) + (+m[4] || 0) / 60);
}

function stepsOf(ins, out = [], depth = 0) {
  if (!ins || depth > 5) return out;
  if (typeof ins === 'string') {
    clean(ins).split(/\n+/).map(s => s.trim()).filter(Boolean).forEach(s => out.push(s));
  } else if (Array.isArray(ins)) ins.forEach(x => stepsOf(x, out, depth + 1));
  else if (typeof ins === 'object') {
    if (ins.itemListElement) stepsOf(ins.itemListElement, out, depth + 1);        // HowToSection
    else stepsOf(ins.text || ins.name || '', out, depth + 1);                     // HowToStep
  }
  return out;
}
function imageOf(img) {
  if (!img) return '';
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) { for (const x of img) { const u = imageOf(x); if (u) return u; } return ''; }
  return typeof img === 'object' ? String(img.url || img.contentUrl || img['@id'] || '') : '';
}

/* page HTML → recette (ou null si la page n'a pas de fiche recette) */
export function extractRecipe(html, pageUrl) {
  const blocks = [...String(html).matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    let data = null;
    const raw = b[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, '');
    try { data = JSON.parse(raw); }
    catch { try { data = JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' ').replace(/,\s*([\]}])/g, '$1')); } catch { continue; } }
    const r = findNode(data); if (!r) continue;
    const ing = [].concat(r.recipeIngredient || r.ingredients || []).map(clean).filter(Boolean).slice(0, 80);
    const total = isoMinutes(r.totalTime) || (isoMinutes(r.prepTime) + isoMinutes(r.cookTime) + isoMinutes(r.performTime));
    let image = imageOf(r.image);
    try { image = image ? new URL(image, pageUrl).href : ''; } catch { image = ''; }
    return {
      name: clean(r.name || r.headline || '').slice(0, 200),
      yield: [].concat(r.recipeYield || []).map(y => clean(y)).filter(Boolean).slice(0, 3),
      duration: total > 0 && total < 10000 ? total : 0,
      ingredients: ing,
      steps: stepsOf(r.recipeInstructions).slice(0, 60),
      image,
    };
  }
  return null;
}

const b64 = buf => { let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s); };

/* ---------- point d'entrée ---------- */
export async function handle(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'Méthode non autorisée' });

  /* personne connectée à l'application (la clé publique seule ne suffit pas) */
  const authz = req.headers.get('authorization') || '';
  const who = await fetch(Deno.env.get('SUPABASE_URL') + '/auth/v1/user', {
    headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') || '', Authorization: authz } }).catch(() => null);
  if (!who || !who.ok) return reply(401, { error: 'Connecte-toi pour importer une recette' });

  let body = {};
  try { body = await req.json(); } catch { /* corps vide */ }
  const target = safeTarget(body.url);
  if (!target) return reply(400, { error: 'Ce lien ne semble pas valide' });

  let page;
  try { page = await fetchCapped(target.href, MAX_PAGE, 'text/html,application/xhtml+xml'); }
  catch (e) { return reply(502, { error: e.site ? 'Le site refuse l’accès à cette page (' + e.site + ')' : 'Impossible de lire cette page (' + e.message + ')' }); }
  const charset = (page.type.match(/charset=([\w-]+)/i) || [])[1] || 'utf-8';
  let html;
  try { html = new TextDecoder(charset).decode(page.buf); } catch { html = new TextDecoder().decode(page.buf); }

  const recipe = extractRecipe(html, page.url);
  if (!recipe || (!recipe.ingredients.length && !recipe.steps.length))
    return reply(422, { error: 'Pas de fiche recette lisible sur cette page' });

  /* photo : renvoyée telle quelle, l'application la réduit avant de l'enregistrer */
  if (body.image && recipe.image) {
    try {
      const img = await fetchCapped(recipe.image, MAX_IMAGE, 'image/avif,image/webp,image/jpeg,image/png,image/*');
      const type = img.type.split(';')[0].trim();
      if (/^image\/(jpeg|png|webp|gif|avif)$/.test(type)) recipe.imageData = 'data:' + type + ';base64,' + b64(img.buf);
    } catch { /* photo facultative */ }
  }
  recipe.url = page.url;
  return reply(200, recipe);
}

if (typeof Deno !== 'undefined' && Deno.serve) Deno.serve(handle);
