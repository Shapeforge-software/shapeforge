/**
 * The theme Windows asks for, from `reg query` on HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize.
 * Windows keeps two settings: the app mode (AppsUseLightTheme) and the Windows mode for the taskbar and Start
 * (SystemUsesLightTheme); "Custom" in Settings > Personalization > Colors sets them apart. ShapeForge is light only
 * when Windows plainly asks for light: the app mode is Light and the Windows mode isn't Dark. Anything else, a missing
 * value or a failed read included, is dark. (Chromium's prefers-color-scheme isn't used: it follows the app mode alone
 * and came out light on a Windows set to dark, 0.51.0 and 0.51.1.)
 */
export interface SystemTheme { theme: 'light' | 'dark'; detail: string }

const MODE = (v: number | undefined) => (v === undefined ? 'not set' : v === 1 ? 'Light' : 'Dark');

export function themeFromRegistry(output: string | null | undefined): SystemTheme {
  const read = (name: string) => {
    const m = new RegExp(`${name}\\s+REG_DWORD\\s+0x([0-9a-f]+)`, 'i').exec(output ?? '');
    return m ? parseInt(m[1], 16) : undefined;
  };
  const apps = read('AppsUseLightTheme');
  const system = read('SystemUsesLightTheme');
  if (apps === undefined && system === undefined) return { theme: 'dark', detail: "Couldn't read Windows' light/dark setting, so dark" };
  const theme = apps === 1 && system !== 0 ? 'light' : 'dark';
  return { theme, detail: `Windows mode ${MODE(system)}, app mode ${MODE(apps)}, so ${theme}` };
}
