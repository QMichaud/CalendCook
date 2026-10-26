/* Lance tous les tests (ou ceux dont le nom contient l'argument : node run.js photos)
   et affiche un résumé. Code de sortie 1 si un test échoue. */
const { spawnSync } = require('child_process'), fs = require('fs'), path = require('path');
const only = process.argv.slice(2);
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js') && (!only.length || only.some(o => f.includes(o)))).sort();
const res = [];
for(const f of files){
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', timeout: 300000 });
  process.stdout.write(r.stdout || '');
  const m = (r.stdout || '').match(/(\d+) OK, (\d+) échec/);
  res.push({ f, ok: m ? +m[1] : 0, ko: m ? +m[2] : 1, crash: r.status !== 0 && !(m && +m[2]), s: Math.round((Date.now() - t0) / 1000) });
}
console.log('\n════════ Résumé ════════');
res.forEach(r => console.log(`${r.ko || r.crash ? '✗' : '✓'} ${r.f.padEnd(26)} ${String(r.ok).padStart(3)} OK${r.ko ? ', ' + r.ko + ' échec(s)' : ''}${r.crash ? ' — arrêté sur une erreur' : ''}  (${r.s} s)`));
const ok = res.reduce((a, r) => a + r.ok, 0), ko = res.reduce((a, r) => a + r.ko, 0);
console.log(`\nTotal : ${ok} vérifications réussies, ${ko} échec(s)`);
process.exitCode = res.some(r => r.ko || r.crash) ? 1 : 0;
