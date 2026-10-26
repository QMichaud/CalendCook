/* Recettes publiques : publication (critères, pseudo), onglet Recherche, ajout d'une recette publique */
const { suite, openApp, R } = require('./lib/app');
const t = suite('Recettes publiques');

(async () => {
  const complete = R('a', 'Ratatouille', [{ name: 'Courgette', qty: 2, unit: 'pcs' }, { name: 'Aubergine', qty: 1, unit: 'pcs' }, { name: 'Tomate', qty: 4, unit: 'pcs' }],
    { duration: 60, servings: 4, steps: 'Couper les légumes\nCuire 45 min' });
  const incomplete = R('b', 'Omelette', ['Œuf']);
  const publiques = [
    { pid: 'p1', total: 2, note: 4.5, nb_notes: 12, nb_imports: 30, auteur_pseudo: 'Mamie Jo', saisons: ['hiver'], mienne: false,
      data: { id: 'x1', name: 'Soupe de potiron', duration: 40, servings: 4, steps: '1. Cuire\n2. Mixer', ingredients: [{ name: 'Potiron', qty: 1, unit: 'kg' }, { name: 'Crème fraîche', qty: 20, unit: 'cl' }] } },
    { pid: 'p2', total: 2, note: null, nb_notes: 0, nb_imports: 0, auteur_pseudo: 'Moi', mienne: true,
      data: { id: 'a', name: 'Ratatouille', duration: 60, servings: 4, ingredients: [] } }
  ];
  let pseudo = 'Moi';
  const app = await openApp({ now: '2026-09-30T10:00:00', data: { recipes: [complete, incomplete], plan: {}, shopping: [], eaters: [] }, cloud: {
    rpc: {
      pseudos_connus: () => [{ email: 'moi@x.fr', pseudo, avatar: null }],
      publier_recette: () => 'pub-1',
      chercher_recettes: b => publiques.filter(x => !b.q || x.data.name.toLowerCase().includes(b.q)),
      recette_publique: b => publiques.filter(x => x.pid === b.id),
      compter_import: () => null
    } } });
  const { p, db } = app;

  t.section('1. Critères pour publier');
  await p.evaluate(() => openRecipeForm('b')); await p.waitForSelector('#rVis');
  await p.click('#rVis [data-vis="1"]'); await p.waitForTimeout(100);
  t.check(await p.$eval('#rVis [data-vis="1"]', e => e.classList.contains('err') && !e.classList.contains('on')) && await p.$eval('#rVis [data-vis="0"]', e => e.classList.contains('on')), 'recette incomplète : « Publique » en erreur, reste « Privée »');
  const miss = await p.$$eval('#rPubCheck li', e => e.map(x => x.textContent));
  t.check(miss.join(' | ') === '✗ la préparation | ✗ le nombre de personnes | ✗ au moins 3 ingrédients (1/3) | ✗ la saison', 'ce qui manque : ' + miss.join(' | '));
  await app.shot('publique-incomplete');
  await p.fill('#rSteps', 'Battre les œufs'); await p.fill('#rServ', '2'); await p.waitForTimeout(300);
  t.check((await p.$$eval('#rPubCheck li', e => e.length)) === 2, 'liste mise à jour en cours de saisie');
  await p.click('#rCancel');

  t.section('2. Publier');
  await p.evaluate(() => openRecipeForm('a')); await p.waitForSelector('#rVis');
  await p.click('#rVis [data-vis="1"]');
  t.check(await p.$eval('#rVis [data-vis="1"]', e => e.classList.contains('on') && !e.classList.contains('err')), 'recette complète : « Publique » choisi');
  await p.click('#recForm button[type=submit]'); await p.waitForTimeout(400);
  const sent = db.lastRpc && db.lastRpc.publier_recette;
  t.check(sent && sent.f === 'Famille' && sent.r.name === 'Ratatouille' && sent.nom_cle === 'ratatouille', 'publier_recette appelée (foyer, recette, clé du nom)');
  t.check(sent && JSON.stringify(sent.ing_cles) === '["courgette","aubergine","tomate"]' && sent.saisons.includes('ete') && !('tags' in sent.r) && !('origin' in sent.r), 'ingrédients, saisons ; ni étiquettes ni origine envoyées');
  t.check(await p.evaluate(() => findRecipe('a').public === true) && (await p.textContent('#recList .rcard[data-id="a"]')).includes('🌍 Publique'), 'badge « 🌍 Publique » sur la carte');

  t.section('3. Sans pseudo');
  pseudo = null; await p.evaluate(() => { delete people.map[auth.email]; });
  await p.evaluate(() => openRecipeForm('b')); await p.waitForSelector('#rVis');
  await p.click('#rVis [data-vis="1"]');
  t.check((await p.textContent('#rVisHint')).includes('choisis d’abord un pseudo') && await p.$eval('#rVis [data-vis="1"]', e => e.classList.contains('err')), 'pas de pseudo : « choisis d’abord un pseudo »');
  await p.click('#rCancel');

  t.section('4. Onglet Recherche');
  await app.tab('search'); await p.waitForSelector('#pubGrid .pcard');
  t.check(await p.$$eval('#pubGrid .pcard', e => e.length) === 2 && (await p.textContent('#pubInfo')).includes('2 recettes publiques'), '2 recettes publiques');
  t.check((await p.textContent('#pubGrid .pcard[data-pid="p1"]')).includes('4,5') && (await p.textContent('#pubGrid .pcard[data-pid="p1"]')).includes('📥 30'), 'note 4,5 et 30 imports');
  await p.fill('#qPub', 'zzz'); await p.waitForTimeout(500);
  t.check((await p.textContent('#pubInfo')).includes('Aucune recette publique ne correspond'), 'recherche sans résultat');
  await p.fill('#qPub', ''); await p.waitForTimeout(500);
  await p.click('#pubGrid .pcard[data-pid="p1"]'); await p.waitForSelector('.pubtitle');
  t.check((await p.textContent('#sheet .author')).includes('Mamie Jo') && await p.isVisible('#sheet [data-act="pubimport"]'), 'fiche : auteur, bouton « Ajouter à mes recettes »');
  await app.shot('publique-fiche');
  await p.click('#sheet [data-act="pubimport"]'); await p.waitForTimeout(400);
  const copy = await p.evaluate(() => state.recipes.find(r => r.origin && r.origin.pub === 'p1'));
  t.check(copy && copy.name === 'Soupe de potiron' && copy.ingredients.length === 2 && copy.origin.pseudo === 'Mamie Jo', 'copiée dans mes recettes, origine gardée');
  t.check((await p.textContent('#sheet .foot')).includes('Déjà dans mes recettes') && db.lastRpc.compter_import && db.lastRpc.compter_import.id === 'p1', '« ✓ Déjà dans mes recettes », import compté');
  await p.evaluate(() => closeModal());
  await p.click('#pubGrid .pcard[data-pid="p2"]'); await p.waitForSelector('.pubtitle');
  t.check((await p.textContent('#sheet .foot')).includes('Recette de ton foyer') && !(await p.$('#sheet .mynote')), 'ma propre recette : pas d’ajout ni de note');

  t.check(app.errs.length === 0, 'aucune erreur JS ' + app.errs.join(' | '));
  await app.close(); t.done();
})().catch(e => { console.error(e); process.exit(1); });
