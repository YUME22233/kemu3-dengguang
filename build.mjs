import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

let html = read('src/index.html');
const css = read('src/style.css');
const core = read('src/core.js');
const app = read('src/app.js');

html = html.replace(
  '<link rel="stylesheet" href="style.css" />',
  () => '<style>\n' + css + '\n</style>'
);
html = html.replace(
  '<script src="core.js"></script>',
  () => '<script>\n' + core + '\n</script>'
);
html = html.replace(
  '<script src="app.js"></script>',
  () => '<script>\n' + app + '\n</script>'
);

if (html.includes('href="style.css"') || html.includes('src="core.js"') || html.includes('src="app.js"')) {
  throw new Error('内联失败：仍有外部资源引用');
}

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', '科目三灯光模拟考试.html');
writeFileSync(out, html, 'utf8');
console.log('built:', out, (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB');
