/* Import depuis un texte collé : lecture d'une ligne d'ingrédient, textes de livres de cuisine, formulaire */
const { suite, openApp, readFixture } = require('./lib/app');
const t = suite('Import depuis un texte');

/* ligne → « Nom|quantité|unité » (plusieurs ingrédients séparés par « ; ») */
const LIGNES = [
  ['200 g de lardons fumés', 'Lardon|200|g'],
  ['1 gousse d’ail', 'Ail|1|gousse'],
  ['4 œufs', 'Œuf|4|pcs'],
  ['2 à 3 tomates', 'Tomate|2|pcs'],
  ['½ cuil. à café de bicarbonate de soude', 'Bicarbonate de soude|0.5|cc'],
  ['1 ½ c. à soupe d’huile d’olive', 'Huile d’olive|1.5|cs'],
  ['1½ cuillère à café de sel', 'Sel|1.5|cc'],
  ['25 cl de lait', 'Lait|25|cl'],
  ['2 dl de crème liquide', 'Crème liquide|20|cl'],
  ['1 kg de pommes de terre', 'Pomme de terre|1|kg'],
  ['1 pincée de sel', 'Sel|1|pincee'],
  ['½ bouquet de menthe', 'Menthe|0.5|bouquet'],
  ['1 zeste de citron', 'Citron|1|zeste'],
  ['2 petits épis de maïs frais, égrenés (150 g)', 'Maïs|150|g'],
  ['1 verre de vin blanc', 'Vin blanc||'],
  ['Sel, poivre', 'Sel||;Poivre||'],
  ['sel et poivre', 'Sel||;Poivre||'],
  ['3 tomates, coupées en dés', 'Tomate|3|pcs'],
];

