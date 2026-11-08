/** Cell indexes must stay within +/- OFFSET (about 512 m each way at 0.5 m voxels). */
const OFFSET = 1024;
const SPAN = 2048;

export function key(i: number, j: number, k: number): number {
  return ((i + OFFSET) * SPAN + (j + OFFSET)) * SPAN + (k + OFFSET);
}

export function unkey(n: number): [number, number, number] {
  const k = (n % SPAN) - OFFSET;
  const rest = Math.floor(n / SPAN);
  const j = (rest % SPAN) - OFFSET;
  const i = Math.floor(rest / SPAN) - OFFSET;
  return [i, j, k];
}
