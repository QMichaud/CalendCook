/* Recettes d'amis : onglet Recherche, « 👥 Mes amis » (recettes publiques de mes amis seulement) */
const { suite, openApp, R } = require('./lib/app');
const t = suite('Recettes d’amis');

(async () => {
  const pubR = (pid, name, pseudo, extra = {}) => Object.assign({ pid, total: 0, note: null, nb_notes: 0, nb_imports: 0, auteur_pseudo: pseudo, saisons: ['ete'], mienne: false,
    data: { id: 'id-' + pid, name, duration: 30, servings: 4, steps: 'Cuire', ingredients: [{ name: 'Tomate', qty: 2, unit: 'pcs' }, { name: 'Oignon', qty: 1, unit: 'pcs' }, { name: 'Ail', qty: 1, unit: 'gousse' }] } }, extra);
  const deLea = [pubR('p1', 'Gaspacho', 'Léa', { note: 4.5, nb_notes: 2 }), pubR('p2', 'Tarte tatin', 'Léa')];
  const autres = [pubR('p3', 'Pizza', 'Inconnu')];
  let amisList = [{ email: 'lea@x.fr', etat: 'ami' }];
  const calls = [];
  const app = await openApp({ data: { recipes: [
      /* importée autrefois depuis l'ancienne liste « Recettes d'amis » */
      Object.assign(R('old', 'Tarte tatin', ['Pomme']), { origin: { email: 'lea@x.fr', id: 'id-p2', root: 'id-p2' } }) ], plan: {}, shopping: [], eaters: [] },
    cloud: { rpc: {
      mes_amis: () => amisList,
      chercher_recettes: b => { calls.push(b); const l = (b.amis ? deLea : deLea.concat(autres)).filter(x => !b.q || x.data.name.toLowerCase().includes(b.q));
        return l.map(x => Object.assign({}, x, { total: l.length })); },
      recette_publique: b => deLea.concat(autres).filter(x => x.pid === b.id),
      compter_import: () => null } } });
  const { p } = app;
  const names = () => p.$$eval('#pubGrid .pc-t', e => e.map(x => x.textContent).join(', '));
  const last = () => calls[calls.length - 1];

  t.section('1. Depuis l’onglet Recettes');
  await app.tab('rec');
  t.check(await p.isVisible('#friendRecBtn'), 'bouton « 👥 Recettes d’amis »');
  await p.click('#friendRecBtn'); await p.waitForSelector('#pubGrid .pcard');
  t.check(await p.$eval('#v-search', e => e.classList.contains('on')) && !(await app.modalOpen()), 'ouvre l’onglet Recherche (plus de fenêtre à part)');
  t.check(await p.$eval('#pubScope [data-scope="amis"]', e => e.classList.contains('on')) && last().amis === true, '« 👥 Mes amis » sélectionné, recherche « amis seulement » demandée au serveur');
  t.check(await names() === 'Gaspacho, Tarte tatin' && (await p.textContent('#pubInfo')).includes('2 recettes de tes amis'), 'seulement les recettes publiques de Léa');
  t.check((await p.textContent('#pubGrid .pcard[data-pid="p1"]')).includes('👤 Léa') && (await p.textContent('#pubGrid .pcard[data-pid="p1"]')).includes('4,5'), 'cartes comme dans Recherche (note), avec le nom de l’ami');
  t.check(await p.isHidden('#pubMore'), 'tout est affiché : pas de « Voir plus de recettes »');
  await app.shot('amis-recherche');

  t.section('2. Filtres et bascule');
  await p.fill('#qPub', 'gasp'); await p.waitForTimeout(500);
  t.check(await names() === 'Gaspacho' && last().amis === true && last().q === 'gasp', 'recherche dans les recettes d’amis');
  await p.fill('#qPub', ''); await p.waitForTimeout(500);
  await p.click('#pubScope [data-scope="tous"]'); await p.waitForFunction(() => document.querySelectorAll('#pubGrid .pcard').length === 3);
  t.check(last().amis === false && !(await p.textContent('#pubGrid')).includes('👤'), '« 🌍 Toutes » : toutes les recettes publiques');
  await p.click('#pubScope [data-scope="amis"]'); await p.waitForFunction(() => document.querySelectorAll('#pubGrid .pcard').length === 2);
  t.check(true, 'retour à « 👥 Mes amis »');

  t.section('3. Fiche et import');
  await p.click('#pubGrid .pcard[data-pid="p1"]'); await p.waitForSelector('.pubtitle');
  t.check((await p.textContent('#sheet .author')).includes('Léa') && await p.isVisible('#sheet .mynote') && await p.isVisible('#sheet [data-act="pubimport"]'), 'même fiche que Recherche : auteur, note, « Ajouter à mes recettes »');
  await p.click('#sheet [data-act="pubimport"]'); await p.waitForTimeout(300);
  t.check(await p.evaluate(() => state.recipes.some(r => r.name === 'Gaspacho' && r.origin && r.origin.pub === 'p1')), 'Gaspacho ajouté à mes recettes');
  await p.evaluate(() => closeModal());
  await p.click('#pubGrid .pcard[data-pid="p2"]'); await p.waitForSelector('.pubtitle');
  t.check((await p.textContent('#sheet .foot')).includes('Déjà dans mes recettes'), 'Tarte tatin importée avant (ancienne liste) : reconnue');
  await p.evaluate(() => closeModal());

  t.section('4. Messages');
  deLea.length = 0;
  await p.click('#pubScope [data-scope="tous"]'); await p.click('#pubScope [data-scope="amis"]'); await p.waitForFunction(() => /pas encore de recette publique/.test(document.querySelector('#pubInfo').textContent));
  t.check(true, 'amis sans recette publique : « Tes amis n’ont pas encore de recette publique »');
  amisList = [];
  await p.evaluate(() => friends.load(true));
  await p.click('#pubScope [data-scope="tous"]'); await p.click('#pubScope [data-scope="amis"]'); await p.waitForFunction(() => /pas encore d’amis/.test(document.querySelector('#pubInfo').textContent));
  t.check(true, 'sans ami : « Tu n’as pas encore d’amis »');
  await p.click('#acctBtn'); await p.click('#acctMenu [data-act="friends"]'); await p.waitForSelector('#frBody');
  t.check((await p.textContent('#sheet')).includes('tes recettes publiques'), 'fenêtre Amis : « tes amis voient tes recettes publiques »');

  t.check(app.errs.length === 0, 'aucune erreur JS ' + app.errs.join(' | '));
  await app.close(); t.done();
})().catch(e => { console.error(e); process.exit(1); });
