/* Courses : ajout, coche, menu « Vider », import des ingrédients d'une semaine du calendrier */
const { suite, openApp, R } = require('./lib/app');
const t = suite('Courses');

(async () => {
  const recipes = [
    R('a', 'Omelette', [{ name: 'Œuf', qty: 4, unit: 'pcs' }, { name: 'Lait', qty: 10, unit: 'cl' }]),
    R('b', 'Quiche', [{ name: 'Œuf', qty: 2, unit: '' }, { name: 'Lait', qty: 20, unit: 'cl' }, { name: 'Lardon', qty: 200, unit: 'g' }]),
    R('c', 'Taboulé', [{ name: 'Persil', qty: 1, unit: 'botte' }, { name: 'Persil', qty: 20, unit: 'g' }, { name: 'Sel', qty: '', unit: 'pincee' }])
  ];
  const plan = {
    '2026-09-28': { midi: [{ id: 'a', who: '' }], soir: [{ id: 'b', who: '' }] },
    '2026-10-01': { midi: [{ id: 'c', who: '' }, { id: 'a', who: '' }], soir: [] }
  };
  const app = await openApp({ now: '2026-09-30T10:00:00', data: { recipes, plan, shopping: [], eaters: [] } });
  const { p } = app;
  const labels = () => p.$$eval('#shopList .shopitem .txt', e => e.map(x => x.firstChild.textContent.trim()));
  await app.tab('shop');

  t.section('1. Ajouter, cocher, supprimer');
  t.check((await p.textContent('#shopList')).includes('Ta liste est vide'), 'liste vide');
  await p.fill('#newItem', 'Pain'); await p.click('#addItem');
  await p.fill('#newItem', 'Beurre'); await p.keyboard.press('Enter');
  await p.fill('#newItem', '   '); await p.click('#addItem');
  t.check(JSON.stringify(await labels()) === JSON.stringify(['Pain', 'Beurre']), 'deux produits ajoutés (bouton et Entrée), vide ignoré');
  await p.click('#shopList .shopitem:nth-child(1) [data-act="ck"]');
  t.check(await p.$eval('#shopList .shopitem:nth-child(1)', e => e.classList.contains('done')) && await p.evaluate(() => state.shopping[0].done), 'Pain coché');

  t.section('2. Menu « Vider »');
  t.check(await p.isHidden('#clearMenu'), 'menu fermé');
  await p.click('#clearBtn');
  t.check(await p.isVisible('#clearMenu') && (await p.textContent('#clearDoneN')).includes('1'), 'menu ouvert, 1 coché');
  await p.click('[data-act="cleardone"]');
  t.check(JSON.stringify(await labels()) === JSON.stringify(['Beurre']) && await p.isHidden('#clearMenu'), '« Vider les cochés » : Pain retiré');
  await p.click('#clearBtn'); await p.click('[data-act="cleardone"]');
  t.check((await p.textContent('#toast')).includes('Aucun produit coché'), 'rien de coché : message');
  await p.click('#shopList [data-act="delitem"]');
  t.check((await p.textContent('#shopList')).includes('Ta liste est vide'), 'corbeille : supprimé');

  t.section('3. Import depuis le calendrier');
  await p.click('#impFold summary');
  t.check((await p.inputValue('#impWeek')) === '2026-40', 'semaine du calendrier proposée (40)');
  t.check((await p.textContent('#impPreview')).includes('3/3 recettes'), '3 recettes (Omelette prévue deux fois, comptée une fois)');
  const rows = await p.$$eval('#impPreview .ingrow', e => e.map(x => Array.from(x.children, c => c.textContent.trim()).filter(Boolean).join(' ')));
  t.check(rows.includes('Œuf 6') && rows.includes('Lait 30 cl'), 'regroupés : œufs « pièce » + sans unité = 6, lait 30 cl (' + rows.join(' | ') + ')');
  t.check(rows.filter(r => r.startsWith('Persil')).length === 2, '1 botte et 20 g de persil ne s’additionnent pas');
  t.check(rows.includes('Sel pincée'), 'sans quantité : « Sel pincée » (pas « 0 pincée »)');
  await p.click('#impPreview [data-act="imptoggle"][data-id="b"]');
  t.check((await p.textContent('#impPreview')).includes('2/3 recettes') && !(await p.textContent('#impPreview')).includes('Lardon'), 'Quiche exclue : plus de lardons');
  await app.shot('courses-import');
  await p.click('#impPreview [data-act="import"][data-mode="add"]');
  const l1 = await labels();
  t.check(l1.includes('Œuf — 4') && l1.includes('Lait — 10 cl') && !l1.some(x => x.startsWith('Lardon')), 'ajoutés à la liste : ' + l1.join(', '));
  t.check((await p.textContent('#shopList .shopitem small')).startsWith('Semaine 40 ·'), 'origine indiquée (semaine, recettes)');
  await p.click('#impPreview [data-act="import"][data-mode="add"]');
  t.check((await p.textContent('#toast')).includes('déjà dans la liste') && (await labels()).length === l1.length, 'deuxième import : pas de doublon');
  await p.click('#impPreview [data-act="imptoggle"][data-id="b"]');
  await p.click('#impPreview [data-act="import"][data-mode="replace"]');
  t.check((await labels()).includes('Œuf — 6') && (await labels()).length === l1.length + 1, '« Remplacer » : liste refaite avec la Quiche');
  await p.click('#nextW2');
  t.check((await p.textContent('#impPreview')).includes('Aucune recette programmée'), 'semaine suivante : aucune recette');

  t.section('4. Tout vider');
  await p.click('#clearBtn'); await p.click('[data-act="clearall"]');
  t.check((await p.textContent('#shopList')).includes('Ta liste est vide') && await p.evaluate(() => state.shopping.length === 0), '« Vider la liste » (après confirmation)');
  await p.reload(); await p.waitForTimeout(300);
  t.check(await p.evaluate(() => state.shopping.length === 0 && state.recipes.length === 3), 'gardé après rechargement');

  t.check(app.errs.length === 0, 'aucune erreur JS ' + app.errs.join(' | '));
  await app.close(); t.done();
})().catch(e => { console.error(e); process.exit(1); });
