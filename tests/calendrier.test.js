/* Calendrier : semaines, jours passés, choix d'une recette pour un créneau (cartes, filtres), retrait */
const { suite, openApp, R } = require('./lib/app');
const t = suite('Calendrier');

(async () => {
  const recipes = [
    R('a', 'Ratatouille', ['Courgette', 'Aubergine', 'Tomate', 'Oignon'], { tags: ['été'] }),
    R('b', 'Soupe de potiron', ['Potiron', 'Oignon', 'Crème fraîche'], { tags: ['hiver'] }),
    R('c', 'Omelette', ['Œuf', 'Oignon'], { tags: ['rapide'] }),
    R('d', 'Tian de courgettes', ['Courgette', 'Tomate']),
    R('e', 'Gratin de potimarron', ['Potimarron', 'Crème fraîche']),
    R('f', 'Pâtes au pesto', ['Pâtes', 'Basilic', 'Parmesan'], { tags: ['rapide'] }),
    R('g', 'Croque-monsieur', ['Pain de mie', 'Jambon', 'Emmental']),
    R('h', 'Salade niçoise', ['Salade', 'Tomate', 'Œuf', 'Thon'])
  ];
  /* mercredi 30 septembre 2026 : lundi et mardi sont passés */
  const app = await openApp({ now: '2026-09-30T10:00:00', data: { recipes, plan: { '2026-09-30': { midi: [{ id: 'c', who: '' }], soir: [] } }, shopping: [], eaters: [] } });
  const { p } = app;
  const names = () => p.$$eval('#pickList .pc-t', e => e.map(x => x.textContent).join(', '));
  const H = () => p.$eval('#sheet', e => Math.round(e.getBoundingClientRect().height));

  t.section('1. Semaine affichée');
  t.check((await p.textContent('#wLabel')).includes('40'), 'semaine 40 (du 28 sept. au 4 oct.) : ' + await p.textContent('#wLabel'));
  t.check(await p.$$eval('.day', e => e.length) === 7 && await p.$$eval('.day.past', e => e.length) === 2, '7 jours, dont lundi et mardi passés');
  t.check(await p.$$eval('.day.past .addmini', e => e.length) === 0 && await p.$$eval('.day.today .addmini', e => e.length) === 2, 'jours passés : pas de « + Ajouter une recette »');
  t.check((await p.textContent('.day.today')).includes('Omelette'), 'aujourd’hui : Omelette au menu');
  await app.shot('cal-semaine');
  await p.click('#nextW'); await p.waitForTimeout(200);
  t.check((await p.textContent('#wLabel')).includes('41') && await p.$$eval('.day.past', e => e.length) === 0, 'semaine suivante : aucun jour passé');
  await p.click('#prevW'); await p.waitForTimeout(200);

  t.section('2. Choisir une recette : fenêtre fixe, cartes');
  await p.click('.day.today .addmini[data-slot="midi"]'); await p.waitForSelector('#pickList .pcard');
  const h0 = await H(), vh = await p.evaluate(() => innerHeight);
  t.check((await p.textContent('#sheet h2')).startsWith('Ajouter au mercredi midi'), 'titre « Ajouter au mercredi midi »');
  t.check(h0 > vh * 0.85, 'grande fenêtre (' + h0 + ' px sur ' + vh + ')');
  t.check(await p.$$eval('#pickList .pgrid .pcard', e => e.length) === 8 && (await p.textContent('#pickInfo')).trim() === '8 recettes', '8 cartes carrées, compteur');
  t.check((await p.textContent('#pickList .pcard[data-id="c"]')).includes('déjà prévu'), 'recette déjà au menu signalée');
  await app.shot('cal-choisir');
  await p.fill('#pickQ', 'zzz');
  t.check(await H() === h0 && (await p.textContent('#pickList')).includes('Aucun résultat'), 'aucun résultat : même hauteur, « Aucun résultat »');
  await p.click('#pickInfo [data-act="rfclear"]');
  t.check(await p.inputValue('#pickQ') === '' && await p.$$eval('#pickList .pcard', e => e.length) === 8, '« effacer les filtres »');
  await p.fill('#pickQ', 'thon');
  t.check(await names() === 'Salade niçoise', 'recherche dans les ingrédients (thon)');
  await p.fill('#pickQ', ''); await p.selectOption('#pickTag', 'rapide');
  t.check(await names() === 'Omelette, Pâtes au pesto', 'étiquette « rapide »');
  await p.selectOption('#pickTag', '');

  t.section('3. Filtres saisons et ingrédients');
  await p.click('#pickSeas [data-saison="ete"]');
  t.check(await names() === 'Ratatouille, Salade niçoise, Tian de courgettes', 'été → ' + await names());
  await p.click('#pickSeas [data-saison="hiver"]');
  t.check(await names() === 'Gratin de potimarron, Ratatouille, Salade niçoise, Soupe de potiron, Tian de courgettes', 'été + hiver (l’un ou l’autre)');
  await p.click('#pickSeas [data-saison="ete"]'); await p.click('#pickSeas [data-saison="hiver"]');
  await p.click('#pickIng');
  const top = await p.$$eval('#pickDrop .ingopt', e => e.map(x => x.textContent));
  t.check(top[0] === 'Oignon3 recettes', 'champ vide : ingrédients les plus utilisés d’abord (' + top.slice(0, 3).join(' | ') + ')');
  await p.type('#pickIng', 'tom'); await p.click('#pickDrop .ingopt');
  t.check(await names() === 'Ratatouille, Salade niçoise, Tian de courgettes' && await p.inputValue('#pickIng') === '', 'avec Tomate');
  await p.type('#pickIng', 'oeu'); await p.keyboard.press('Enter');
  t.check(await names() === 'Salade niçoise', 'Tomate + Œuf (Entrée, sans accent) → Salade niçoise');
  await p.click('#pickSeas [data-saison="hiver"]');
  t.check((await p.textContent('#pickList')).includes('Aucun résultat') && await H() === h0, '+ Hiver : aucun résultat, hauteur inchangée');
  await p.click('#pickSeas [data-saison="hiver"]'); await p.click('#sheet h2'); await p.waitForTimeout(250);
  t.check(await p.isHidden('#pickDrop'), 'propositions refermées');
  await app.shot('cal-filtres');
  await p.click('#pickIngSel [data-ing]');
  t.check(await names() === 'Omelette, Salade niçoise', 'Tomate retirée : avec Œuf → Omelette, Salade niçoise');

  t.section('4. Ajouter, retrouver les filtres, retirer');
  await p.click('#pickList .pcard[data-id="h"]'); await p.waitForTimeout(250);
  t.check(!(await app.modalOpen()) && (await p.textContent('.day.today')).includes('Salade niçoise'), 'Salade niçoise ajoutée au mercredi midi');
  await p.click('.day.today .addmini[data-slot="soir"]'); await p.waitForSelector('#pickList');
  t.check(JSON.stringify(await p.$$eval('#pickIngSel .tagpick', e => e.map(x => x.textContent))) === JSON.stringify(['Œuf ✕']), 'filtres gardés pour le créneau suivant');
  await p.click('#pickInfo [data-act="rfclear"]');
  await p.evaluate(() => closeModal());
  await p.click('.day.today [data-act="unplan"][data-id="c"]'); await p.waitForTimeout(200);
  t.check(!(await p.textContent('.day.today')).includes('Omelette') && await p.evaluate(() => !state.plan['2026-09-30'].midi.some(e => e.id === 'c')), 'corbeille : Omelette retirée du menu');

  t.section('5. Nouvelle recette depuis un créneau');
  await p.click('.day.today .addmini[data-slot="soir"]'); await p.fill('#pickQ', 'Gratin dauphinois');
  await p.click('#pickNew');
  t.check(await p.inputValue('#rName') === 'Gratin dauphinois', 'nom prérempli avec la recherche');
  await p.click('#rCancel');
  t.check((await p.textContent('#sheet h2')).startsWith('Ajouter au mercredi soir'), 'Annuler : retour au choix du créneau');
  await p.click('#pickNew'); await p.fill('#rName', 'Gratin dauphinois'); await p.fill('#rDur', '60');
  await p.click('#recForm button[type=submit]'); await p.waitForTimeout(250);
  t.check(await p.evaluate(() => { const l = state.plan['2026-09-30'].soir; return l.length === 1 && findRecipe(l[0].id).name === 'Gratin dauphinois'; }), 'créée et ajoutée au mercredi soir');
  t.check((await p.textContent('#toast')).includes('créée et ajoutée au mercredi soir'), 'message de confirmation');

  t.section('6. Fenêtre : glisser dans la liste ne la ferme pas');
  await p.evaluate(() => { for(let i = 0; i < 14; i++) state.recipes.push({ id: 'x' + i, name: 'Recette ' + i, duration: 10, tags: [], ingredients: [] }); render(); });
  await p.click('.day.today .addmini[data-slot="midi"]'); await p.waitForSelector('#pickList .pcard');
  await p.evaluate(() => { document.querySelector('#pickList').scrollTop = 600; });
  const box = await p.$eval('#pickList', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 60 }; });
  await app.swipe(box.x, box.y, box.y + 300);
  t.check(await app.modalOpen(), 'liste défilée : glisser vers le bas la fait remonter, la fenêtre reste');
  await p.evaluate(() => { document.querySelector('#pickList').scrollTop = 0; });
  await app.pullSheet();
  t.check(!(await app.modalOpen()), 'depuis la poignée : la fenêtre se ferme');

  t.check(app.errs.length === 0, 'aucune erreur JS ' + app.errs.join(' | '));
  await app.close(); t.done();
})().catch(e => { console.error(e); process.exit(1); });
