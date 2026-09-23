// Builds dist-single/mergulho-solar.html: the whole game (three.js included)
// in one self-contained HTML file with no local assets to serve.
// Pass --fragment to emit only the body content (no <html>/<head>/<body>),
// for hosts that wrap the page in their own skeleton.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const fragment = process.argv.includes('--fragment');
const html = await readFile('index.html', 'utf8');

const result = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  outdir: 'out',
  legalComments: 'none',
});
const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
const css = result.outputFiles.find((f) => f.path.endsWith('.css')).text;

const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]*>/)[0];
const body = html.match(/<!-- app:start -->([\s\S]*?)<!-- app:end -->/)[1].trim();
// Keep "</script" inside the bundle from closing the inline tag.
const safeJs = js.replace(/<\/script/gi, '<\\/script');

const inner = `${title}
${fonts}
<style>${css}</style>
${body}
<script>${safeJs}</script>
`;

const out = fragment
  ? inner
  : html
      .replace(/<link rel="stylesheet" href="https:\/\/fonts[^>]*>/, `${fonts}\n<style>${css}</style>`)
      .replace(/<script type="module" src="\/src\/main.js"><\/script>/, () => `<script>${safeJs}</script>`);

await mkdir('dist-single', { recursive: true });
const file = fragment ? 'dist-single/mergulho-solar.fragment.html' : 'dist-single/mergulho-solar.html';
await writeFile(file, out);
console.log(`${file}  ${(out.length / 1024).toFixed(0)} KB`);
