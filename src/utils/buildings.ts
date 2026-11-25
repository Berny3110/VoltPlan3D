import { RoomZone } from '../types/room3d';

export interface RoomGeometryBox {
  zone_id?: string;
  x: number;
  y: number;
  z: number;
  largeur: number;
  profondeur: number;
  hauteur: number;
}

export interface BuildingGroup {
  buildingId: string;
  buildingName: string;
  rooms: RoomZone[];
}

const WALL_SNAP_EPS = 0.08;
const FLOOR_SNAP_EPS = 0.14;
const MIN_SHARED_SPAN = 0.15;

export function areRoomsConnected(a: RoomGeometryBox, b: RoomGeometryBox): boolean {
  const aMinX = a.x - a.largeur / 2;
  const aMaxX = a.x + a.largeur / 2;
  const aMinZ = a.z - a.profondeur / 2;
  const aMaxZ = a.z + a.profondeur / 2;
  const aMinY = a.y;
  const aMaxY = a.y + a.hauteur;

  const bMinX = b.x - b.largeur / 2;
  const bMaxX = b.x + b.largeur / 2;
  const bMinZ = b.z - b.profondeur / 2;
  const bMaxZ = b.z + b.profondeur / 2;
  const bMinY = b.y;
  const bMaxY = b.y + b.hauteur;

  const overlapX = Math.min(aMaxX, bMaxX) - Math.max(aMinX, bMinX);
  const overlapZ = Math.min(aMaxZ, bMaxZ) - Math.max(aMinZ, bMinZ);
  const overlapY = Math.min(aMaxY, bMaxY) - Math.max(aMinY, bMinY);

  // 1. Empilement vertical (étage au-dessus ou en dessous avec recouvrement au sol)
  const touchesVertically =
    Math.abs(aMaxY - bMinY) <= FLOOR_SNAP_EPS || Math.abs(bMaxY - aMinY) <= FLOOR_SNAP_EPS;
  if (touchesVertically && overlapX > MIN_SHARED_SPAN && overlapZ > MIN_SHARED_SPAN) {
    return true;
  }

  // 2. Même niveau (ou chevauchement vertical partiel)
  if (overlapY <= 0.05) return false;

  // 2a. Chevauchement intérieur direct
  if (overlapX > 0.05 && overlapZ > 0.05) {
    return true;
  }

  // 2b. Mur mitoyen Nord/Sud ou Est/Ouest (aimanté bord à bord)
  const touchesXWall =
    Math.abs(aMaxX - bMinX) <= WALL_SNAP_EPS || Math.abs(bMaxX - aMinX) <= WALL_SNAP_EPS;
  if (touchesXWall && overlapZ >= MIN_SHARED_SPAN) {
    return true;
  }

  const touchesZWall =
    Math.abs(aMaxZ - bMinZ) <= WALL_SNAP_EPS || Math.abs(bMaxZ - aMinZ) <= WALL_SNAP_EPS;
  if (touchesZWall && overlapX >= MIN_SHARED_SPAN) {
    return true;
  }

  return false;
}

export function findConnectedBuilding(
  candidate: RoomGeometryBox,
  existingRooms: RoomZone[],
  excludeZoneId?: string,
): { buildingId: string; buildingName: string } | null {
  for (const r of existingRooms) {
    if (excludeZoneId && r.zone_id === excludeZoneId) continue;
    if (areRoomsConnected(candidate, r) && r.buildingId) {
      return {
        buildingId: r.buildingId,
        buildingName: r.buildingName || 'Bâtiment 1',
      };
    }
  }
  return null;
}

export function getNextBuildingMeta(rooms: RoomZone[]): {
  buildingId: string;
  buildingName: string;
} {
  const usedIds = new Set(rooms.map((r) => r.buildingId).filter(Boolean));
  const usedNames = new Set(rooms.map((r) => (r.buildingName || '').toLowerCase()).filter(Boolean));
  let idx = 1;
  while (usedIds.has(`BAT_${idx}`) || usedNames.has(`bâtiment ${idx}`)) {
    idx += 1;
  }
  return {
    buildingId: `BAT_${idx}`,
    buildingName: `Bâtiment ${idx}`,
  };
}

export function ensureRoomBuildings(rooms: RoomZone[]): RoomZone[] {
  if (rooms.length === 0) return rooms;

  // Si certaines pièces ont déjà un buildingId, normaliser les noms partagés
  const nameById = new Map<string, string>();
  for (const r of rooms) {
    if (r.buildingId && r.buildingName && !nameById.has(r.buildingId)) {
      nameById.set(r.buildingId, r.buildingName);
    }
  }

  const nextRooms: RoomZone[] = rooms.map((r) => ({ ...r }));
  const assigned = nextRooms.filter((r) => Boolean(r.buildingId));
  const unassigned = nextRooms.filter((r) => !r.buildingId);

  // Regrouper les pièces sans buildingId par composantes connexes ou les rattacher aux existantes
  if (unassigned.length > 0) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of unassigned) {
        if (r.buildingId) continue;
        const match = findConnectedBuilding(r, assigned);
        if (match) {
          r.buildingId = match.buildingId;
          r.buildingName = match.buildingName;
          assigned.push(r);
          changed = true;
        }
      }
    }

    // Composantes connexes restantes
    for (const seed of unassigned) {
      if (seed.buildingId) continue;
      const meta = getNextBuildingMeta(assigned);
      seed.buildingId = meta.buildingId;
      seed.buildingName = meta.buildingName;
      assigned.push(seed);

      const queue: RoomZone[] = [seed];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const other of unassigned) {
          if (other.buildingId) continue;
          if (areRoomsConnected(cur, other)) {
            other.buildingId = meta.buildingId;
            other.buildingName = meta.buildingName;
            assigned.push(other);
            queue.push(other);
          }
        }
      }
    }
  }

  // Remplir les noms manquants
  for (const r of nextRooms) {
    if (!r.buildingId) {
      const meta = getNextBuildingMeta(nextRooms);
      r.buildingId = meta.buildingId;
      r.buildingName = meta.buildingName;
    }
    if (!r.buildingName) {
      r.buildingName = nameById.get(r.buildingId) || 'Bâtiment 1';
    }
  }

  return nextRooms;
}

export function getBuildingSummaries(rooms: RoomZone[]): BuildingGroup[] {
  const map = new Map<string, BuildingGroup>();
  for (const r of rooms) {
    const id = r.buildingId || 'BAT_1';
    const name = r.buildingName || 'Bâtiment 1';
    const existing = map.get(id);
    if (existing) {
      existing.rooms.push(r);
    } else {
      map.set(id, { buildingId: id, buildingName: name, rooms: [r] });
    }
  }
  return Array.from(map.values());
}
