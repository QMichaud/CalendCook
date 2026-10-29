/* Photos : pivoter de 90° et recadrer (recette et profil) */
const fs = require('fs');
const { suite, openApp, fixture, R } = require('./lib/app');
const t = suite('Photos : pivoter et recadrer');

(async () => {
  const old = { f: '46616d696c6c65/a-1.webp', t: '46616d696c6c65/a-1-t.webp' };
  const app = await openApp({ device: 'iPhone 13', cloud: {}, data: { recipes: [R('a', 'Tarte', ['Pomme'], { photo: old })], plan: {}, shopping: [], eaters: [] } });
  const { p, db } = app;
  db.store.set(old.f, fs.readFileSync(fixture('photo.jpg'))); db.store.set(old.t, fs.readFileSync(fixture('photo.jpg')));
  const prevSize = sel => p.$eval(sel, i => new Promise(ok => { const go = () => ok([i.naturalWidth, i.naturalHeight]); i.complete && i.naturalWidth ? go() : i.onload = go; }));
  const frame = () => p.$eval('.phed-crop', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const img = () => p.$eval('.phed-img', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const drawn = pg => pg.waitForFunction(() => { const b = document.querySelector('.phed-img'); return b && b.style.width; });   // photo dessinée
  const openEd = async sel => { await p.click(sel); await drawn(p); };
  const drag = async (x1, y1, x2, y2) => { await p.mouse.move(x1, y1); await p.mouse.down(); await p.mouse.move(x2, y2, { steps: 8 }); await p.mouse.up(); };

  t.section('1. Calcul (pixel par pixel)');
  const px = await p.evaluate(() => {
    /* image 4 × 2 : rouge en haut à gauche, bleu en bas à droite */
    const c = document.createElement('canvas'); c.width = 4; c.height = 2; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 4, 2); x.fillStyle = '#f00'; x.fillRect(0, 0, 1, 1); x.fillStyle = '#00f'; x.fillRect(3, 1, 1, 1);
    const at = (cv, i, j) => { const d = cv.getContext('2d').getImageData(i, j, 1, 1).data; return d[0] > 200 && d[2] < 50 ? 'R' : d[2] > 200 && d[0] < 50 ? 'B' : '.'; };
    const grid = cv => Array.from({ length: cv.height }, (_, j) => Array.from({ length: cv.width }, (_, i) => at(cv, i, j)).join('')).join('/');
    return { droite: grid(applyEdit(c, { rot: 1 })), gauche: grid(applyEdit(c, { rot: -1 })), demi: grid(applyEdit(c, { rot: 2 })),
      coupe: grid(applyEdit(c, { rot: 0, crop: { x: .5, y: 0, w: .5, h: 1 } })), coupeTournee: grid(applyEdit(c, { rot: 1, crop: { x: 0, y: .5, w: 1, h: .5 } })) };
  });
  t.check(px.droite === '.R/../../B.', '⟳ 90° : le haut gauche passe en haut à droite (' + px.droite + ')');
  t.check(px.gauche === '.B/../../R.', '⟲ 90° : le haut gauche passe en bas à gauche (' + px.gauche + ')');
  t.check(px.demi === 'B.../...R', '2 × 90° : retournée');
  t.check(px.coupe === '../.B' && px.coupeTournee === '../B.', 'recadrage (aussi après rotation)');

  t.section('2. Nouvelle photo de recette');
  await app.tab('rec'); await p.click('#newRec'); await p.waitForSelector('#phPick');
  t.check(await p.isHidden('#phEdit'), 'sans photo : pas de bouton « Ajuster »');
  await p.setInputFiles('#phFile', fixture('photo.jpg')); await p.waitForSelector('#phPrev img[src^="blob:"]');
  const [w0, h0] = await prevSize('#phPrev img');
  t.check(await p.isVisible('#phEdit') && w0 === 1200 && h0 === 900, 'photo choisie (1200 × 900), bouton « ✂️ Ajuster »');
  await openEd('#phEdit');
  let f = await frame(), im = await img();
  t.check(Math.abs(f.w - im.w) < 2 && Math.abs(f.h - im.h) < 2 && im.w > im.h, 'fenêtre « Ajuster la photo » : cadre sur toute la photo');
  await app.shot('photo-ajuster');
  await p.click('.phed [data-ok]');
  t.check(!(await p.$('.phed')) && (await prevSize('#phPrev img'))[0] === 1200, 'Valider sans rien changer : photo identique');
  await openEd('#phEdit'); await p.click('.phed [data-rot="1"]');
  im = await img();
  t.check(im.h > im.w, '⟳ 90° : la photo passe en hauteur');
  await p.click('.phed [data-ok]'); await p.waitForFunction(() => !document.querySelector('.phed'));
  await p.waitForFunction(() => { const i = document.querySelector('#phPrev img'); return i && i.naturalHeight > i.naturalWidth; });
  t.check(JSON.stringify(await prevSize('#phPrev img')) === '[900,1200]', 'aperçu : 900 × 1200');
  await openEd('#phEdit');
  t.check((await img()).h > (await img()).w, 'en rouvrant : la rotation est gardée');
  f = await frame(); im = await img();
  await drag(f.x + f.w - 3, f.y + f.h - 3, f.x + f.w / 2, f.y + f.h / 2);            // coin bas droit vers le centre
  const f2 = await frame();
  t.check(Math.abs(f2.w - f.w / 2) < 6 && Math.abs(f2.h - f.h / 2) < 6 && Math.abs(f2.x - f.x) < 2, 'coin bas droit glissé : cadre réduit de moitié');
  const vp = p.viewportSize();
  await drag(f2.x + f2.w / 2, f2.y + f2.h / 2, vp.width - 2, vp.height - 2);                            // tiré vers le coin de l'écran, au-delà de la photo
  const f3 = await frame(); im = await img();
  t.check(Math.abs(f3.x + f3.w - (im.x + im.w)) < 2 && Math.abs(f3.y + f3.h - (im.y + im.h)) < 2 && Math.abs(f3.w - f2.w) < 1, 'cadre déplacé : il reste dans la photo');
  await p.click('.phed [data-rot="-1"]');
  t.check((await img()).w > (await img()).h && Math.abs((await frame()).w - (await img()).w) < 2, '⟲ 90° : retour à l’horizontale, cadre remis sur toute la photo');
  await p.click('.phed [data-rot="1"]');
  f = await frame(); await drag(f.x + 3, f.y + 3, f.x + f.w / 2, f.y + f.h / 2);   // coin haut gauche : quart bas droit
  await p.click('.phed [data-ok]');
  await p.waitForFunction(() => { const i = document.querySelector('#phPrev img'); return i && i.naturalWidth < 700; });
  const [w4, h4] = await prevSize('#phPrev img');
  t.check(Math.abs(w4 - 600) < 12 && Math.abs(h4 - 800) < 12, 'recadré : quart de la photo d’origine (1600 × 1200 pivotée), sans perte (' + w4 + ' × ' + h4 + ')');
  await openEd('#phEdit'); await p.click('.phed [data-no]');
  t.check(!(await p.$('.phed')) && (await prevSize('#phPrev img'))[0] === w4, '« Annuler » : rien ne change');
  await p.fill('#rName', 'Photo tournée'); await p.fill('#rDur', '10');
  await p.click('#recForm button[type=submit]'); await p.waitForFunction(() => !document.querySelector('#recForm'), null, { timeout: 15000 });
  t.check(await p.evaluate(() => { const r = state.recipes.find(x => x.name === 'Photo tournée'); return !!(r && r.photo); }), 'enregistrée avec la photo ajustée');

  t.section('3. Photo déjà enregistrée');
  await p.evaluate(() => openRecipeForm('a')); await p.waitForSelector('#phEdit');
  t.check(await p.isVisible('#phEdit'), 'bouton « ✂️ Ajuster » sur la photo existante');
  await openEd('#phEdit'); await p.click('.phed [data-ok]');
  t.check(!(await p.$('.phed')) && await p.evaluate(() => !modalGuard()), 'Valider sans rien changer : rien à enregistrer');
  await openEd('#phEdit'); await p.click('.phed [data-rot="-1"]'); await p.click('.phed [data-ok]');
  await p.waitForFunction(() => { const i = document.querySelector('#phPrev img[src^="blob:"]'); return i && i.naturalHeight > i.naturalWidth; });
  await p.click('#recForm button[type=submit]'); await p.waitForFunction(() => !document.querySelector('#recForm'), null, { timeout: 15000 });
  const ph = await p.evaluate(() => findRecipe('a').photo);
  t.check(ph && ph.f !== old.f && db.store.has(ph.f) && db.calls.some(c => c.startsWith('DELETE /storage/v1/object/photos')), 'nouvelle photo envoyée, ancienne supprimée');

  t.section('4. Photo de profil : cadre carré');
  await p.click('#acctBtn'); await p.click('#acctMenu [data-act="pseudo"]'); await p.waitForSelector('#avPick');
  t.check(await p.isHidden('#avEdit'), 'sans photo : pas de « Ajuster »');
  await p.setInputFiles('#avFile', fixture('photo.jpg')); await p.waitForSelector('#avPrev img[src^="blob:"]');
  await openEd('#avEdit');
  f = await frame(); im = await img();
  t.check(Math.abs(f.w - f.h) < 2 && Math.abs(f.h - im.h) < 2 && await p.$eval('.phed-crop', e => e.classList.contains('round')), 'cadre carré (affiché en rond), le plus grand possible');
  await drag(f.x + f.w - 3, f.y + f.h - 3, f.x + f.w - 3 - 80, f.y + f.h - 3 - 20);
  const fa = await frame();
  t.check(Math.abs(fa.w - fa.h) < 2 && fa.w < f.w, 'redimensionné : reste carré');
  await app.shot('photo-ajuster-profil');
  await p.click('.phed [data-ok]');
  await p.waitForFunction(() => !document.querySelector('.phed'));
  const [aw, ah] = await prevSize('#avPrev img');
  t.check(aw === 256 && ah === 256, 'photo de profil 256 × 256');

  t.check(app.errs.length === 0, 'aucune erreur JS ' + app.errs.join(' | '));
  await app.close();

  t.section('5. Au doigt (Android)');
  const and = await openApp({ device: 'Pixel 7', cloud: {} });
  await and.tab('rec'); await and.p.click('#newRec'); await and.p.waitForSelector('#phFile', { state: 'attached' });
  await and.p.setInputFiles('#phFile', fixture('photo.jpg')); await and.p.waitForSelector('#phPrev img[src^="blob:"]');
  await and.p.click('#phEdit'); await drawn(and.p);
  const fd = await and.p.$eval('.phed-crop', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const cdp = await and.ctx.newCDPSession(and.p), touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', fd.x + fd.w - 4, fd.y + fd.h - 4);
  for(let i = 1; i <= 8; i++) await touch('touchMove', fd.x + fd.w - 4 - i * 15, fd.y + fd.h - 4 - i * 10);
  await touch('touchEnd');
  const fe = await and.p.$eval('.phed-crop', e => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  t.check(Math.abs(fe.w - (fd.w - 120)) < 6 && Math.abs(fe.h - (fd.h - 80)) < 6 && await and.p.isVisible('.phed'), 'coin glissé au doigt : cadre redimensionné, la fenêtre reste ouverte');
  await and.shot('photo-ajuster-android');
  t.check(and.errs.length === 0, 'aucune erreur JS ' + and.errs.join(' | '));
  await and.close(); t.done();
})().catch(e => { console.error(e); process.exit(1); });
