import JSZip from 'jszip';
import Papa from 'papaparse';
import {
  BoardElement,
  BoardElementType,
  BoardPhaseConfig,
  CableWaypoint,
  ElectricalPoint,
  ElementStatus,
  OpeningType,
  PhaseCode,
  PhaseFilter,
  PointCategory,
  PointPosition3D,
  RoomOpening,
  RoomZone,
  SceneConfig,
  WallSide,
} from '../../types/room3d';
import { ensureRoomBuildings, getBuildingSummaries } from '../../utils/buildings';

const LOCAL_STORAGE_KEY = 'voltplan3d_step1_project_v1';

export interface StoredProject {
  rooms: RoomZone[];
  openings: RoomOpening[];
  points: ElectricalPoint[];
  pointPositions: Record<string, PointPosition3D>;
  boardElements: BoardElement[];
  panelPositions: Record<string, PointPosition3D>;
  cableRoutes: Record<string, CableWaypoint[]>;
  sceneConfig: SceneConfig;
}

export interface ZipImportResult {
  rooms: RoomZone[];
  openings: RoomOpening[];
  points: ElectricalPoint[];
  pointPositions: Record<string, PointPosition3D>;
  boardElements: BoardElement[];
  panelPositions: Record<string, PointPosition3D>;
  cableRoutes: Record<string, CableWaypoint[]>;
  sceneConfig: Partial<SceneConfig>;
  warnings: string[];
}

function cleanStr(val: unknown, fallback = ''): string {
  if (val === null || val === undefined) return fallback;
  return String(val).trim();
}

