import assert from 'node:assert/strict';
import { test } from 'node:test';
import { themeFromRegistry } from '../src/core/theme';

const KEY = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
const reg = (apps?: number, system?: number) =>
  `\r\n${KEY}\r\n` +
  (apps === undefined ? '' : `    AppsUseLightTheme    REG_DWORD    0x${apps}\r\n`) +
  '    EnableTransparency    REG_DWORD    0x1\r\n' +
  (system === undefined ? '' : `    SystemUsesLightTheme    REG_DWORD    0x${system}\r\n`) + '\r\n';

test('light only when Windows plainly asks for light', () => {
  assert.equal(themeFromRegistry(reg(1, 1)).theme, 'light');
  assert.equal(themeFromRegistry(reg(1)).theme, 'light');
});

test('dark when either Windows setting is dark (Custom mode)', () => {
  assert.equal(themeFromRegistry(reg(0, 0)).theme, 'dark');
  assert.equal(themeFromRegistry(reg(1, 0)).theme, 'dark');
  assert.equal(themeFromRegistry(reg(0, 1)).theme, 'dark');
  assert.match(themeFromRegistry(reg(1, 0)).detail, /Windows mode Dark, app mode Light, so dark/);
});

test('anything unclear is dark', () => {
  for (const out of [null, '', 'ERROR: The system was unable to find the specified registry key or value.', reg(undefined, 1)]) {
    assert.equal(themeFromRegistry(out).theme, 'dark');
  }
  assert.match(themeFromRegistry(null).detail, /Couldn't read/);
});
