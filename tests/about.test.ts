import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = join(__dirname, '..');

test('package.json names the author the About box shows', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.author, { name: 'JamGobbar', email: 'shapeforge.software@gmail.com' });
});

test('the page has the logo where the build puts it, and an About box', () => {
  const html = readFileSync(join(root, 'src/renderer/index.html'), 'utf8');
  assert.equal(html.split('<!--LOGO-->').length - 1, 2, 'the ribbon and the About box');
  for (const id of ['about', 'about-dialog', 'about-version', 'about-author', 'about-email', 'about-source', 'about-close', 'brand-logo']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  const svg = readFileSync(join(root, 'src/renderer/logo.svg'), 'utf8');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 64 64">/);
});

test('the Windows icon has every size Windows asks for', () => {
  const ico = readFileSync(join(root, 'build/icon.ico'));
  assert.equal(ico.readUInt16LE(2), 1, 'an icon file');
  const count = ico.readUInt16LE(4);
  const sizes = Array.from({ length: count }, (_, n) => ico[6 + n * 16] || 256).sort((a, b) => a - b);
  assert.deepEqual(sizes, [16, 20, 24, 32, 40, 48, 64, 128, 256]);
});

test('package.json gives the licence and where the source is', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.license, 'GPL-3.0-or-later');
  assert.equal(pkg.homepage, 'https://github.com/Shapeforge-software/shapeforge');
  assert.match(readFileSync(join(root, 'LICENSE'), 'utf8'), /GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/);
});
