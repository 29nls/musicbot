const fs = require('node:fs');
const path = require('node:path');

const skip = new Set(['node_modules', '.git', 'dist', 'generated', 'data', 'coverage']);
const bad = [];

function isGlitch(code) {
  return (
    (code >= 0x3000 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0x0400 && code <= 0x04ff) ||
    (code >= 0x0370 && code <= 0x03ff) ||
    (code >= 0x0590 && code <= 0x05ff) ||
    (code >= 0x0600 && code <= 0x06ff) ||
    (code >= 0x3040 && code <= 0x30ff)
  );
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(file);
      continue;
    }
    if (!/\.(ts|js|json|md|prisma|sql)$/.test(entry.name)) continue;

    fs.readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        for (const ch of line) {
          if (isGlitch(ch.codePointAt(0))) {
            bad.push(`${file}:${i + 1} ${ch}`);
            break;
          }
        }
      });
  }
}

walk('.');
console.log(bad.length === 0 ? 'CLEAN' : bad.join('\n'));