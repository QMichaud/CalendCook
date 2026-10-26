/* Recettes : onglet (cartes, filtres), formulaire, fiche (étapes, menu ⋯, portions), modifications non enregistrées */
const { suite, openApp, R } = require('./lib/app');
const t = suite('Recettes');

(async () => {
  const recipes = [
    R('a', 'Ratatouille', ['Courgette', 'Aubergine', 'Tomate'], { tags: ['été'] }),
    R('b', 'Soupe de potiron', ['Potiron', 'Crème fraîche'], { tags: ['hiver'] }),
    R('c', 'Crêpes', [{ name: 'Farine', qty: 250, unit: 'g' }, { name: 'Œuf', qty: 3, unit: 'pcs' }, { name: 'Lait', qty: 0.5, unit: 'l' }, { name: 'Sel', qty: '', unit: 'pincee' }],
      { servings: 4, tags: ['rapide'], steps: '1. Mélanger la farine et les œufs\n2) Ajouter le <b>lait</b>\nÉtape 3 : cuire' })
  ];
  const app = await openApp({ now: '2026-09-30T10:00:00', data: { recipes, plan: {}, shopping: [], eaters: [] } });
  const { p } = app;
  await app.tab('rec');
  const cards = () => p.$$eval('#recList .rcard .pc-t', e => e.map(x => x.textContent).join(', '));

  t.section('1. Onglet Recettes : cartes et filtres');
  t.check(await cards() === 'Crêpes, Ratatouille, Soupe de potiron' && (await p.textContent('#recList .pickinfo')).trim() === '3 recettes', '3 cartes triées, compteur');
  t.check((await p.textContent('#recList .rcard[data-id="c"]')).includes('⏱ 20 min · 👥 4 pers.'), 'carte : durée et personnes');
  t.check(await p.$$eval('#recTag option', o => o.length) === 4 && await p.$$eval('#recSeas .fchip', e => e.length) === 4, 'filtres : étiquettes (liste), 4 saisons, ingrédients');
  await app.shot('rec-onglet');
  await p.click('#recSeas [data-saison="hiver"]');
  t.check(await cards() === 'Soupe de potiron', 'Hiver → Soupe de potiron');
  await p.click('#recList [data-act="rfclear"]');
  await p.fill('#recQ', 'lait');
  t.check(await cards() === 'Crêpes', 'recherche dans les ingrédients (lait)');
  await p.fill('#recQ', 'zzz');
  t.check((await p.textContent('#recList')).includes('Aucun résultat'), '« Aucun résultat »');
  await p.fill('#recQ', ''); await p.selectOption('#recTag', 'été');
  t.check(await cards() === 'Ratatouille', 'étiquette « été »');
  await p.selectOption('#recTag', '');

  t.section('2. Fiche : étapes, portions');
  await p.click('#recList .rcard[data-id="c"]'); await p.waitForSelector('#sheet .rtitle');
  const steps = await p.$$eval('#sheet .steps li', e => e.map(x => x.textContent));
  t.check(JSON.stringify(steps) === JSON.stringify(['Mélanger la farine et les œufs', 'Ajouter le <b>lait</b>', 'Cuire']), 'étapes numérotées, numéros tapés retirés, HTML affiché tel quel');
  const qs = () => p.$$eval('#sheet .ingrow .q', e => e.map(x => x.textContent));
  t.check(JSON.stringify(await qs()) === JSON.stringify(['250 g', '3', '0,5 L', 'pincée']), 'quantités pour 4 (virgule décimale, « 3 » sans « pièce »)');
  await p.click('#sheet .serv [data-d="1"]'); await p.click('#sheet .serv [data-d="1"]');
  t.check(JSON.stringify(await qs()) === JSON.stringify(['375 g', '4,5', '0,75 L', 'pincée']) && (await p.textContent('#sheet .servfor')) === 'pour 6 (recette pour 4)', '+ + : 6 personnes, quantités × 1,5');
  await app.shot('rec-fiche-portions');
  for(let i = 0; i < 8 && !(await p.$eval('#sheet .serv [data-d="-1"]', e => e.disabled)); i++) await p.click('#sheet .serv [data-d="-1"]');
  t.check((await p.textContent('#sheet .serv')).includes('1 personne') && await p.$eval('#sheet .serv [data-d="-1"]', e => e.disabled), 'minimum 1 personne, « − » désactivé');
  t.check(await p.evaluate(() => findRecipe('c').servings === 4), 'consultation : rien n’est enregistré');

  t.section('3. Menu ⋯');
  t.check(!(await p.$('#sheet .foot')) && await p.isHidden('#recMenu'), 'plus de boutons en bas, menu fermé');
  await p.click('#sheet [data-act="pubmenu"]');
  t.check(JSON.stringify(await p.$$eval('#recMenu .menu-i', e => e.map(x => x.textContent.trim()))) === JSON.stringify(['✏️Modifier', '📅Planifier', 'Supprimer la recette']), 'Modifier / Planifier / Supprimer');
  await p.click('#sheet h2'); t.check(await p.isHidden('#recMenu'), 'clic ailleurs : menu refermé');
  await p.click('#sheet [data-act="pubmenu"]'); await p.click('#recMenu [data-act="planfrom"]'); await p.waitForTimeout(200);
  t.check(!(await p.$('#sheet .rtitle')) && await app.modalOpen(), 'Planifier : choix du créneau');
  await p.evaluate(() => closeModal());

  t.section('4. Formulaire : portions');
  await p.evaluate(() => openRecipeForm('c')); await p.waitForSelector('#rServP');
  const fq = () => p.$$eval('#ingWrap .i-qty', e => e.map(x => x.value));
  await p.click('#rServP'); await p.click('#rServP');
  t.check(await p.inputValue('#rServ') === '6' && JSON.stringify(await fq()) === JSON.stringify(['375', '4.5', '0.75', '']) && (await p.textContent('#ingFor')).includes('(recalculées)'), '+ + : quantités recalculées');
  await p.click('#rServM'); await p.click('#rServM');
  t.check(JSON.stringify(await fq()) === JSON.stringify(['250', '3', '0.5', '']), '− − : retour exact aux quantités de départ');
  await p.fill('#rServ', '2');
  t.check(JSON.stringify(await fq()) === JSON.stringify(['250', '3', '0.5', '']), 'nombre tapé : quantités inchangées (correction)');

  t.section('5. Modifications non enregistrées');
  await app.pullSheet();
  t.check(await app.modalOpen() && await p.isVisible('#ask'), 'glissé vers le bas : la fenêtre reste, pop-up affichée');
  t.check((await p.textContent('#ask')).includes('Tes modifications n’ont pas été enregistrées'), 'texte au tutoiement');
  await p.mouse.click(10, 10); await p.waitForTimeout(150);
  t.check(await p.isVisible('#ask'), 'toucher à côté : la pop-up reste');
  await app.shot('rec-pas-enregistre');
  await p.click('#ask [data-act="askquit"]');
  t.check(!(await app.modalOpen()) && await p.evaluate(() => findRecipe('c').servings === 4), '« Quitter sans enregistrer » : rien n’a changé');
  await p.evaluate(() => openRecipeForm('c')); await app.pullSheet();
  t.check(!(await p.isVisible('#ask')) && !(await app.modalOpen()), 'formulaire intact : fermé sans question');
  await p.evaluate(() => openRecipeForm('c')); await p.fill('#rName', 'Crêpes bretonnes'); await app.pullSheet();
  await p.click('#ask [data-act="asksave"]'); await p.waitForTimeout(250);
  t.check(await p.evaluate(() => findRecipe('c').name === 'Crêpes bretonnes'), '« Enregistrer » : enregistrée');
  await p.evaluate(() => openRecipeForm('c')); await p.fill('#rName', 'X'); await p.click('#rCancel');
  t.check(!(await app.modalOpen()), '« Annuler » ferme sans question');

  t.section('6. Nouvelle recette, validation, suppression');
  await app.tab('rec'); await p.click('#newRec'); await p.waitForSelector('#rName');
  t.check(await p.evaluate(() => document.querySelector('#sheet').scrollTop) === 0, 'formulaire ouvert en haut');
  await p.fill('#rName', 'Tarte aux pommes'); await p.fill('#rDur', '45'); await p.fill('#rServ', '6');
  await p.fill('#ingWrap .i-name', 'pommes'); await p.fill('#ingWrap .i-qty', '4');
  await p.click('[data-act="adding"]'); await p.fill('#ingWrap .ingline:nth-child(2) .i-name', 'Ingrédient inventé');
  await p.click('#recForm button[type=submit]'); await p.waitForTimeout(250);
  t.check(await p.isVisible('#recForm') && await p.$eval('#ingWrap .ingline:nth-child(2) .i-name', e => e.classList.contains('bad')), 'ingrédient hors de la liste : refusé (en rouge)');
  await p.click('#ingWrap .ingline:nth-child(2) [data-act="deling"]');
  await p.fill('#rSteps', 'Éplucher les pommes\nCuire 30 min');
  await p.click('#recForm button[type=submit]'); await p.waitForTimeout(250);
  const tp = await p.evaluate(() => state.recipes.find(r => r.name === 'Tarte aux pommes'));
  t.check(tp && tp.ingredients[0].name === 'Pomme' && tp.servings === 6 && tp.steps.split('\n').length === 2, 'enregistrée : « pommes » → Pomme, 6 personnes, 2 étapes');
  await p.click(`#recList .rcard[data-id="${tp.id}"]`); await p.waitForSelector('#sheet .rtitle');
  await p.click('#sheet [data-act="pubmenu"]'); await p.click('#recMenu [data-act="delrec"]'); await p.waitForTimeout(250);
  t.check(await p.evaluate(id => !findRecipe(id), tp.id), 'supprimée (après confirmation)');

  t.check(app.errs.length === 0, 'aucune erreur JS ' + app.errs.join(' | '));
  await app.close(); t.done();
})().catch(e => { console.error(e); process.exit(1); });
