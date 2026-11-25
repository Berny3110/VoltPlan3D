export type WorkspaceTab = 'construction' | 'exploitation';

export type InteractionMode = 'select' | 'draw' | 'door' | 'window' | 'point' | 'panel';

export type LevelFilterMode = 'all' | 'active';

export type WallSide = 'north' | 'south' | 'east' | 'west';

export type OpeningType = 'porte' | 'fenetre';

export type PointCategory =
  | 'prise'
  | 'lumiere'
  | 'equipement_fixe'
  | 'rallonge_multiprise';

export type PhaseCode = 'L1' | 'L2' | 'L3' | 'INCONNU';

export type PhaseFilter = 'TOUTES' | PhaseCode;

export type BoardElementType = 'boitier' | 'disjoncteur';

export type BoardPhaseConfig =
  | 'L1'
  | 'L2'
  | 'L3'
  | 'L1+L2'
  | 'L2+L3'
  | 'L1+L3'
  | 'TRI'
  | 'INCONNU';

export type ElementStatus = 'existant' | 'projete';

/**
 * Palette des phases : L1 (#FF6600), L2 (#E6007E), L3 (#00CC44).
 */
export const PHASE_META: Record<
  PhaseCode,
  { label: string; shortLabel: string; hex: string; textClass: string; bgClass: string }
> = {
  L1: {
    label: 'Phase L1',
    shortLabel: 'L1',
    hex: '#FF6600',
    textClass: 'text-[#D95300]',
    bgClass: 'bg-[#FF6600]',
  },
  L2: {
    label: 'Phase L2',
    shortLabel: 'L2',
    hex: '#E6007E',
    textClass: 'text-[#C2006A]',
    bgClass: 'bg-[#E6007E]',
  },
  L3: {
    label: 'Phase L3',
    shortLabel: 'L3',
    hex: '#00CC44',
    textClass: 'text-[#009933]',
    bgClass: 'bg-[#00CC44]',
  },
  INCONNU: {
    label: 'Phase inconnue',
    shortLabel: '?',
    hex: '#64748b',
    textClass: 'text-slate-700',
    bgClass: 'bg-slate-500',
  },
};

export const BOARD_PHASE_META: Record<
  BoardPhaseConfig,
  { label: string; shortLabel: string; hex: string; textClass: string; bgClass: string }
> = {
  L1: PHASE_META.L1,
  L2: PHASE_META.L2,
  L3: PHASE_META.L3,
  'L1+L2': {
    label: 'Biphasé L1+L2',
    shortLabel: 'L1+L2',
    hex: '#4f46e5',
    textClass: 'text-indigo-700',
    bgClass: 'bg-indigo-600',
  },
  'L2+L3': {
    label: 'Biphasé L2+L3',
    shortLabel: 'L2+L3',
    hex: '#4f46e5',
    textClass: 'text-indigo-700',
    bgClass: 'bg-indigo-600',
  },
  'L1+L3': {
    label: 'Biphasé L1+L3',
    shortLabel: 'L1+L3',
    hex: '#4f46e5',
    textClass: 'text-indigo-700',
    bgClass: 'bg-indigo-600',
  },
  TRI: {
    label: 'Triphasé (L1+L2+L3)',
    shortLabel: 'TRI',
    hex: '#4f46e5',
    textClass: 'text-indigo-700',
    bgClass: 'bg-indigo-600',
  },
  INCONNU: PHASE_META.INCONNU,
};

export const POINT_CATEGORY_LABELS: Record<PointCategory, string> = {
  prise: 'Prise',
  lumiere: 'Lumière',
  equipement_fixe: 'Équipement fixe',
  rallonge_multiprise: 'Multiprise / Rallonge',
};

/**
 * Contrat minimal d'une pièce 3D, directement compatible
 * avec le fichier standard zones.csv.
 */
export interface RoomZone {
  zone_id: string;
  nom: string;
  buildingId?: string;
  buildingName?: string;
  x: number;
  y: number;
  z: number;
  largeur: number;
  profondeur: number;
  hauteur: number;
}

/**
 * Porte ou fenêtre rattachée à un mur d'une pièce pour faciliter l'orientation 3D.
 */
export interface RoomOpening {
  opening_id: string;
  zone_id: string;
  type: OpeningType;
  wall: WallSide;
  /** Décalage en mètres par rapport au centre du mur (0 = centré). */
  offset: number;
  width: number;
  height: number;
  /** Hauteur d'allège depuis le sol de la pièce (0 pour une porte, ~1.0 m pour une fenêtre). */
  sillHeight: number;
}

/**
 * Boîtier (tableau principal/secondaire) ou disjoncteur, strictement aligné
 * sur le standard boitiers_disjoncteurs.csv.
 */
export interface BoardElement {
  scenario: string;
  element_id: string;
  type_element: BoardElementType;
  nom: string;
  zone_id: string;
  parent_id: string;
  phases: BoardPhaseConfig;
  calibre_a: number | null;
  statut: ElementStatus;
  note: string;
}

/**
 * Point électrique strictement aligné sur le standard points_electriques.csv.
 */
export interface ElectricalPoint {
  scenario: string;
  point_id: string;
  nom: string;
  zone_id: string;
  disjoncteur_id: string;
  categorie: PointCategory;
  type_appareil: string;
  phase_relevee: PhaseCode;
  puissance_est_w: number | null;
  statut: ElementStatus;
  note: string;
}

/**
 * Position 3D locale par rapport au centre-sol de sa pièce (room.x, room.y, room.z),
 * sauvegardée dans scene_config.json pour conserver les CSV conformes au standard.
 */
export interface PointPosition3D {
  /** Décalage X local depuis room.x */
  x: number;
  /** Hauteur locale Y depuis room.y (0 = sol, room.hauteur = plafond) */
  y: number;
  /** Décalage Z local depuis room.z */
  z: number;
  /** Mur support si posé sur une paroi, sinon undefined (sol / plafond) */
  wall?: WallSide;
}

/**
 * Point de passage intermédiaire personnalisé (coordonnées monde 3D) pour le cheminement d'un câble.
 */
export interface CableWaypoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Configuration de la scène 3D sauvegardée dans scene_config.json.
 */
export interface SceneConfig {
  scenario: string;
  snapStep: number;
  magneticSnap: boolean;
  workElevation: number;
  levelFilter: LevelFilterMode;
  selectedRoomId: string | null;
  selectedOpeningId?: string | null;
  selectedPointId?: string | null;
  selectedPanelId?: string | null;
  phaseFilter?: PhaseFilter;
  openings?: RoomOpening[];
  pointPositions?: Record<string, PointPosition3D>;
  panelPositions?: Record<string, PointPosition3D>;
  cableRoutes?: Record<string, CableWaypoint[]>;
}