function parseNum(val: unknown, fallback: number): number {
  if (val === null || val === undefined || String(val).trim() === '') return fallback;
  const n = Number(String(val).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function parseNullableNum(val: unknown): number | null {
  if (val === null || val === undefined || String(val).trim() === '') return null;
  const n = Number(String(val).trim().replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeCategory(raw: unknown): PointCategory {
  const s = cleanStr(raw).toLowerCase();
  if (s === 'lumiere' || s === 'lumière') return 'lumiere';
  if (s === 'equipement_fixe' || s === 'équipement fixe' || s === 'equipement') {
    return 'equipement_fixe';
  }
  if (s === 'rallonge_multiprise' || s === 'multiprise' || s === 'rallonge') {
    return 'rallonge_multiprise';
  }
  return 'prise';
}

function normalizePhase(raw: unknown): PhaseCode {
  const s = cleanStr(raw).toUpperCase();
  if (s === 'L1' || s === 'L2' || s === 'L3') return s;
  return 'INCONNU';
}

function normalizeStatus(raw: unknown): ElementStatus {
  return cleanStr(raw).toLowerCase() === 'projete' ? 'projete' : 'existant';
}

function normalizeBoardType(raw: unknown): BoardElementType {
  const s = cleanStr(raw).toLowerCase();
  return s === 'boitier' || s === 'tableau' || s === 'coffret' ? 'boitier' : 'disjoncteur';
}

function normalizeBoardPhases(raw: unknown): BoardPhaseConfig {
  const s = cleanStr(raw).toUpperCase().replace(/\s+/g, '');
  if (
    s === 'L1' ||
    s === 'L2' ||
    s === 'L3' ||
    s === 'L1+L2' ||
    s === 'L2+L3' ||
    s === 'L1+L3' ||
    s === 'TRI'
  ) {
    return s;
  }
  if (s === 'L1+L2+L3' || s === 'TRIPHASE') return 'TRI';
  return 'INCONNU';
}

function sanitizeOpenings(raw: unknown, rooms: RoomZone[]): RoomOpening[] {
  if (!Array.isArray(raw)) return [];
  const validZones = new Set(rooms.map((r) => r.zone_id));
  const validWalls = new Set<WallSide>(['north', 'south', 'east', 'west']);

  const out: RoomOpening[] = [];
  raw.forEach((item, idx) => {
    if (!item || typeof item !== 'object') return;
    const obj = item as Partial<RoomOpening>;
    const zoneId = cleanStr(obj.zone_id);
    if (!zoneId || !validZones.has(zoneId)) return;

    const type: OpeningType = obj.type === 'fenetre' ? 'fenetre' : 'porte';
    const wall: WallSide = validWalls.has(obj.wall as WallSide) ? (obj.wall as WallSide) : 'south';
    const width = Math.max(0.4, Math.min(6, parseNum(obj.width, type === 'porte' ? 0.9 : 1.2)));
    const height = Math.max(0.4, Math.min(4, parseNum(obj.height, type === 'porte' ? 2.05 : 1.15)));
    const sillHeight = Math.max(
      0,
      Math.min(3, parseNum(obj.sillHeight, type === 'porte' ? 0 : 1.0)),
    );
    const offset = parseNum(obj.offset, 0);

    out.push({
      opening_id: cleanStr(obj.opening_id, `OUV_${idx + 1}`),
      zone_id: zoneId,
      type,
      wall,
      offset,
      width,
      height,
      sillHeight,
    });
  });
  return out;
}

function sanitizePointPositions(
  raw: unknown,
  points: ElectricalPoint[],
  rooms: RoomZone[],
): Record<string, PointPosition3D> {
  const validWalls = new Set<WallSide>(['north', 'south', 'east', 'west']);
  const wallCycle: WallSide[] = ['north', 'east', 'south', 'west'];
  const roomMap = new Map(rooms.map((r) => [r.zone_id, r]));
  const rawMap =
    raw && typeof raw === 'object' ? (raw as Record<string, Partial<PointPosition3D>>) : {};

  const out: Record<string, PointPosition3D> = {};
  const perRoomWallFallbackCount = new Map<string, number>();
  const perRoomCeilingFallbackCount = new Map<string, number>();

  for (const pt of points) {
    const room = roomMap.get(pt.zone_id);
    const wRoom = room?.largeur ?? 4;
    const dRoom = room?.profondeur ?? 4;
    const hRoom = room?.hauteur ?? 2.6;
    const maxX = Math.max(0.15, wRoom / 2 - 0.18);
    const maxZ = Math.max(0.15, dRoom / 2 - 0.18);
    const maxY = Math.max(0.2, hRoom - 0.15);
    const existing = rawMap[pt.point_id];

    if (existing && typeof existing.x === 'number' && typeof existing.z === 'number') {
      if (pt.categorie === 'lumiere' && !validWalls.has(existing.wall as WallSide)) {
        // Lumière au plafond conservée au plafond
        out[pt.point_id] = {
          x: Number(Math.max(-maxX, Math.min(maxX, existing.x)).toFixed(2)),
          y: Number(Math.max(1.2, hRoom - 0.06).toFixed(2)),
          z: Number(Math.max(-maxZ, Math.min(maxZ, existing.z)).toFixed(2)),
        };
        continue;
      }

      let wall: WallSide;
      if (validWalls.has(existing.wall as WallSide)) {
        wall = existing.wall as WallSide;
      } else {
        // Migration depuis d'éventuels anciens placements sans mur : plaquer sur le mur le plus proche
        const dNorth = Math.abs(existing.z - -dRoom / 2);
        const dSouth = Math.abs(existing.z - dRoom / 2);
        const dWest = Math.abs(existing.x - -wRoom / 2);
        const dEast = Math.abs(existing.x - wRoom / 2);
        const minD = Math.min(dNorth, dSouth, dWest, dEast);
        wall =
          minD === dNorth
            ? 'north'
            : minD === dSouth
              ? 'south'
              : minD === dWest
                ? 'west'
                : 'east';
      }

      const clampedY = Math.max(
        0.15,
        Math.min(maxY, typeof existing.y === 'number' ? existing.y : 0.3),
      );
      out[pt.point_id] = {
        x:
          wall === 'east'
            ? Number((wRoom / 2).toFixed(2))
            : wall === 'west'
              ? Number((-wRoom / 2).toFixed(2))
              : Number(Math.max(-maxX, Math.min(maxX, existing.x)).toFixed(2)),
        y: Number(clampedY.toFixed(2)),
        z:
          wall === 'south'
            ? Number((dRoom / 2).toFixed(2))
            : wall === 'north'
              ? Number((-dRoom / 2).toFixed(2))
              : Number(Math.max(-maxZ, Math.min(maxZ, existing.z)).toFixed(2)),
        wall,
      };
    } else if (pt.categorie === 'lumiere') {
      // Lumière importée sans coordonnées 3D : centrée au plafond par défaut
      const count = perRoomCeilingFallbackCount.get(pt.zone_id) ?? 0;
      perRoomCeilingFallbackCount.set(pt.zone_id, count + 1);
      const offsetsX = [0, -0.35, 0.35, -0.35, 0.35];
      const offsetsZ = [0, -0.35, -0.35, 0.35, 0.35];
      const fx = maxX * offsetsX[count % offsetsX.length];
      const fz = maxZ * offsetsZ[count % offsetsZ.length];
      out[pt.point_id] = {
        x: Number(fx.toFixed(2)),
        y: Number(Math.max(1.2, hRoom - 0.06).toFixed(2)),
        z: Number(fz.toFixed(2)),
      };
    } else {
      // Placement automatique sur les murs pour les autres points importés sans coordonnées 3D
      const count = perRoomWallFallbackCount.get(pt.zone_id) ?? 0;
      perRoomWallFallbackCount.set(pt.zone_id, count + 1);

      const wall = wallCycle[count % wallCycle.length];
      const slotOnWall = Math.floor(count / wallCycle.length);
      const alongSpan = wall === 'north' || wall === 'south' ? maxX : maxZ;
      const offsets = [0, -0.5, 0.5, -0.8, 0.8];
      const frac = offsets[slotOnWall % offsets.length];
      const along = Number((alongSpan * frac).toFixed(2));
      const fy = pt.categorie === 'prise' || pt.categorie === 'rallonge_multiprise' ? 0.3 : 1.0;

      out[pt.point_id] = {
        x:
          wall === 'east'
            ? Number((wRoom / 2).toFixed(2))
            : wall === 'west'
              ? Number((-wRoom / 2).toFixed(2))
              : along,
        y: Number(Math.max(0.15, Math.min(maxY, fy)).toFixed(2)),
        z:
          wall === 'south'
            ? Number((dRoom / 2).toFixed(2))
            : wall === 'north'
              ? Number((-dRoom / 2).toFixed(2))
              : along,
        wall,
      };
    }
  }

  return out;
}

function sanitizePanelPositions(
  raw: unknown,
  boardElements: BoardElement[],
  rooms: RoomZone[],
): Record<string, PointPosition3D> {
  const validWalls = new Set<WallSide>(['north', 'south', 'east', 'west']);
  const wallCycle: WallSide[] = ['north', 'east', 'south', 'west'];
  const roomMap = new Map(rooms.map((r) => [r.zone_id, r]));
  const rawMap =
    raw && typeof raw === 'object' ? (raw as Record<string, Partial<PointPosition3D>>) : {};

  const out: Record<string, PointPosition3D> = {};
  const perRoomFallback = new Map<string, number>();

  for (const el of boardElements) {
    if (el.type_element !== 'boitier') continue;
    const room = roomMap.get(el.zone_id);
    const wRoom = room?.largeur ?? 4;
    const dRoom = room?.profondeur ?? 4;
    const hRoom = room?.hauteur ?? 2.6;
    const maxX = Math.max(0.25, wRoom / 2 - 0.28);
    const maxZ = Math.max(0.25, dRoom / 2 - 0.28);
    const maxY = Math.max(0.45, hRoom - 0.35);
    const existing = rawMap[el.element_id];

    if (existing && typeof existing.x === 'number' && typeof existing.z === 'number') {
      const wall: WallSide = validWalls.has(existing.wall as WallSide)
        ? (existing.wall as WallSide)
        : 'north';
      const clampedY = Math.max(0.35, Math.min(maxY, typeof existing.y === 'number' ? existing.y : 1.45));
      out[el.element_id] = {
        x:
          wall === 'east'
            ? Number((wRoom / 2).toFixed(2))
            : wall === 'west'
              ? Number((-wRoom / 2).toFixed(2))
              : Number(Math.max(-maxX, Math.min(maxX, existing.x)).toFixed(2)),
        y: Number(clampedY.toFixed(2)),
        z:
          wall === 'south'
            ? Number((dRoom / 2).toFixed(2))
            : wall === 'north'
              ? Number((-dRoom / 2).toFixed(2))
              : Number(Math.max(-maxZ, Math.min(maxZ, existing.z)).toFixed(2)),
        wall,
      };
    } else {
      const count = perRoomFallback.get(el.zone_id) ?? 0;
      perRoomFallback.set(el.zone_id, count + 1);
      const wall = wallCycle[count % wallCycle.length];
      out[el.element_id] = {
        x:
          wall === 'east'
            ? Number((wRoom / 2).toFixed(2))
            : wall === 'west'
              ? Number((-wRoom / 2).toFixed(2))
              : 0,
        y: Number(Math.min(maxY, 1.45).toFixed(2)),
        z:
          wall === 'south'
            ? Number((dRoom / 2).toFixed(2))
            : wall === 'north'
              ? Number((-dRoom / 2).toFixed(2))
              : 0,
        wall,
      };
    }
  }

  return out;
}

function sanitizeCableRoutes(
  raw: unknown,
  points: ElectricalPoint[],
  boardElements: BoardElement[],
): Record<string, CableWaypoint[]> {
  if (!raw || typeof raw !== 'object') return {};
  const validPointIds = new Set(points.map((p) => p.point_id));
  const validPanelIds = new Set(
    boardElements.filter((el) => el.type_element === 'boitier').map((el) => el.element_id),
  );
  const out: Record<string, CableWaypoint[]> = {};

  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(val) || val.length === 0) continue;
    if (key.startsWith('point:')) {
      if (!validPointIds.has(key.slice(6))) continue;
    } else if (key.startsWith('panel:')) {
      if (!validPanelIds.has(key.slice(6))) continue;
    } else {
      continue;
    }

    const wps: CableWaypoint[] = [];
    for (const item of val) {
      if (!item || typeof item !== 'object') continue;
      const w = item as Partial<CableWaypoint>;
      if (
        typeof w.x === 'number' &&
        Number.isFinite(w.x) &&
        typeof w.y === 'number' &&
        Number.isFinite(w.y) &&
        typeof w.z === 'number' &&
        Number.isFinite(w.z)
      ) {
        wps.push({
          x: Number(w.x.toFixed(2)),
          y: Number(w.y.toFixed(2)),
          z: Number(w.z.toFixed(2)),
        });
      }
    }
    if (wps.length > 0) {
      out[key] = wps;
    }
  }
  return out;
}

export function loadLocalProject(): StoredProject | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredProject>;
    if (!Array.isArray(parsed.rooms) || !parsed.sceneConfig) return null;
    const rooms = ensureRoomBuildings(parsed.rooms);
    const openings = sanitizeOpenings(
      parsed.openings ?? parsed.sceneConfig.openings,
      rooms,
    );
    const points = Array.isArray(parsed.points) ? parsed.points : [];
    const pointPositions = sanitizePointPositions(
      parsed.pointPositions ?? parsed.sceneConfig.pointPositions,
      points,
      rooms,
    );
    const boardElements = Array.isArray(parsed.boardElements) ? parsed.boardElements : [];
    const panelPositions = sanitizePanelPositions(
      parsed.panelPositions ?? parsed.sceneConfig.panelPositions,
      boardElements,
      rooms,
    );
    const cableRoutes = sanitizeCableRoutes(
      parsed.cableRoutes ?? parsed.sceneConfig.cableRoutes,
      points,
      boardElements,
    );
    return {
      rooms,
      openings,
      points,
      pointPositions,
      boardElements,
      panelPositions,
      cableRoutes,
      sceneConfig: parsed.sceneConfig,
    };
  } catch {
    return null;
  }
}

