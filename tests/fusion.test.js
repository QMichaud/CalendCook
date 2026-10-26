/* Fusion des modifications faites en même temps sur deux appareils (base commune, ici, là-bas) */
const { suite, openApp, R } = require('./lib/app');
const t = suite('Fusion des modifications');

(async () => {
  const app = await openApp({ data: { recipes: [], plan: {}, shopping: [], eaters: [] } });
  const { p } = app;
  /* m(base, ici, là-bas) dans la page */
  const merge = (b, l, r) => p.evaluate(([b, l, r]) => mergeState(b, l, r), [b, l, r]);
  const S = x => Object.assign({ recipes: [], plan: {}, shopping: [], eaters: [] }, x);
  const names = s => s.recipes.map(r => r.name).join(', ');

  t.section('1. Recettes');
  const a = R('a', 'Crêpes'), b = R('b', 'Soupe');
  let o = await merge(S({ recipes: [a] }), S({ recipes: [a, b] }), S({ recipes: [a, R('c', 'Gratin')] }));
  t.check(names(o) === 'Crêpes, Gratin, Soupe', 'ajoutées des deux côtés : les deux gardées');
  o = await merge(S({ recipes: [a, b] }), S({ recipes: [a] }), S({ recipes: [a, b] }));
  t.check(names(o) === 'Crêpes', 'supprimée ici : supprimée');
  o = await merge(S({ recipes: [a, b] }), S({ recipes: [a, b] }), S({ recipes: [b] }));
  t.check(names(o) === 'Soupe', 'supprimée là-bas : supprimée');
  o = await merge(S({ recipes: [a] }), S({ recipes: [] }), S({ recipes: [Object.assign({}, a, { duration: 45 })] }));
  t.check(o.recipes.length === 1 && o.recipes[0].duration === 45, 'supprimée ici mais modifiée là-bas : gardée (modification)');
  o = await merge(S({ recipes: [a] }), S({ recipes: [Object.assign({}, a, { name: 'Crêpes sucrées' })] }), S({ recipes: [Object.assign({}, a, { duration: 45 })] }));
  t.check(o.recipes[0].name === 'Crêpes sucrées' && o.recipes[0].duration === 45, 'nom changé ici, durée là-bas : les deux changements gardés');
  o = await merge(S({ recipes: [a] }), S({ recipes: [Object.assign({}, a, { name: 'Ici' })] }), S({ recipes: [Object.assign({}, a, { name: 'Là-bas' })] }));
  t.check(o.recipes.length === 1 && ['Ici', 'Là-bas'].includes(o.recipes[0].name), 'même champ modifié des deux côtés : une seule version (' + o.recipes[0].name + ')');

  t.section('2. Calendrier');
  const e = id => ({ id, who: '' });
  o = await merge(S({ plan: { '2026-10-01': { midi: [e('a')], soir: [] } } }),
    S({ plan: { '2026-10-01': { midi: [e('a'), e('b')], soir: [] } } }),
    S({ plan: { '2026-10-01': { midi: [e('a')], soir: [e('c')] }, '2026-10-02': { midi: [e('a')], soir: [] } } }));
  t.check(JSON.stringify(o.plan['2026-10-01'].midi.map(x => x.id)) === '["a","b"]' && o.plan['2026-10-01'].soir[0].id === 'c' && o.plan['2026-10-02'].midi[0].id === 'a',
    'plats ajoutés à des créneaux différents : tous gardés');
  o = await merge(S({ plan: { '2026-10-01': { midi: [e('a')], soir: [] } } }),
    S({ plan: { '2026-10-01': { midi: [], soir: [] } } }),
    S({ plan: { '2026-10-01': { midi: [e('a'), e('b')], soir: [] } } }));
  t.check(JSON.stringify(o.plan['2026-10-01'].midi.map(x => x.id)) === '["b"]', 'plat retiré ici, autre plat ajouté là-bas');

  t.section('3. Courses, personnes, ingrédients');
  const it = (id, label, done = false) => ({ id, label, done });
  o = await merge(S({ shopping: [it('1', 'Pain'), it('2', 'Lait')] }),
    S({ shopping: [it('1', 'Pain', true), it('2', 'Lait'), it('3', 'Beurre')] }),
    S({ shopping: [it('1', 'Pain'), it('4', 'Œufs')] }));
  t.check(o.shopping.map(x => x.label + (x.done ? '✓' : '')).join(', ') === 'Pain✓, Œufs, Beurre', 'coché ici, supprimé là-bas, ajouts des deux côtés : ' + o.shopping.map(x => x.label + (x.done ? '✓' : '')).join(', '));
  o = await merge(S({ eaters: ['Léa', 'Tom'] }), S({ eaters: ['Léa', 'Tom', 'Zoé'] }), S({ eaters: ['Léa'] }));
  t.check(JSON.stringify(o.eaters) === '["Léa","Zoé"]', '« pour qui » : Tom retiré là-bas, Zoé ajoutée ici');
  o = await merge(S({ ingredients: ['Kumquat'] }), S({ ingredients: ['Kumquat', 'Yuzu'] }), S({ ingredients: [] }));
  t.check(JSON.stringify(o.ingredients) === '["Yuzu"]', 'ingrédients ajoutés par le foyer');
  o = await merge(S({}), S({ mealDefaults: { 0: ['soir'] } }), S({ mealDefaults: { 6: ['midi'] } }));
  t.check(JSON.stringify(o.mealDefaults) === '{"0":["soir"],"6":["midi"]}', 'repas affichés par défaut');

  t.section('4. Synchronisation avec le foyer');
  await app.close();
  const sync = await openApp({ cloud: {}, data: { recipes: [a], plan: {}, shopping: [], eaters: [] } });
  const sp = sync.p;
  t.check(await sp.evaluate(() => state.recipes.length === 1), 'données du foyer chargées');
  /* modification faite ailleurs pendant qu'on ajoute une recette ici */
  sync.db.data = { recipes: [a, R('z', 'Tarte')], plan: {}, shopping: [], eaters: [] };
  await sp.evaluate(() => { state.recipes.push({ id: 'y', name: 'Salade', duration: 10, tags: [], ingredients: [] }); store.save(); });
  await sp.evaluate(() => cloud.flush());                 // envoi immédiat (sinon après un court délai)
  const sent = sync.db.data.recipes.map(r => r.name).sort().join(', ');
  t.check(sent === 'Crêpes, Salade, Tarte', 'envoi : ma recette ajoutée sans effacer celle de l’autre appareil (' + sent + ')');

  t.check(await sp.evaluate(() => state.recipes.map(r => r.name).sort().join(', ')) === 'Crêpes, Salade, Tarte', 'ici aussi : la recette de l’autre appareil apparaît');
  t.check(sync.errs.length === 0, 'aucune erreur JS ' + sync.errs.join(' | '));
  await sync.close(); t.done();
})().catch(e => { console.error(e); process.exit(1); });
