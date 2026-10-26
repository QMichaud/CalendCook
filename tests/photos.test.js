/* Photos : Android (appareil photo / galerie), iPhone (un seul bouton), HEIC, fichiers illisibles, photo de profil */
const fs = require('fs');
const { suite, openApp, fixture, heicLib } = require('./lib/app');
const t = suite('Photos');
const HEIC = fs.readFileSync(fixture('photo.heic'));

(async () => {
  if(!heicLib()) console.log('  (heic2any absent : lance « npm install » dans tests/ pour tester la conversion HEIC)');

  t.section('1. Android : appareil photo ou galerie');
  let app = await openApp({ device: 'Pixel 7', cloud: {} });
  let { p, db } = app;
  await app.tab('rec'); await p.click('#newRec'); await p.waitForSelector('#phCamBtn');
  t.check(await p.textContent('#phCamBtn') === '📷 Appareil photo' && await p.textContent('#phPick') === '🖼 Galerie', 'boutons « 📷 Appareil photo » et « 🖼 Galerie »');
  t.check(await p.getAttribute('#phCam', 'capture') === 'environment' && await p.getAttribute('#phFile', 'capture') === null && await p.getAttribute('#phFile', 'accept') === 'image/*', 'appareil photo : prise directe ; galerie : choix libre');
  await app.shot('photo-android');
  await p.setInputFiles('#phCam', fixture('photo.jpg')); await p.waitForSelector('#phPrev img[src^="blob:"]');
  t.check(await p.isVisible('#phDel') && (await p.textContent('#phErr')) === '' && (await p.textContent('#phMsg')) === '', 'photo prise : aperçu, aucun message');
  await p.setInputFiles('#phFile', { name: 'vide.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(0) });
  await p.waitForFunction(() => document.querySelector('#phErr').textContent.length > 0);
  t.check((await p.textContent('#phErr')).includes('Photo vide ou inaccessible'), 'photo vide : message clair');
  if(heicLib()){
    await p.setInputFiles('#phFile', { name: 'IMG_1234.HEIC', mimeType: 'image/heic', buffer: HEIC });
    t.check(await p.waitForFunction(() => document.querySelector('#phMsg').textContent.includes('HEIC'), null, { timeout: 5000 }).then(() => true, () => false), 'HEIC : « ⏳ Conversion de la photo (format HEIC)… »');
    await p.waitForFunction(() => document.querySelector('#phMsg').textContent === '' && !document.querySelector('#phErr').textContent, null, { timeout: 20000 });
    t.check(await p.$eval('#phPrev img', i => i.naturalWidth > 0), 'HEIC converti : aperçu affiché, erreur précédente effacée');
  }
  await p.fill('#rName', 'Frittata'); await p.fill('#rDur', '30');
  await p.click('#recForm button[type=submit]'); await p.waitForFunction(() => !document.querySelector('#recForm'), null, { timeout: 15000 });
  const rec = await p.evaluate(() => state.recipes.find(r => r.name === 'Frittata'));
  t.check(rec && rec.photo && db.calls.filter(c => c.startsWith('POST /storage/v1/object/photos')).length === 2, 'enregistrée : photo et miniature envoyées');

  t.section('2. Fichiers illisibles');
  app.ctl.heicOffline = true;
  await p.evaluate(() => { delete window.heic2any; openRecipeForm(null); }); await p.waitForSelector('#phFile', { state: 'attached' });
  await p.setInputFiles('#phFile', { name: 'b.heic', mimeType: '', buffer: HEIC });         // type inconnu : reconnu à son contenu
  await p.waitForFunction(() => document.querySelector('#phErr').textContent.length > 0, null, { timeout: 15000 });
  t.check((await p.textContent('#phErr')).includes('format HEIC') && (await p.textContent('#phErr')).includes('connexion'), 'HEIC sans connexion : message explicite');
  await p.setInputFiles('#phFile', { name: 'texte.txt', mimeType: 'text/plain', buffer: Buffer.from('bonjour') });
  t.check(await p.waitForFunction(() => document.querySelector('#phErr').textContent.includes('pas une image')).then(() => true, () => false), 'fichier qui n’est pas une image : message');
  await p.evaluate(() => closeModal());

  t.section('3. Android : photo de profil');
  await p.click('#acctBtn'); await p.click('#acctMenu [data-act="pseudo"]'); await p.waitForSelector('#avCamBtn');
  t.check(await p.getAttribute('#avCam', 'capture') === 'user' && await p.textContent('#avPick') === '🖼 Galerie', 'profil : appareil photo (selfie) et galerie');
  app.ctl.heicOffline = false; await p.evaluate(() => { delete window.heic2any; });
  const avFile = heicLib() ? { name: 'moi.heic', mimeType: 'image/heic', buffer: HEIC } : fixture('photo.jpg');
  await p.setInputFiles('#avFile', avFile); await p.waitForSelector('#avPrev img[src^="blob:"]', { timeout: 20000 });
  t.check((await p.textContent('#psErr')) === '', 'profil : photo acceptée' + (heicLib() ? ' (HEIC)' : ''));
  t.check(app.errs.length === 0, 'aucune erreur JS ' + app.errs.join(' | '));
  await app.close();

  t.section('4. iPhone : un seul bouton, comme avant');
  app = await openApp({ device: 'iPhone 13', cloud: {} }); ({ p } = app);
  await app.tab('rec'); await p.click('#newRec'); await p.waitForSelector('#phPick');
  t.check(await p.textContent('#phPick') === '📷 Ajouter une photo' && !(await p.$('#phCamBtn')) && !(await p.$('#phCam')), 'recette : un seul bouton « 📷 Ajouter une photo »');
  await app.shot('photo-iphone');
  await p.setInputFiles('#phFile', heicLib() ? { name: 'IMG.HEIC', mimeType: 'image/heic', buffer: HEIC } : fixture('photo.jpg'));
  await p.waitForSelector('#phPrev img[src^="blob:"]', { timeout: 20000 });
  t.check(await p.textContent('#phPick') === '📷 Changer la photo', 'photo acceptée, bouton « Changer la photo »');
  await p.click('#phDel');
  t.check(await p.textContent('#phPick') === '📷 Ajouter une photo', '« Retirer » : retour à « Ajouter une photo »');
  await p.evaluate(() => closeModal());
  await p.click('#acctBtn'); await p.click('#acctMenu [data-act="pseudo"]'); await p.waitForSelector('#avPick');
  t.check(await p.textContent('#avPick') === '📷 Ajouter une photo' && !(await p.$('#avCamBtn')), 'profil : un seul bouton');
  await p.setInputFiles('#avFile', fixture('photo.jpg')); await p.waitForSelector('#avPrev img[src^="blob:"]');
  t.check(await p.textContent('#avPick') === '📷 Changer la photo', 'profil : « Changer la photo »');

  t.section('5. Sans compte : pas de photo');
  await app.close();
  app = await openApp({ data: { recipes: [], plan: {}, shopping: [], eaters: [] } }); ({ p } = app);
  await app.tab('rec'); await p.click('#newRec'); await p.waitForSelector('#rName');
  t.check(!(await p.$('#phFile')), 'données sur l’appareil : pas de bouton photo');

  t.check(app.errs.length === 0, 'aucune erreur JS ' + app.errs.join(' | '));
  await app.close(); t.done();
})().catch(e => { console.error(e); process.exit(1); });
