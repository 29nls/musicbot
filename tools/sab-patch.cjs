// Pengganti pola yang andal untuk harness sabotase.
// `perl -0pi -e "s/\Q...\E/.../"` gagal diam-diam kalau polanya mengandung
// karakter khusus; ini menggantinya dengan pencarian string persis dan
// MENOLAK kalau jumlahnya bukan tepat satu.
const fs = require('node:fs');

const [file, encodedFrom, encodedTo] = process.argv.slice(2);
const from = Buffer.from(encodedFrom, 'base64').toString('utf8');
const to = Buffer.from(encodedTo, 'base64').toString('utf8');

const original = fs.readFileSync(file, 'utf8');
const count = original.split(from).length - 1;

if (count !== 1) {
  console.error(`GAGAL: pola muncul ${count} kali di ${file} (harus tepat 1)`);
  console.error(`pola: ${from.slice(0, 120)}`);
  process.exit(2);
}

fs.writeFileSync(file, original.split(from).join(to));
console.log('ok');