/* Import depuis un lien (compte connecté) : formulaire rempli par la fonction « import-recette » */
const { suite, openApp, loadImportFunction, readFixture } = require('./lib/app');
const t = suite('Import depuis un lien');

(async () => {
  const fn = await loadImportFunction();
  const pages = { 'https://www.marmiton.org/recettes/tartiflette.aspx': 'page-marmiton.html', 'https://blog.exemple.fr/gateau/': 'page-wordpress.html' };
  let installed = true;
  const app = await openApp({ now: '2026-09-30T10:00:00', cloud: { fn: { 'import-recette': (body, headers) => {
    if(!installed) return { status: 404, body: { code: 'NOT_FOUND', message: 'Requested function was not found' } };
    if(headers.authorization !== 'Bearer AT') return { status: 401, body: { error: 'Connecte-toi pour importer une recette' } };
    const f = pages[body.url];
    if(!f) return { status: 422, body: { error: 'Pas de fiche recette lisible sur cette page' } };
    return Object.assign(fn.extractRecipe(readFixture(f), body.url), { url: body.url });
  } } } });
  const { p, db } = app;

  t.section('1. Formulaire');
  await app.tab('rec'); await p.click('#newRec'); await p.waitForSelector('#iuUrl');
  t.check(await p.isVisible('#iuUrl') && await p.isHidden('#iuTxt'), 'onglet « Depuis un lien » ouvert par défaut');
  await p.click('#iuGo');
  t.check((await p.textContent('#iuMsg')).includes('Colle d’abord le lien'), 'sans lien : message');
  await p.fill('#iuUrl', 'pas un lien'); await p.click('#iuGo');
  t.check((await p.textContent('#iuMsg')).includes('ne semble pas valide'), 'lien invalide : message');

  t.section('2. Marmiton');
  await p.fill('#iuUrl', 'https://www.marmiton.org/recettes/tartiflette.aspx'); await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.querySelector('#iuMsg').classList.contains('ok'));
  t.check(db.calls.includes('POST /functions/v1/import-recette'), 'fonction appelée');
  t.check(await p.inputValue('#rName') === 'La vraie tartiflette' && await p.inputValue('#rDur') === '75' && await p.inputValue('#rServ') === '6', 'nom, 75 min, 6 personnes');
  t.check(await p.inputValue('#rUrl') === 'https://www.marmiton.org/recettes/tartiflette.aspx', 'lien de la recette rempli');
  const ings = await p.$$eval('#ingWrap .ingline', e => e.map(l => [l.querySelector('.i-name').value, l.querySelector('.i-qty').value, l.querySelector('.i-unit').value].join('|')));
  t.check(ings.includes('Pomme de terre|1|kg') && ings.includes('Lardon|200|g') && ings.includes('Ail|1|gousse') && ings.includes('Sel||') && ings.includes('Poivre||'), 'ingrédients découpés : ' + ings.length);
  t.check(ings.includes('Oignon|2|pcs') && ings.includes('Tomate|2|pcs') && ings.includes('Huile|1|cs'), '« 2 oignons » → 2 pièces, « 2 à 3 tomates » → 2');
  t.check(await p.$eval('#ingWrap', w => Array.from(w.querySelectorAll('.i-name')).some(i => i.value === 'Lardon' && i.classList.contains('approx'))), '« lardons fumés » → Lardon, en orange (à vérifier)');
  t.check((await p.inputValue('#rSteps')).split('\n').length === 4, '4 étapes');
  t.check((await p.textContent('#iuMsg')).startsWith('✓ Recette importée : 13 ingrédients, 4 étapes.'), await p.textContent('#iuMsg'));
  t.check((await p.textContent('#iuOrig summary')).includes('sur le site'), 'ingrédients tels qu’écrits sur le site');
  await app.shot('import-lien');

  t.section('3. Erreurs');
  await p.evaluate(() => closeModal());
  await p.click('#newRec'); await p.waitForSelector('#iuUrl');
  await p.fill('#iuUrl', 'https://www.site.fr/blog'); await p.click('#iuGo');
  await p.waitForFunction(() => document.querySelector('#iuMsg').classList.contains('err'));
  t.check((await p.textContent('#iuMsg')) === 'Pas de fiche recette lisible sur cette page.', 'page sans recette : message de la fonction');
  installed = false;
  await p.click('#iuGo'); await p.waitForFunction(() => /pas encore installé/.test(document.querySelector('#iuMsg').textContent));
  t.check(true, 'fonction absente : « pas encore installé (voir le README) »');
  installed = true;

  t.section('4. Remplir depuis le lien d’une recette existante');
  await p.evaluate(() => closeModal());
  await p.evaluate(() => { state.recipes.push({ id: 'g', name: 'Gâteau', duration: 5, tags: [], ingredients: [], url: 'https://blog.exemple.fr/gateau/' }); render(); openRecipeForm('g'); });
  await p.waitForSelector('#iuFromUrl');
  await p.click('#iuFromUrl');
  await p.waitForFunction(() => document.querySelector('#iuMsg2').classList.contains('ok'));
  t.check(await p.inputValue('#rName') === 'Gâteau au yaourt' && await p.inputValue('#rDur') === '45' && await p.inputValue('#rServ') === '8', '« Remplir depuis ce lien » (après confirmation) : 45 min, 8 personnes');
  t.check(await p.$$eval('#ingWrap .ingline', e => e.length) === 4 && (await p.inputValue('#rSteps')).split('\n').length === 3, '4 ingrédients, 3 étapes (sections)');

  t.check(app.errs.length === 0, 'aucune erreur JS ' + app.errs.join(' | '));
  await app.close(); t.done();
})().catch(e => { console.error(e); process.exit(1); });
