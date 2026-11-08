/**
 * Enshrouded block pieces (blueprintId values), from the table in EmbervaleToolkit.exe v3.4.1.
 * Names were confirmed in game. Sizes are in 0.5 m cells along x, y, z before rotation; each piece pivots on its
 * minimum corner, which is its pos in a blueprint. Roof pieces are the same sizes as their wall/ceiling twins.
 */
export interface PieceType {
  blueprintId: number;
  name: string;
  size: [number, number, number];
  flag: number;
  roof: boolean;
}

export const PIECES: PieceType[] = [
  { blueprintId: 1986896347, name: 'Single Wall Block', size: [1, 1, 1], flag: 0, roof: false },
  { blueprintId: 3137624464, name: 'Single Roof Block', size: [1, 1, 1], flag: 0, roof: true },
  { blueprintId: 280346668, name: '1m Wall Block', size: [2, 2, 2], flag: 0, roof: false },
  { blueprintId: 3828821633, name: 'Foundation', size: [4, 4, 4], flag: 1, roof: false },
  { blueprintId: 950598916, name: '4m Foundation', size: [8, 4, 8], flag: 1, roof: false },
  { blueprintId: 2492886765, name: 'Door Frame', size: [8, 1, 1], flag: 1, roof: false },
  { blueprintId: 2223732257, name: '2m Column', size: [1, 4, 1], flag: 1, roof: false },
  { blueprintId: 1337014067, name: '4m Column', size: [2, 8, 2], flag: 1, roof: false },
  { blueprintId: 3338618487, name: '2m Ceiling', size: [4, 1, 4], flag: 1, roof: false },
  { blueprintId: 81726253, name: '4m Ceiling', size: [8, 1, 8], flag: 1, roof: false },
  { blueprintId: 1774062421, name: '2m Flat Roof', size: [4, 1, 4], flag: 1, roof: true },
  { blueprintId: 4045909019, name: '4m Flat Roof', size: [8, 1, 8], flag: 1, roof: true },
  { blueprintId: 2221187965, name: 'Wall', size: [4, 4, 1], flag: 1, roof: false },
  { blueprintId: 48042626, name: 'Narrow Wall', size: [4, 8, 1], flag: 1, roof: false },
  { blueprintId: 948722226, name: 'Wide Wall', size: [8, 8, 1], flag: 1, roof: false },
];

export const PIECE_BY_ID = new Map(PIECES.map((p) => [p.blueprintId, p]));