export function saveLocalProject(
  rooms: RoomZone[],
  openings: RoomOpening[],
  points: ElectricalPoint[],
  pointPositions: Record<string, PointPosition3D>,
  boardElements: BoardElement[],
  panelPositions: Record<string, PointPosition3D>,
  cableRoutes: Record<string, CableWaypoint[]>,
  sceneConfig: SceneConfig,
): void {
  try {
    localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify({
        rooms,
        openings,
        points,
        pointPositions,
        boardElements,
        panelPositions,
        cableRoutes,
        sceneConfig,
      }),
    );
  } catch {
    // Ignorer en cas de quota ou navigation privée stricte
  }
}

export function serializeRoomsToCsv(rooms: RoomZone[], scenario = 'actuel'): string {
  const fields = [
    'scenario',
    'zone_id',
    'parent_zone_id',
    'type_zone',
    'nom',
    'statut',
    'x',
    'y',
    'z',
    'largeur',
    'profondeur',
    'hauteur',
  ];

  const buildings = getBuildingSummaries(rooms);
  const buildingRows = buildings.map((b) => {
    const minX = Math.min(...b.rooms.map((r) => r.x - r.largeur / 2));
    const maxX = Math.max(...b.rooms.map((r) => r.x + r.largeur / 2));
    const minZ = Math.min(...b.rooms.map((r) => r.z - r.profondeur / 2));
    const maxZ = Math.max(...b.rooms.map((r) => r.z + r.profondeur / 2));
    const minY = Math.min(...b.rooms.map((r) => r.y));
    const maxY = Math.max(...b.rooms.map((r) => r.y + r.hauteur));
    return [
      scenario,
      b.buildingId,
      '',
      'batiment',
      b.buildingName,
      'existant',
      Number(((minX + maxX) / 2).toFixed(2)),
      Number(minY.toFixed(2)),
      Number(((minZ + maxZ) / 2).toFixed(2)),
      Number(Math.max(0.5, maxX - minX).toFixed(2)),
      Number(Math.max(0.5, maxZ - minZ).toFixed(2)),
      Number(Math.max(1.2, maxY - minY).toFixed(2)),
    ];
  });

  const roomRows = rooms.map((r) => [
    scenario,
    r.zone_id,
    r.buildingId || 'BAT_1',
    'piece',
    r.nom,
    'existant',
    r.x,
    r.y,
    r.z,
    r.largeur,
    r.profondeur,
    r.hauteur,
  ]);

  return Papa.unparse({ fields, data: [...buildingRows, ...roomRows] }, { delimiter: ',' });
}

