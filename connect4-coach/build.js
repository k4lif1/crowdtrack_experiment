// Inline styles and scripts into one self-contained HTML file.
// usage: node connect4-coach/build.js <out.html> [--fragment]
// --fragment drops the doctype/html/head/body wrapper, for hosts that add their own.
'use strict';
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const out = process.argv[2];
const fragment = process.argv.includes('--fragment');
if (!out) {
  console.error('usage: node build.js <out.html> [--fragment]');
  process.exit(1);
}
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
let html = read('index.html');
html = html.replace('<link rel="stylesheet" href="styles.css">', () => '<style>\n' + read('styles.css') + '</style>');
for (const f of ['engine.js', 'strategy.js', 'app.js']) {
  html = html.replace('<script src="' + f + '"></script>', () => '<script>\n' + read(f).replace(/<\/script/gi, '<\\/script') + '</script>');
}
if (fragment) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
    .replace(/<meta charset[^>]*>\s*/, '')
    .replace(/<meta name="viewport"[^>]*>\s*/, '');
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  html = head.trim() + '\n' + body.trim() + '\n';
}
fs.writeFileSync(out, html);
console.log('wrote ' + out + ' (' + Math.round(html.length / 1024) + ' KB)');
