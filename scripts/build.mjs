import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const src = path.resolve('src');
const seen = new Set();
const modules = [];
const importPattern = /import\s+(?:[\s\S]*?)\s+from\s+['"](.+?)['"];?\s*/g;

async function collect(file) {
  const absolute = path.resolve(file);
  if (seen.has(absolute)) return;
  seen.add(absolute);
  const source = await readFile(absolute, 'utf8');
  const dependencies = [...source.matchAll(importPattern)].map((match) => path.resolve(path.dirname(absolute), match[1]));
  for (const dependency of dependencies) await collect(dependency);
  modules.push(source.replace(importPattern, '').replace(/^export\s+/gm, ''));
}

await collect(path.join(src, 'app.js'));
const [template, css] = await Promise.all([readFile(path.join(src, 'index.html'), 'utf8'), readFile(path.join(src, 'styles.css'), 'utf8')]);
let bundledJavaScript = modules.join('\n');
const audioDirectory = path.join(src, 'assets', 'audio');
for (const fileName of await readdir(audioDirectory)) {
  const audio = await readFile(path.join(audioDirectory, fileName));
  bundledJavaScript = bundledJavaScript.replaceAll(`./assets/audio/${fileName}`, `data:audio/wav;base64,${audio.toString('base64')}`);
}
const html = template
  .replace('<link rel="stylesheet" href="./styles.css">', `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="./app.js"></script>', `<script type="module">\n${bundledJavaScript}\n</script>`);
await mkdir('dist', { recursive: true });
await writeFile(path.join('dist', 'index.html'), html, 'utf8');
console.log(`Built dist/index.html (${Math.round(Buffer.byteLength(html) / 1024)} KB)`);