export function parseRoomsCsv(csvText: string): RoomZone[] {
  const stripped = csvText.replace(/^\uFEFF/, '').trim();
  if (!stripped) return [];

  const parsed = Papa.parse<Record<string, string>>(stripped, {
    header: true,
    skipEmptyLines: 'greedy',
    delimitersToGuess: [',', ';', '\t'],
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const rows = (parsed.data || []).filter(
    (r) => cleanStr(r.zone_id) !== '' || cleanStr(r.nom) !== '',
  );

  const buildingNames = new Map<string, string>();
  for (const r of rows) {
    if (cleanStr(r.type_zone).toLowerCase() === 'batiment') {
      const id = cleanStr(r.zone_id);
      if (id) buildingNames.set(id, cleanStr(r.nom, id));
    }
  }

  const rooms: RoomZone[] = rows
    .filter((r) => cleanStr(r.type_zone).toLowerCase() !== 'batiment')
    .map((r, idx) => {
      const parentId = cleanStr(r.parent_zone_id);
      return {
        zone_id: cleanStr(r.zone_id, `Z_PIECE_${idx + 1}`),
        nom: cleanStr(r.nom, `Pièce ${idx + 1}`),
        buildingId: parentId || undefined,
        buildingName: parentId ? buildingNames.get(parentId) || parentId : undefined,
        x: parseNum(r.x, 0),
        y: parseNum(r.y, 0),
        z: parseNum(r.z, 0),
        largeur: Math.max(0.5, parseNum(r.largeur, 4)),
        profondeur: Math.max(0.5, parseNum(r.profondeur, 4)),
        hauteur: Math.max(1.2, parseNum(r.hauteur, 2.6)),
      };
    });

  return ensureRoomBuildings(rooms);
}

export function serializePointsToCsv(points: ElectricalPoint[]): string {
  const fields = [
    'scenario',
    'point_id',
    'nom',
    'zone_id',
    'disjoncteur_id',
    'categorie',
    'type_appareil',
    'phase_relevee',
    'puissance_est_w',
    'statut',
    'note',
  ];
  const data = points.map((p) => [
    p.scenario || 'actuel',
    p.point_id,
    p.nom,
    p.zone_id,
    p.disjoncteur_id || '',
    p.categorie,
    p.type_appareil || '',
    p.phase_relevee || 'INCONNU',
    p.puissance_est_w !== null && p.puissance_est_w !== undefined ? p.puissance_est_w : '',
    p.statut || 'existant',
    p.note || '',
  ]);
  return Papa.unparse({ fields, data }, { delimiter: ',' });
}

export function parsePointsCsv(csvText: string, validZoneIds: Set<string>): ElectricalPoint[] {
  const stripped = csvText.replace(/^\uFEFF/, '').trim();
  if (!stripped) return [];

  const parsed = Papa.parse<Record<string, string>>(stripped, {
    header: true,
    skipEmptyLines: 'greedy',
    delimitersToGuess: [',', ';', '\t'],
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const fallbackZone = Array.from(validZoneIds)[0] ?? 'Z_ATELIER';

  return (parsed.data || [])
    .filter((r) => cleanStr(r.point_id) !== '' || cleanStr(r.nom) !== '')
    .map((r, idx) => {
      const z = cleanStr(r.zone_id);
      return {
        scenario: cleanStr(r.scenario, 'actuel'),
        point_id: cleanStr(r.point_id, `PT_${String(idx + 1).padStart(3, '0')}`),
        nom: cleanStr(r.nom, `Point ${idx + 1}`),
        zone_id: validZoneIds.has(z) ? z : fallbackZone,
        disjoncteur_id: cleanStr(r.disjoncteur_id),
        categorie: normalizeCategory(r.categorie),
        type_appareil: cleanStr(r.type_appareil),
        phase_relevee: normalizePhase(r.phase_relevee),
        puissance_est_w: parseNullableNum(r.puissance_est_w),
        statut: normalizeStatus(r.statut),
        note: cleanStr(r.note),
      };
    });
}

export function serializeBoardElementsToCsv(elements: BoardElement[]): string {
  const fields = [
    'scenario',
    'element_id',
    'type_element',
    'nom',
    'zone_id',
    'parent_id',
    'phases',
    'calibre_a',
    'statut',
    'note',
  ];
  const data = elements.map((el) => [
    el.scenario || 'actuel',
    el.element_id,
    el.type_element,
    el.nom,
    el.zone_id,
    el.parent_id || '',
    el.phases || 'INCONNU',
    el.calibre_a !== null && el.calibre_a !== undefined ? el.calibre_a : '',
    el.statut || 'existant',
    el.note || '',
  ]);
  return Papa.unparse({ fields, data }, { delimiter: ',' });
}

export function parseBoardElementsCsv(
  csvText: string,
  validZoneIds: Set<string>,
): BoardElement[] {
  const stripped = csvText.replace(/^\uFEFF/, '').trim();
  if (!stripped) return [];

  const parsed = Papa.parse<Record<string, string>>(stripped, {
    header: true,
    skipEmptyLines: 'greedy',
    delimitersToGuess: [',', ';', '\t'],
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const fallbackZone = Array.from(validZoneIds)[0] ?? 'Z_ATELIER';

  return (parsed.data || [])
    .filter((r) => cleanStr(r.element_id) !== '' || cleanStr(r.nom) !== '')
    .map((r, idx) => {
      const z = cleanStr(r.zone_id);
      const type = normalizeBoardType(r.type_element);
      return {
        scenario: cleanStr(r.scenario, 'actuel'),
        element_id: cleanStr(
          r.element_id,
          type === 'boitier' ? `TB_${idx + 1}` : `DJ_${String(idx + 1).padStart(2, '0')}`,
        ),
        type_element: type,
        nom: cleanStr(r.nom, type === 'boitier' ? `Tableau ${idx + 1}` : `Disjoncteur ${idx + 1}`),
        zone_id: validZoneIds.has(z) ? z : fallbackZone,
        parent_id: cleanStr(r.parent_id),
        phases: normalizeBoardPhases(r.phases),
        calibre_a: parseNullableNum(r.calibre_a),
        statut: normalizeStatus(r.statut),
        note: cleanStr(r.note),
      };
    });
}

export async function exportScenarioToZip(
  rooms: RoomZone[],
  openings: RoomOpening[],
  points: ElectricalPoint[],
  pointPositions: Record<string, PointPosition3D>,
  boardElements: BoardElement[],
  panelPositions: Record<string, PointPosition3D>,
  cableRoutes: Record<string, CableWaypoint[]>,
  sceneConfig: SceneConfig,
): Promise<void> {
  const zip = new JSZip();

  const roomsCsv = serializeRoomsToCsv(rooms, sceneConfig.scenario || 'actuel');
  zip.file('zones.csv', '\uFEFF' + roomsCsv);

  const boardCsv = serializeBoardElementsToCsv(boardElements);
  zip.file('boitiers_disjoncteurs.csv', '\uFEFF' + boardCsv);

  const pointsCsv = serializePointsToCsv(points);
  zip.file('points_electriques.csv', '\uFEFF' + pointsCsv);

  const jsonPayload = {
    app: 'VoltPlan 3D',
    version: 4,
    exportedAt: new Date().toISOString(),
    ...sceneConfig,
    openings,
    pointPositions,
    panelPositions,
    cableRoutes,
  };
  zip.file('scene_config.json', JSON.stringify(jsonPayload, null, 2));

  const blob = await zip.generateAsync({ type: 'blob' });
  const datePart = new Date().toISOString().slice(0, 10);
  const safeScenario = (sceneConfig.scenario || 'actuel').replace(/[^a-zA-Z0-9_-]/g, '_');

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `voltplan3d_${safeScenario}_${datePart}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function importScenarioFromZip(file: File): Promise<ZipImportResult> {
  const zip = await JSZip.loadAsync(file);
  const warnings: string[] = [];

  const findEntry = (filename: string) => {
    const exact = zip.file(filename);
    if (exact) return exact;
    return (
      Object.values(zip.files).find(
        (entry) => !entry.dir && entry.name.toLowerCase().endsWith('/' + filename),
      ) ?? null
    );
  };

  const csvEntry = findEntry('zones.csv');
  if (!csvEntry) {
    throw new Error('Le fichier zones.csv est introuvable dans cette archive ZIP.');
  }

  const csvText = await csvEntry.async('string');
  const rooms = parseRoomsCsv(csvText);
  const validZoneIds = new Set(rooms.map((r) => r.zone_id));

  let boardElements: BoardElement[] = [];
  const boardEntry = findEntry('boitiers_disjoncteurs.csv');
  if (boardEntry) {
    boardElements = parseBoardElementsCsv(await boardEntry.async('string'), validZoneIds);
  }

  let points: ElectricalPoint[] = [];
  const pointsEntry = findEntry('points_electriques.csv');
  if (pointsEntry) {
    points = parsePointsCsv(await pointsEntry.async('string'), validZoneIds);
  }

  let sceneConfig: Partial<SceneConfig> = {};
  let openings: RoomOpening[] = [];
  let pointPositions: Record<string, PointPosition3D> = {};
  let panelPositions: Record<string, PointPosition3D> = {};
  let cableRoutes: Record<string, CableWaypoint[]> = {};

  const jsonEntry = findEntry('scene_config.json');
  if (jsonEntry) {
    try {
      const parsed = JSON.parse(await jsonEntry.async('string')) as Partial<SceneConfig>;
      openings = sanitizeOpenings(parsed.openings, rooms);
      pointPositions = sanitizePointPositions(parsed.pointPositions, points, rooms);
      panelPositions = sanitizePanelPositions(parsed.panelPositions, boardElements, rooms);
      cableRoutes = sanitizeCableRoutes(parsed.cableRoutes, points, boardElements);
      const validFilters = new Set<PhaseFilter>(['TOUTES', 'L1', 'L2', 'L3', 'INCONNU']);
      sceneConfig = {
        scenario: typeof parsed.scenario === 'string' ? parsed.scenario : 'actuel',
        snapStep: typeof parsed.snapStep === 'number' ? parsed.snapStep : 0.1,
        magneticSnap: typeof parsed.magneticSnap === 'boolean' ? parsed.magneticSnap : true,
        workElevation: typeof parsed.workElevation === 'number' ? parsed.workElevation : 0,
        levelFilter: parsed.levelFilter === 'active' ? 'active' : 'all',
        cutPlaneY: typeof parsed.cutPlaneY === 'number' ? parsed.cutPlaneY : null,
        selectedRoomId: typeof parsed.selectedRoomId === 'string' ? parsed.selectedRoomId : null,
        selectedOpeningId:
          typeof parsed.selectedOpeningId === 'string' ? parsed.selectedOpeningId : null,
        selectedPointId:
          typeof parsed.selectedPointId === 'string' ? parsed.selectedPointId : null,
        selectedPanelId:
          typeof parsed.selectedPanelId === 'string' ? parsed.selectedPanelId : null,
        phaseFilter: validFilters.has(parsed.phaseFilter as PhaseFilter)
          ? (parsed.phaseFilter as PhaseFilter)
          : 'TOUTES',
      };
    } catch {
      pointPositions = sanitizePointPositions({}, points, rooms);
      panelPositions = sanitizePanelPositions({}, boardElements, rooms);
      cableRoutes = {};
      warnings.push('scene_config.json invalide : réglages par défaut appliqués.');
    }
  } else {
    pointPositions = sanitizePointPositions({}, points, rooms);
    panelPositions = sanitizePanelPositions({}, boardElements, rooms);
    cableRoutes = {};
    warnings.push('scene_config.json absent : réglages de scène par défaut utilisés.');
  }

  return {
    rooms,
    openings,
    points,
    pointPositions,
    boardElements,
    panelPositions,
    cableRoutes,
    sceneConfig,
    warnings,
  };
}
