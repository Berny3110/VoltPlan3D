import { RoomZone } from '../types/room3d';

export interface LevelEntry {
  key: string;
  y: number;
  topY: number;
  shortLabel: string;
  title: string;
  roomCount: number;
}

export interface ElevationBounds {
  minY: number;
  maxY: number;
  hasMultipleLevels: boolean;
  levels: LevelEntry[];
}

const LEVEL_CLUSTER_TOLERANCE = 0.35;

/**
 * Regroupe les pièces par niveau (altitude y) pour construire les repères
 * sur l'échelle verticale de la maison (triés du plus haut au plus bas).
 */
export function computeLevelEntries(rooms: RoomZone[]): LevelEntry[] {
  if (rooms.length === 0) return [];

  const sortedRooms = [...rooms].sort((a, b) => a.y - b.y);
  const clusters: { sumY: number; maxTopY: number; count: number }[] = [];

  for (const room of sortedRooms) {
    const last = clusters[clusters.length - 1];
    const roomTop = room.y + room.hauteur;
    if (last && Math.abs(room.y - last.sumY / last.count) <= LEVEL_CLUSTER_TOLERANCE) {
      last.sumY += room.y;
      last.maxTopY = Math.max(last.maxTopY, roomTop);
      last.count += 1;
    } else {
      clusters.push({ sumY: room.y, maxTopY: roomTop, count: 1 });
    }
  }

  const groundClusterIdx = clusters.findIndex((c) => Math.abs(c.sumY / c.count) <= 0.2);

  let aboveIdx = 0;
  let belowRemaining = clusters.filter(
    (c, i) => i !== groundClusterIdx && c.sumY / c.count < -0.2,
  ).length;

  const entriesAsc: LevelEntry[] = clusters.map((c, idx) => {
    const avgY = Number((c.sumY / c.count).toFixed(2));
    const topY = Number(c.maxTopY.toFixed(2));
    let shortLabel: string;
    let longName: string;

    if (idx === groundClusterIdx) {
      shortLabel = 'RDC';
      longName = 'Rez-de-chaussée';
    } else if (avgY > 0.2) {
      aboveIdx += 1;
      shortLabel = `R+${aboveIdx}`;
      longName = `Niveau R+${aboveIdx}`;
    } else {
      shortLabel = `SS-${belowRemaining}`;
      longName = `Sous-sol SS-${belowRemaining}`;
      belowRemaining -= 1;
    }

    return {
      key: `lvl_${avgY.toFixed(2)}`,
      y: avgY,
      topY,
      shortLabel,
      title: `${longName} · ${avgY.toFixed(1)} m → ${topY.toFixed(1)} m (${c.count} pièce${c.count > 1 ? 's' : ''})`,
      roomCount: c.count,
    };
  });

  return entriesAsc.reverse();
}

/**
 * Calcule l'enveloppe verticale totale de la maison (du sol le plus bas au faîtage).
 */
export function computeElevationBounds(rooms: RoomZone[]): ElevationBounds {
  const levels = computeLevelEntries(rooms);
  if (rooms.length === 0) {
    return { minY: 0, maxY: 2.6, hasMultipleLevels: false, levels };
  }
  const minY = Number(Math.min(...rooms.map((r) => r.y)).toFixed(1));
  const maxY = Number(Math.max(...rooms.map((r) => r.y + r.hauteur)).toFixed(1));
  return {
    minY,
    maxY: Math.max(maxY, Number((minY + 0.5).toFixed(1))),
    hasMultipleLevels: levels.length >= 2,
    levels,
  };
}

/**
 * Détermine l'état d'une pièce vis-à-vis du plan de coupe horizontal à l'altitude `cutY`.
 * - 'traversed' : le plan traverse le volume [room.y, room.y + room.hauteur] -> affiché et interactif
 * - 'below'     : pièce entièrement sous le plan -> filaire léger de repère
 * - 'above'     : pièce entièrement au-dessus du plan -> masquée
 */
export function getRoomCutState(
  room: RoomZone,
  cutY: number | null,
  maxY: number,
): 'traversed' | 'below' | 'above' {
  if (cutY === null || cutY >= maxY - 0.02) {
    return 'traversed';
  }
  if (room.y > cutY + 0.02) {
    return 'above';
  }
  if (cutY >= room.y + room.hauteur - 0.02) {
    return 'below';
  }
  return 'traversed';
}
