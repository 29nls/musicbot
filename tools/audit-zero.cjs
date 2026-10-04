// Hitung ulang daftar berkas 0% dari coverage-final.json (path lengkap, tanpa
// pemotongan nama di tabel teks).
const fs = require('node:fs');
const path = require('node:path');

const raw = JSON.parse(fs.readFileSync('coverage/coverage-final.json', 'utf8'));
const cwd = process.cwd().replace(/\\/g, '/') + '/';

let st = 0, stHit = 0, br = 0, brHit = 0, fn = 0, fnHit = 0, ln = 0, lnHit = 0;
const zero = [];
const typeOnly = [];

for (const [file, cov] of Object.entries(raw)) {
  const rel = file.replace(/\\/g, '/').replace(cwd, '');
  const sKeys = Object.keys(cov.s || {});
  const bKeys = Object.keys(cov.b || {});
  const fKeys = Object.keys(cov.f || {});
  const lKeys = Object.keys(cov.statementMap || {});

  if (sKeys.length === 0) {
    typeOnly.push(rel);
    continue;
  }

  const sHit = sKeys.filter((k) => cov.s[k] > 0).length;
  st += sKeys.length; stHit += sHit;
  fn += fKeys.length; fnHit += fKeys.filter((k) => cov.f[k] > 0).length;
  ln += lKeys.length; lnHit += lKeys.filter((k) => cov.s[k] > 0).length;

  let bTotal = 0, bCovered = 0;
  for (const k of bKeys) {
    const counts = cov.b[k];
    for (const c of counts) {
      bTotal++;
      if (c > 0) bCovered++;
    }
  }
  br += bTotal; brHit += bCovered;

  if (sHit === 0) zero.push(rel);
}

const pct = (hit, total) => (total === 0 ? '100' : ((hit / total) * 100).toFixed(2));

console.log('measured files (dengan kode nyata):', Object.keys(raw).length - typeOnly.length);
console.log('type-only (0 statement, bukan gap):', typeOnly.length);
console.log('files 0% statements:', zero.length);
console.log('statements:', pct(stHit, st), '%');
console.log('branches:', pct(brHit, br), '%');
console.log('functions:', pct(fnHit, fn), '%');
console.log('lines:', pct(lnHit, ln), '%');

if (zero.length > 0) {
  const m = new Map();
  for (const f of zero) {
    const d = path.dirname(f);
    m.set(d, (m.get(d) || 0) + 1);
  }
  console.log('\n--- 0% by directory ---');
  for (const [d, n] of [...m.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${d}`);
  console.log('\n--- 0% files ---');
  zero.sort().forEach((f) => console.log('  ', f));
}