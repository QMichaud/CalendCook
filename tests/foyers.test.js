/* Plusieurs foyers : copier une recette dans un autre de mes foyers, recette publique d'un de mes foyers */
const { suite, openApp, R } = require('./lib/app');
const t = suite('Plusieurs foyers');

(async () => {
  const tarte = R('a', 'Tarte aux pommes', [{ name: 'Pomme', qty: 4, unit: 'pcs' }, { name: 'Farine', qty: 200, unit: 'g' }, { name: 'Beurre', qty: 100, unit: 'g' }],
    { duration: 50, servings: 6, steps: 'Préparer la pâte\nCuire', tags: ['dessert'], public: true, photo: { f: '46616d696c6c65/a-1.webp', t: '46616d696c6c65/a-1-t.webp' } });
  const coloc = { recipes: [R('s', 'Soupe', ['Poireau'])], plan: {}, shopping: [{ id: 'k', label: 'Pain', done: false }], eaters: [] };
  let answer = true;                                       // réponse aux questions (confirm)
  const publique = { pid: 'p1', total: 1, note: null, nb_notes: 0, nb_imports: 0, auteur_pseudo: 'Moi', mienne: true, saisons: ['automne'],
    data: { id: 'a', name: 'Tarte aux pommes', duration: 50, servings: 6, steps: 'Préparer la pâte\nCuire', ingredients: tarte.ingredients } };
  const app = await openApp({ data: { recipes: [tarte], plan: {}, shopping: [], eaters: [] }, onDialog: d => answer ? d.accept() : d.dismiss(),
    cloud: { foyer: 'Famille', others: { Coloc: coloc }, rpc: {
      chercher_recettes: () => [publique], recette_publique: () => [publique], compter_import: () => null, mes_publications: () => [] } } });
  const { p, db } = app;
  const openMenu = async () => { await p.evaluate(() => openRecipe('a')); await p.waitForSelector('#sheet .rtitle'); await p.click('#sheet [data-act="pubmenu"]'); };

  t.section('1. Copier une recette dans un autre foyer');
  await openMenu();
  t.check(await p.isVisible('#recMenu [data-act="tofoyer"]'), 'menu ⋯ : « Copier dans un autre foyer »');
  await p.click('#recMenu [data-act="tofoyer"]');
  t.check(JSON.stringify(await p.$$eval('#sheet [data-act="copyfoyer"]', e => e.map(x => x.dataset.foyer))) === '["Coloc"]', 'seuls mes autres foyers sont proposés (Coloc)');
  await app.shot('foyers-copier');
  await p.click('#sheet [data-act="copyfoyer"][data-foyer="Coloc"]');
  await p.waitForFunction(() => /copiée dans « Coloc »/.test(document.querySelector('#toast').textContent));
  const got = db.others.Coloc.recipes;
  const c = got.find(r => r.name === 'Tarte aux pommes');
  t.check(got.length === 2 && got[0].name === 'Soupe' && c && c.id !== 'a' && c.ingredients.length === 3 && c.servings === 6, 'ajoutée aux recettes de Coloc (nouvel identifiant), la Soupe reste');
  t.check(c && !c.public && JSON.stringify(c.tags) === '["dessert"]', 'copie privée, étiquettes gardées');
  t.check(c && c.photo && c.photo.f.startsWith('436f6c6f63/') && db.calls.some(x => x === 'POST /storage/v1/object/copy'), 'photo copiée dans le dossier de Coloc');
  t.check(db.others.Coloc.shopping.length === 1 && await p.evaluate(() => state.recipes.length === 1 && findRecipe('a').public === true), 'courses de Coloc intactes, recette d’ici inchangée');
  t.check(await p.isVisible('#sheet .rtitle'), 'retour à la fiche');

  t.section('2. Déjà présente');
  answer = false;
  await openMenu(); await p.click('#recMenu [data-act="tofoyer"]'); await p.click('#sheet [data-act="copyfoyer"]');
  await p.waitForTimeout(400);
  t.check(db.others.Coloc.recipes.length === 2, 'même nom déjà dans Coloc : question posée, « Annuler » ne copie rien');
  answer = true;

  t.section('3. Un seul foyer');
  await p.evaluate(() => { cloud.foyers = ['Famille']; });
  await openMenu();
  t.check(!(await p.$('#recMenu [data-act="tofoyer"]')), 'pas de « Copier dans un autre foyer »');
  await p.evaluate(() => { cloud.foyers = ['Coloc', 'Famille']; closeModal(); });

  t.section('4. Recette publique d’un de mes foyers');
  await app.tab('search'); await p.waitForSelector('#pubGrid .pcard');
  await p.click('#pubGrid .pcard[data-pid="p1"]'); await p.waitForSelector('.pubtitle');
  t.check((await p.textContent('#sheet .author small')).includes('de ton foyer') && (await p.textContent('#sheet .foot')).includes('Recette de ton foyer'), 'dans Famille (où elle est) : « Recette de ton foyer »');
  await p.evaluate(() => closeModal());
  await p.evaluate(() => switchFoyer('Coloc')); await p.waitForFunction(() => cloud.foyer === 'Coloc' && state.recipes.length === 2);
  t.check(await p.evaluate(() => state.recipes.map(r => r.name).sort().join(', ')) === 'Soupe, Tarte aux pommes', 'dans Coloc : la copie est là');
  await p.evaluate(() => { state.recipes = state.recipes.filter(r => r.name !== 'Tarte aux pommes'); render(); });
  await app.tab('search'); await p.click('#pubGrid .pcard[data-pid="p1"]'); await p.waitForSelector('.pubtitle');
  t.check((await p.textContent('#sheet .author small')).includes('d’un de tes foyers'), 'dans Coloc : « d’un de tes foyers »');
  t.check(await p.isVisible('#sheet [data-act="pubimport"]') && !(await p.$('#sheet .mynote')), 'bouton « Ajouter à mes recettes » (pas de note : elle vient de mon foyer)');
  await app.shot('foyers-publique');
  await p.click('#sheet [data-act="pubimport"]'); await p.waitForTimeout(300);
  t.check(await p.evaluate(() => state.recipes.some(r => r.origin && r.origin.pub === 'p1')) && (await p.textContent('#sheet .foot')).includes('Déjà dans mes recettes'), 'ajoutée à Coloc');

  t.check(app.errs.length === 0, 'aucune erreur JS ' + app.errs.join(' | '));
  await app.close(); t.done();
})().catch(e => { console.error(e); process.exit(1); });