(async () => {
  const app = await openApp({ data: { recipes: [], plan: {}, shopping: [], eaters: [] } });
  const { p } = app;
  const parse = s => p.evaluate(s => parseIngLine(s).map(l => [l.name, l.qty, l.unit].join('|')).join(';'), s);
  const text = f => p.evaluate(s => { const d = parseRecipeText(s);
    return Object.assign(d, { lines: d.ingredients.filter(x => !txtUtensil(x)).flatMap(parseIngLine) }); }, readFixture('texte-' + f + '.txt'));
  const has = (d, s) => d.lines.some(l => [l.name, l.qty, l.unit].join('|') === s);

  t.section('1. Une ligne d’ingrédient');
  for(const [line, want] of LIGNES){ const got = await parse(line); t.check(got === want, `« ${line} » → ${got}${got === want ? '' : ' (attendu ' + want + ')'}`); }
  t.check(await p.evaluate(() => { const l = parseIngLine('1 litre de lait entier')[0]; return l.name === 'Lait' && l.ok && !l.exact; }), 'nom raccourci (« lait entier » → Lait) : à vérifier');
  t.check(await p.evaluate(() => !parseIngLine('3 bidules magiques')[0].ok), 'ingrédient inconnu : signalé');

  t.section('2. Pain de maïs (photo de livre : OCR, lignes coupées)');
  let d = await text('pain-de-mais');
  t.check(d.yield[0] === '10' && d.lines.length === 21 && d.steps.length === 5, `pour 10 parts, ${d.lines.length} ingrédients, ${d.steps.length} étapes`);
  t.check(d.steps[0].startsWith('Préchauffez le four') && d.steps[3].includes('Versez les poudres'), 'étape « I. » lue comme 1, phrase isolée rattachée à l’étape 4');
  t.check(has(d, 'Cumin|1|cs') && has(d, 'Piment de Cayenne|1|cc') && has(d, 'Maïs|150|g'), 'lignes coupées recollées (« en poudre », « de Cayenne »), poids entre parenthèses');
  t.check(d.unused.length === 3 && d.unused[0].startsWith('Parmi les plats'), 'introduction mise de côté');

  t.section('3. Salade César (ingrédients à l’italienne, quantité après le nom)');
  d = await text('caesar');
  t.check(d.yield[0] === '4' && d.lines.length === 17 && d.steps.length === 6, `pour 4, ${d.lines.length} ingrédients, ${d.steps.length} étapes`);
  t.check(has(d, 'Jambon|16|tranche') && has(d, 'Tomate cerise|16|pcs') && has(d, 'Basilic||'), '« x 16 tranches » sur la ligne suivante, « QB » sans quantité');

  t.section('4. Frittata, mini-frittatas, halloumi');
  d = await text('frittata');
  t.check(d.lines.length === 7 && d.steps.length === 5 && has(d, 'Menthe|0.5|bouquet') && has(d, 'Crème fleurette|125|ml') && has(d, 'Œuf|8|pcs'), `frittata : ${d.lines.length} ingrédients, ${d.steps.length} étapes, ½ bouquet de menthe, œufs en pièces`);
  t.check(d.unused.some(x => /^ASTUCE/i.test(x)), 'rubrique « ASTUCES… » mise de côté');
  d = await text('mini-frittatas');
  t.check(d.lines.length === 10 && d.steps.length === 5 && d.steps[0].includes("Chemisez 8 alvéoles d'un moule"), `mini-frittatas : ${d.lines.length} ingrédients, ${d.steps.length} étapes, « 8 alvéoles d’un moule » reste dans l’étape 1`);
  t.check(d.steps.every(s => /^[A-ZÀ-Ý]/.test(s)), 'étapes « 1 Préchauffez… » sans point reconnues');
  d = await text('halloumi');
  t.check(d.lines.length === 11 && d.steps.length === 7 && has(d, 'Halloumi|250|g'), `halloumi : ${d.lines.length} ingrédients, ${d.steps.length} étapes`);
  t.check(d.steps.some(s => s.startsWith('Sauce')), 'sous-recette (« Sauce… Mélangez… ») : étape à part');

  t.section('5. Dans le formulaire');
  await app.tab('rec'); await p.click('#newRec'); await p.waitForSelector('#iuTxt', { state: 'attached' });
  t.check((await p.textContent('[data-iupane="url"]')).includes('Connecte-toi'), 'sans compte : import par lien indisponible');
  await p.click('[data-iu="txt"]');
  await p.click('#iuTxtGo');
  t.check((await p.textContent('#iuMsg')).includes('Colle d’abord'), 'texte vide : message');
  await p.fill('#iuTxt', 'Bonjour, ceci n’est pas une recette');
  await p.click('#iuTxtGo');
  t.check((await p.textContent('#iuMsg')).includes('ni ingrédient ni étape'), 'texte sans recette : message');
  await p.fill('#iuTxt', readFixture('texte-frittata.txt')); await p.click('#iuTxtGo');
  t.check((await p.textContent('#iuMsg')).startsWith('✓ Texte analysé : 7 ingrédients, 5 étapes'), await p.textContent('#iuMsg'));
  t.check(await p.$$eval('#ingWrap .ingline', e => e.length) === 7 && (await p.inputValue('#rSteps')).split('\n').length === 5, 'ingrédients et étapes remplis');
  t.check(await p.isVisible('#iuOrig') && (await p.textContent('#iuOrig summary')).includes('dans le texte') && await p.isVisible('#iuRest'), 'texte d’origine et texte non utilisé gardés');
  await app.shot('import-texte');
  await p.fill('#rName', 'Frittata'); await p.fill('#rDur', '30');
  await p.click('#recForm button[type=submit]'); await p.waitForTimeout(250);
  const saved = await p.evaluate(() => state.recipes.find(r => r.name === 'Frittata'));
  t.check(saved && saved.ingredients.length === 7 && saved.ingredients.some(i => i.name === 'Menthe' && i.unit === 'bouquet' && i.qty === 0.5), 'enregistrée : 7 ingrédients, ½ bouquet de menthe');

  t.check(app.errs.length === 0, 'aucune erreur JS ' + app.errs.join(' | '));
  await app.close(); t.done();
})().catch(e => { console.error(e); process.exit(1); });
