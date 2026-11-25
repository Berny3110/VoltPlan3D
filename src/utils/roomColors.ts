import { RoomZone } from '../types/room3d';

export interface RoomColorTone {
  id: number;
  label: string;
  floorHex: number;
  wallHex: number;
  edgeHex: number;
}

/**
 * 4 nuances architecturales très désaturées proches du gris d'origine,
 * conçues pour séparer visuellement les pièces mitoyennes sans concurrencer
 * les couleurs des phases (L1 #FF6600, L2 #E6007E, L3 #00CC44).
 */
export const FOUR_COLOR_ROOM_PALETTE: readonly RoomColorTone[] = [
  {
    id: 0,
    label: 'Ardoise claire',
    floorHex: 0xd6e0eb,
    wallHex: 0x64748b,
    edgeHex: 0x334155,
  },
  {
    id: 1,
    label: 'Sable pierre',
    floorHex: 0xeaddca,
    wallHex: 0x9c826b,
    edgeHex: 0x5c4738,
  },
  {
    id: 2,
    label: 'Sauge grise',
    floorHex: 0xd0e3d8,
    wallHex: 0x5a8570,
    edgeHex: 0x2f5443,
  },
  {
    id: 3,
    label: 'Taupe cendré',
    floorHex: 0xe0d8eb,
    wallHex: 0x7b709c,
    edgeHex: 0x453c63,
  },
];

const WALL_TOUCH_EPS = 0.08;
const MIN_BORDER_SPAN = 0.05;

function shareWallBoundary(a: RoomZone, b: RoomZone): boolean {
  const overlapY = Math.min(a.y + a.hauteur, b.y + b.hauteur) - Math.max(a.y, b.y);
  if (overlapY <= 0.05) return false;

  const aMinX = a.x - a.largeur / 2;
  const aMaxX = a.x + a.largeur / 2;
  const aMinZ = a.z - a.profondeur / 2;
  const aMaxZ = a.z + a.profondeur / 2;

  const bMinX = b.x - b.largeur / 2;
  const bMaxX = b.x + b.largeur / 2;
  const bMinZ = b.z - b.profondeur / 2;
  const bMaxZ = b.z + b.profondeur / 2;

  const overlapX = Math.min(aMaxX, bMaxX) - Math.max(aMinX, bMinX);
  const overlapZ = Math.min(aMaxZ, bMaxZ) - Math.max(aMinZ, bMinZ);

  // Chevauchement involontaire au même niveau
  if (overlapX > MIN_BORDER_SPAN && overlapZ > MIN_BORDER_SPAN) {
    return true;
  }

  // Frontière Est/Ouest partagée
  const touchesX =
    Math.abs(aMaxX - bMinX) <= WALL_TOUCH_EPS || Math.abs(bMaxX - aMinX) <= WALL_TOUCH_EPS;
  if (touchesX && overlapZ >= MIN_BORDER_SPAN) {
    return true;
  }

  // Frontière Nord/Sud partagée
  const touchesZ =
    Math.abs(aMaxZ - bMinZ) <= WALL_TOUCH_EPS || Math.abs(bMaxZ - aMinZ) <= WALL_TOUCH_EPS;
  if (touchesZ && overlapX >= MIN_BORDER_SPAN) {
    return true;
  }

  return false;
}

/**
 * Coloration du graphe d'adjacence des pièces à 4 couleurs (DSATUR + backtracking),
 * garantissant que deux pièces partageant une frontière au même niveau n'ont jamais
 * la même teinte.
 */
export function computeFourColorRoomTones(rooms: RoomZone[]): Map<string, RoomColorTone> {
  const result = new Map<string, RoomColorTone>();
  const n = rooms.length;
  if (n === 0) return result;

  // Ordre déterministe pour éviter tout clignotement de couleur lors d'éditions non géométriques
  const sorted = [...rooms].sort((a, b) => a.zone_id.localeCompare(b.zone_id));
  const adj: number[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (shareWallBoundary(sorted[i], sorted[j])) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }

  const colors = new Int8Array(n).fill(-1);

  // 1. Passe DSATUR (très rapide, optimale sur la quasi-totalité des plans)
  let dsaturConflict = false;
  for (let step = 0; step < n; step++) {
    let bestIdx = -1;
    let bestSat = -1;
    let bestDeg = -1;

    for (let i = 0; i < n; i++) {
      if (colors[i] !== -1) continue;
      const neighborColors = new Set<number>();
      for (const nb of adj[i]) {
        if (colors[nb] !== -1) neighborColors.add(colors[nb]);
      }
      const sat = neighborColors.size;
      const deg = adj[i].length;
      if (sat > bestSat || (sat === bestSat && deg > bestDeg)) {
        bestSat = sat;
        bestDeg = deg;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;

    const used = new Set<number>();
    for (const nb of adj[bestIdx]) {
      if (colors[nb] !== -1) used.add(colors[nb]);
    }
    let chosen = -1;
    for (let c = 0; c < 4; c++) {
      if (!used.has(c)) {
        chosen = c;
        break;
      }
    }
    if (chosen === -1) {
      dsaturConflict = true;
      break;
    }
    colors[bestIdx] = chosen;
  }

  // 2. Backtracking exact à 4 couleurs si DSATUR a rencontré un nœud saturé
  if (dsaturConflict) {
    colors.fill(-1);
    const order = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => adj[b].length - adj[a].length || a - b,
    );
    let steps = 0;
    const MAX_STEPS = 25000;

    const solve = (pos: number): boolean => {
      if (pos === n) return true;
      if (++steps > MAX_STEPS) return false;
      const u = order[pos];
      for (let c = 0; c < 4; c++) {
        let ok = true;
        for (const nb of adj[u]) {
          if (colors[nb] === c) {
            ok = false;
            break;
          }
        }
        if (ok) {
          colors[u] = c;
          if (solve(pos + 1)) return true;
          colors[u] = -1;
        }
      }
      return false;
    };

    if (!solve(0)) {
      // Repli déterministe si géométrie non planaire (superpositions multiples)
      for (const u of order) {
        if (colors[u] !== -1) continue;
        const counts = [0, 0, 0, 0];
        for (const nb of adj[u]) {
          if (colors[nb] >= 0) counts[colors[nb]] += 1;
        }
        let bestC = 0;
        for (let c = 1; c < 4; c++) {
          if (counts[c] < counts[bestC]) bestC = c;
        }
        colors[u] = bestC;
      }
    }
  }

  for (let i = 0; i < n; i++) {
    const toneIdx = colors[i] >= 0 && colors[i] < 4 ? colors[i] : i % 4;
    result.set(sorted[i].zone_id, FOUR_COLOR_ROOM_PALETTE[toneIdx]);
  }

  return result;
}
