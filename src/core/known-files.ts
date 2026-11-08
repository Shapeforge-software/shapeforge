/**
 * The project files the user has chosen in an Open or Save dialog (or saved to), kept by the main process. The page
 * can only have a file read without a dialog (reopening last session's files) or saved over without one (Save) if
 * it's on this list: a page that somehow ran someone else's script still couldn't read or overwrite other files.
 */

/** A path as compared: Windows paths ignore case and slash direction. */
export function pathKey(path: string, windows: boolean): string {
  return windows ? path.replace(/\//g, '\\').toLowerCase() : path;
}

export class KnownFiles {
  private readonly keys = new Map<string, string>();

  constructor(
    private readonly windows: boolean,
    /** How many to keep; the oldest go first. */
    private readonly limit = 200,
  ) {}

  add(path: string): void {
    const key = pathKey(path, this.windows);
    this.keys.delete(key);
    this.keys.set(key, path);
    while (this.keys.size > this.limit) this.keys.delete(this.keys.keys().next().value as string);
  }

  has(path: string): boolean {
    return this.keys.has(pathKey(path, this.windows));
  }

  /** The paths, oldest first, for saving. */
  list(): string[] {
    return [...this.keys.values()];
  }

  /** Reads a saved list (anything that isn't a list of strings is ignored). */
  load(saved: unknown): void {
    if (!Array.isArray(saved)) return;
    for (const p of saved) if (typeof p === 'string' && p.length < 4096) this.add(p);
  }
}

/** Only project files: .shapeforge, or .json from versions 0.3 to 0.5. */
export const isProjectPath = (path: unknown): path is string =>
  typeof path === 'string' && path.length < 4096 && /\.(shapeforge|json)$/i.test(path);
