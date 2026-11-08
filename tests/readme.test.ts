import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The README must keep up with every version bump: its version line and a row in its version history.
test('the README names the current version and has a version history entry for it', () => {
  const { version } = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
  const readme = readFileSync(join(__dirname, '..', 'README.md'), 'utf8');
  assert.ok(readme.includes(`**Version ${version}.**`), `README's version line should say ${version}`);
  assert.ok(readme.includes(`\n| ${version} | `), `README's version history needs a row for ${version}`);
});
