// Bundles the app into dist/ with esbuild: main and preload for Electron, renderer for the window.
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
// The app's version, from package.json, for the window title.
const { version, author, homepage } = JSON.parse(await readFile('package.json', 'utf8'));
// The README, shown in the app (About > Open the README) as it was for this version.
const readme = await readFile('README.md', 'utf8');
const common = {
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
  define: { __APP_VERSION__: JSON.stringify(version), __APP_AUTHOR__: JSON.stringify(author ?? {}), __APP_HOMEPAGE__: JSON.stringify(homepage ?? ''), __README__: JSON.stringify(readme) },
};

await mkdir('dist', { recursive: true });
await Promise.all([
  build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js', platform: 'node', format: 'cjs', target: 'node20', external: ['electron'] }),
  build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload.js', platform: 'node', format: 'cjs', target: 'node20', external: ['electron'] }),
  build({ ...common, entryPoints: ['src/renderer/renderer.ts'], outfile: 'dist/renderer.js', platform: 'browser', format: 'iife', target: 'chrome120', external: process.env.SF_EXTERNAL_THREE ? ['three', 'three/*'] : [] }),
]);
// The logo (src/renderer/logo.svg) goes into the page wherever it says <!--LOGO-->, as a picture for screen readers
// to skip (the text beside it names the app).
const logo = (await readFile('src/renderer/logo.svg', 'utf8'))
  .replace(/<title>[^<]*<\/title>\s*/, '')
  .replace(/<!--[\s\S]*?-->\s*/g, '')
  .replace('<svg ', '<svg class="logo" aria-hidden="true" focusable="false" ')
  .trim();
const html = await readFile('src/renderer/index.html', 'utf8');
await writeFile('dist/index.html', html.replaceAll('<!--LOGO-->', logo));
// The window and taskbar icon (made from the logo; see build/).
await copyFile('build/icon.png', 'dist/icon.png');
await copyFile('build/icon.ico', 'dist/icon.ico');
await copyFile('src/renderer/styles.css', 'dist/styles.css');
if (watch) console.log('Watch mode is not set up; rerun npm run build after changes.');
