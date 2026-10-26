/* Apparence : couleur des boutons (post-it) et du fond, gardées sur l'appareil */
const { suite, openApp } = require('./lib/app');
const t = suite('Apparence');

(async () => {
  const app = await openApp({ data: { recipes: [], plan: {}, shopping: [], eaters: [] } });
  const { p } = app;
  const look = () => p.evaluate(() => {
    const cs = e => getComputedStyle(document.querySelector(e));
    return { btn: cs('#addItem').backgroundImage, bar: cs('#weekBar').backgroundColor, paper: cs('body').getPropertyValue('--paper').trim(),
      html: Object.assign({}, document.documentElement.dataset) };
  });
  /* sans compte : « 🎨 Apparence » sous l'écran de connexion */
  const openLook = async () => { await p.click('#acctBtn'); await p.click('#sheet [data-act="look"]'); await p.waitForSelector('.lookbtns'); };
  const l0 = await look();
  t.check(l0.btn.includes('rgb(214, 230, 251)') && l0.paper === '#F5DFCD' && !l0.html.btn && !l0.html.bg, 'par défaut : boutons bleu ciel, fond pêche');

  await openLook();
  t.check(await p.$$eval('.lookbtn', e => e.length) === 3 && await p.$$eval('.lookbg', e => e.length) === 6, '3 couleurs de boutons, 6 fonds');
  t.check(await p.$eval('.lookbtn.on', e => e.dataset.v) === 'ciel' && await p.$eval('.lookbg.on', e => e.dataset.v) === 'peche', 'choix actuel coché');
  await p.click('.lookbtn[data-v="rose"]'); await p.click('.lookbg[data-v="lavande"]');
  const l1 = await look();
  t.check(l1.btn.includes('rgb(255, 211, 220)') && l1.html.btn === 'rose', 'rose : boutons changés tout de suite');
  t.check(l1.bar === 'rgb(251, 229, 234)', 'barre des semaines de la même couleur');
  t.check(l1.paper === '#E6E0F1', 'fond lavande');
  t.check(await p.$eval('.lookbtn.on', e => e.dataset.v) === 'rose' && await p.$$eval('.lookbtn[aria-pressed="true"]', e => e.length) === 1, 'un seul choix coché');
  await app.shot('apparence');
  await p.click('#sheet [data-act="closemodal"]');

  await p.reload(); await p.waitForTimeout(300);
  const l2 = await look();
  t.check(l2.html.btn === 'rose' && l2.html.bg === 'lavande' && l2.paper === '#E6E0F1', 'gardé après rechargement');
  await openLook();
  await p.click('.lookbtn[data-v="menthe"]'); await p.click('.lookbg[data-v="peche"]');
  const l3 = await look();
  t.check(l3.btn.includes('rgb(207, 239, 217)') && l3.html.btn === 'menthe' && !l3.html.bg && l3.paper === '#F5DFCD', 'vert menthe, retour au fond pêche');
  t.check(await p.evaluate(() => JSON.parse(localStorage.getItem('mesrecettes.look')).btn === 'menthe'), 'choix enregistré sur l’appareil (pas dans les données du foyer)');
  t.check(await p.evaluate(() => !('look' in state)), 'rien dans les données partagées');

  t.check(app.errs.length === 0, 'aucune erreur JS ' + app.errs.join(' | '));
  await app.close(); t.done();
})().catch(e => { console.error(e); process.exit(1); });
