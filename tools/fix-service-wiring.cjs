// Perbaiki kata rusak & fragmen CJK di tests/serviceWiring.test.ts
const fs = require('node:fs');

const file = 'tests/serviceWiring.test.ts';
let t = fs.readFileSync(file, 'utf8');

const fixes = [
  ['bisa_SERVICE musik', 'bisa\Service musik'],
  ['//_errored dimodul logging jadi pesan ini tidak boleh menyebut stack.', 'Error database dimodul logging jadi pesan ini tidak boleh menyebut stack.'],
  ['// 如果是 salah, satu aksi hanya diam-diam tidak sampai.', 'Kalau daftarnya salah, satu aksi hanya diam-diam tidak sampai.'],
];

for (const [from, to] of fixes) {
  const count = t.split(from).length - 1;
  if (count !== 1) {
    console.error(`GAGAL: "${from.slice(0, 40)}" muncul ${count} kali, harus 1`);
    process.exit(1);
  }
  t = t.split(from).join(to);
}

const cjk = [...t.matchAll(/[\u3000-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/g)];
if (cjk.length > 0) {
  console.error(`GAGAL: masih ada ${cjk.length} karakter CJK`);
  process.exit(1);
}

fs.writeFileSync(file, t);
console.log('selesai');