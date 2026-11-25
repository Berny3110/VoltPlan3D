import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  AppWindow,
  ChevronDown,
  ChevronUp,
  DoorOpen,
  Hand,
  LayoutGrid,
  Lightbulb,
  PlugZap,
  RotateCcw,
  SquarePlus,
} from 'lucide-react';
import {
  BOARD_PHASE_META,
  BoardElement,
  CableWaypoint,
  ElectricalPoint,
  InteractionMode,
  LevelFilterMode,
  OpeningType,
  PHASE_META,
  PhaseCode,
  PhaseFilter,
  POINT_CATEGORY_LABELS,
  PointCategory,
  PointPosition3D,
  RoomOpening,
  RoomZone,
  WallSide,
  WorkspaceTab,
} from '../../types/room3d';
import {
  findConnectedBuilding,
  getBuildingSummaries,
  getNextBuildingMeta,
} from '../../utils/buildings';
import {
  buildOrthogonalCablePoints,
  getDefaultPanelCableWaypoints,
  getDefaultPointCableWaypoints,
  simplifyCableWaypoints,
  snapCableXZ,
  snapCableY,
} from '../../utils/cableRouting';
import {
  findParentPanelForId,
  getDirectSubPanelsOfPanel,
} from '../../utils/electrical';
import {
  computeFourColorRoomTones,
  FOUR_COLOR_ROOM_PALETTE,
  RoomColorTone,
} from '../../utils/roomColors';

export interface CircuitFocusRequest {
  nonce: number;
  targetPanelId?: string | null;
  targetBreakerId?: string | null;
  targetPointId?: string | null;
}

export interface RoomBuilder3DProps {
  rooms: RoomZone[];
  openings: RoomOpening[];
  points: ElectricalPoint[];
  pointPositions: Record<string, PointPosition3D>;
  panels?: BoardElement[];
  breakers?: BoardElement[];
  panelPositions?: Record<string, PointPosition3D>;
  cableRoutes?: Record<string, CableWaypoint[]>;
  selectedRoomId: string | null;
  selectedOpeningId: string | null;
  selectedPointId: string | null;
  selectedPanelId?: string | null;
  selectedBreakerId?: string | null;
  focusRequest?: CircuitFocusRequest | null;
  workspace?: WorkspaceTab;
  mode: InteractionMode;
  activePointCategory: PointCategory;
  activePointPhase: PhaseCode;
  phaseFilter: PhaseFilter;
  snapStep?: number;
  magneticSnap?: boolean;
  workElevation?: number;
  levelFilter?: LevelFilterMode;
  onSelectRoom: (zoneId: string | null) => void;
  onSelectOpening: (openingId: string | null) => void;
  onSelectPoint: (pointId: string | null) => void;
  onSelectPanel?: (panelId: string | null) => void;
  onCreateRoom: (room: Omit<RoomZone, 'zone_id' | 'nom'>) => void;
  onUpdateRoom: (room: RoomZone) => void;
  onRoomTransformEnd?: (zoneId: string) => void;
  onCreateOpening: (opening: Omit<RoomOpening, 'opening_id'>) => void;
  onUpdateOpening: (opening: RoomOpening) => void;
  onCreatePoint: (zoneId: string, pos: PointPosition3D) => void;
  onUpdatePointPosition: (pointId: string, pos: PointPosition3D) => void;
  onCreatePanel?: (zoneId: string, pos: PointPosition3D) => void;
  onUpdatePanelPosition?: (panelId: string, pos: PointPosition3D) => void;
  onUpdateCableRoute?: (
    routeKey: string,
    waypoints: CableWaypoint[] | null,
    withUndo?: boolean,
  ) => void;
  onActivePointCategoryChange?: (cat: PointCategory) => void;
  onActivePointPhaseChange?: (phase: PhaseCode) => void;
  onPhaseFilterChange?: (filter: PhaseFilter) => void;
  onModeChange?: (mode: InteractionMode) => void;
  onInteractionStart?: () => void;
}

interface CableRouteMeta {
  routeKey: string;
  kind: 'point' | 'panel';
  targetId: string;
  roomId: string;
  label: string;
  pOut: THREE.Vector3;
  cOut: THREE.Vector3;
  waypoints: CableWaypoint[];
  defaultWaypoints: CableWaypoint[];
  isCustom: boolean;
}

type DragAction =
  | { type: 'draw'; startX: number; startZ: number }
  | { type: 'move'; room: RoomZone; offsetX: number; offsetZ: number }
  | { type: 'resize-x+'; room: RoomZone; anchorMinX: number }
  | { type: 'resize-x-'; room: RoomZone; anchorMaxX: number }
  | { type: 'resize-z+'; room: RoomZone; anchorMinZ: number }
  | { type: 'resize-z-'; room: RoomZone; anchorMaxZ: number }
  | { type: 'resize-h'; room: RoomZone; startClientY: number; startH: number }
  | { type: 'move-opening'; opening: RoomOpening; room: RoomZone }
  | { type: 'move-point'; point: ElectricalPoint; room: RoomZone; pos: PointPosition3D }
  | { type: 'move-panel'; panel: BoardElement; room: RoomZone; pos: PointPosition3D }
  | {
      type: 'cable-corner';
      routeKey: string;
      label: string;
      startWaypoints: CableWaypoint[];
      lastWaypoints?: CableWaypoint[];
      wpIndex: number;
      fixedY: number;
      pOut: THREE.Vector3;
      cOut: THREE.Vector3;
    }
  | {
      type: 'cable-segment';
      routeKey: string;
      label: string;
      startWaypoints: CableWaypoint[];
      lastWaypoints?: CableWaypoint[];
      idxA: number;
      idxB: number;
      axis: 'x' | 'z';
      fixedY: number;
      midX: number;
      midZ: number;
      pOut: THREE.Vector3;
      cOut: THREE.Vector3;
    }
  | {
      type: 'cable-elevation';
      routeKey: string;
      label: string;
      startWaypoints: CableWaypoint[];
      lastWaypoints?: CableWaypoint[];
      startClientY: number;
      baseY: number;
      pOut: THREE.Vector3;
      cOut: THREE.Vector3;
    };

const SNAP_THRESHOLD = 0.09;

const WALL_LABELS: Record<WallSide, string> = {
  north: 'Nord',
  south: 'Sud',
  east: 'Est',
  west: 'Ouest',
};

const ALL_WALLS: WallSide[] = ['north', 'south', 'west', 'east'];

const OPPOSITE_WALL: Record<WallSide, WallSide> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

function collectOtherWallPlanes(rooms: RoomZone[], excludeId?: string): { xs: number[]; zs: number[] } {
  const xs: number[] = [];
  const zs: number[] = [];
  for (const r of rooms) {
    if (r.zone_id === excludeId) continue;
    xs.push(Number((r.x - r.largeur / 2).toFixed(3)), Number((r.x + r.largeur / 2).toFixed(3)));
    zs.push(Number((r.z - r.profondeur / 2).toFixed(3)), Number((r.z + r.profondeur / 2).toFixed(3)));
  }
  return { xs, zs };
}

function snapCoordToWalls(
  raw: number,
  wallCoords: number[],
  step: number,
  magnetic: boolean,
): { value: number; snappedTo: number | null } {
  if (magnetic && wallCoords.length > 0) {
    let bestDiff = SNAP_THRESHOLD;
    let bestVal: number | null = null;
    for (const w of wallCoords) {
      const diff = Math.abs(raw - w);
      if (diff <= bestDiff) {
        bestDiff = diff;
        bestVal = w;
      }
    }
    if (bestVal !== null) {
      return { value: bestVal, snappedTo: bestVal };
    }
  }
  return { value: Number(snap(raw, step).toFixed(3)), snappedTo: null };
}

function snapRoomMoveToWalls(
  rawCenterX: number,
  rawCenterZ: number,
  largeur: number,
  profondeur: number,
  walls: { xs: number[]; zs: number[] },
  step: number,
  magnetic: boolean,
): { x: number; z: number; guideX: number | null; guideZ: number | null } {
  let finalX = Number(snap(rawCenterX, step).toFixed(3));
  let guideX: number | null = null;
  let finalZ = Number(snap(rawCenterZ, step).toFixed(3));
  let guideZ: number | null = null;

  if (magnetic && walls.xs.length > 0) {
    const rawMinX = rawCenterX - largeur / 2;
    const rawMaxX = rawCenterX + largeur / 2;
    let bestDiffX = SNAP_THRESHOLD;
    for (const w of walls.xs) {
      const dMin = Math.abs(rawMinX - w);
      if (dMin <= bestDiffX) {
        bestDiffX = dMin;
        finalX = Number((w + largeur / 2).toFixed(3));
        guideX = w;
      }
      const dMax = Math.abs(rawMaxX - w);
      if (dMax <= bestDiffX) {
        bestDiffX = dMax;
        finalX = Number((w - largeur / 2).toFixed(3));
        guideX = w;
      }
    }
  }

  if (magnetic && walls.zs.length > 0) {
    const rawMinZ = rawCenterZ - profondeur / 2;
    const rawMaxZ = rawCenterZ + profondeur / 2;
    let bestDiffZ = SNAP_THRESHOLD;
    for (const w of walls.zs) {
      const dMin = Math.abs(rawMinZ - w);
      if (dMin <= bestDiffZ) {
        bestDiffZ = dMin;
        finalZ = Number((w + profondeur / 2).toFixed(3));
        guideZ = w;
      }
      const dMax = Math.abs(rawMaxZ - w);
      if (dMax <= bestDiffZ) {
        bestDiffZ = dMax;
        finalZ = Number((w - profondeur / 2).toFixed(3));
        guideZ = w;
      }
    }
  }

  return { x: finalX, z: finalZ, guideX, guideZ };
}

function getWallLength(room: RoomZone, wall: WallSide): number {
  return wall === 'north' || wall === 'south' ? room.largeur : room.profondeur;
}

function computeSnappedOpeningOffset(
  room: RoomZone,
  wall: WallSide,
  worldPoint: THREE.Vector3,
  openingWidth: number,
  snapStep: number,
  magnetic: boolean,
): { offset: number; centered: boolean } {
  const wallLen = getWallLength(room, wall);
  const rawOffset =
    wall === 'north' || wall === 'south' ? worldPoint.x - room.x : worldPoint.z - room.z;
  const maxOffset = Math.max(0, wallLen / 2 - Math.min(openingWidth, wallLen - 0.1) / 2);

  let next = rawOffset;
  let centered = false;
  if (magnetic && Math.abs(rawOffset) <= 0.18) {
    next = 0;
    centered = true;
  } else {
    const step = magnetic ? Math.min(snapStep, 0.25) : 0.05;
    next = snap(rawOffset, step);
    centered = Math.abs(next) < 0.01;
  }

  const clamped = Math.max(-maxOffset, Math.min(maxOffset, next));
  return { offset: Number(clamped.toFixed(2)), centered };
}

function computeSnappedOpeningSill(
  room: RoomZone,
  worldY: number,
  openingHeight: number,
  magnetic: boolean,
): number {
  const rawSill = worldY - room.y - openingHeight / 2;
  const maxSill = Math.max(0, room.hauteur - openingHeight - 0.05);
  let next = snap(rawSill, 0.1);
  if (magnetic) {
    if (Math.abs(rawSill) <= 0.15) next = 0;
    else if (Math.abs(rawSill - 1.0) <= 0.18) next = 1.0;
  }
  return Number(Math.max(0, Math.min(maxSill, next)).toFixed(2));
}

function getWallWorldPlane(room: RoomZone, wall: WallSide, targetPlane: THREE.Plane): THREE.Plane {
  if (wall === 'north') {
    return targetPlane.set(new THREE.Vector3(0, 0, 1), -(room.z - room.profondeur / 2));
  }
  if (wall === 'south') {
    return targetPlane.set(new THREE.Vector3(0, 0, 1), -(room.z + room.profondeur / 2));
  }
  if (wall === 'west') {
    return targetPlane.set(new THREE.Vector3(1, 0, 0), -(room.x - room.largeur / 2));
  }
  return targetPlane.set(new THREE.Vector3(1, 0, 0), -(room.x + room.largeur / 2));
}

function getOpeningLocalTransform(
  room: RoomZone,
  wall: WallSide,
  offset: number,
): { x: number; z: number; rotY: number } {
  if (wall === 'north') return { x: offset, z: -room.profondeur / 2, rotY: 0 };
  if (wall === 'south') return { x: offset, z: room.profondeur / 2, rotY: Math.PI };
  if (wall === 'west') return { x: -room.largeur / 2, z: offset, rotY: Math.PI / 2 };
  return { x: room.largeur / 2, z: offset, rotY: -Math.PI / 2 };
}

function computeSnappedPointOnWall(
  room: RoomZone,
  wall: WallSide,
  worldPoint: THREE.Vector3,
  category: PointCategory,
  snapStep: number,
  magnetic: boolean,
): PointPosition3D {
  const maxX = Math.max(0.15, room.largeur / 2 - 0.18);
  const maxZ = Math.max(0.15, room.profondeur / 2 - 0.18);
  const rawAlong =
    wall === 'north' || wall === 'south' ? worldPoint.x - room.x : worldPoint.z - room.z;
  const maxAlong = wall === 'north' || wall === 'south' ? maxX : maxZ;

  const hStep = magnetic ? Math.min(snapStep, 0.25) : 0.05;
  let along = snap(rawAlong, hStep);
  if (magnetic && Math.abs(rawAlong) <= 0.18) along = 0;
  along = Number(Math.max(-maxAlong, Math.min(maxAlong, along)).toFixed(2));

  const rawY = worldPoint.y - room.y;
  let y = snap(rawY, magnetic ? 0.1 : 0.05);
  if (magnetic) {
    if (
      (category === 'prise' || category === 'rallonge_multiprise') &&
      Math.abs(rawY - 0.3) <= 0.2
    ) {
      y = 0.3;
    } else if (
      (category === 'prise' || category === 'equipement_fixe') &&
      Math.abs(rawY - 1.1) <= 0.18
    ) {
      y = 1.1;
    } else if (category === 'equipement_fixe' && Math.abs(rawY - 0.3) <= 0.18) {
      y = 0.3;
    } else if (category === 'lumiere' && Math.abs(rawY - 2.0) <= 0.22) {
      y = 2.0;
    }
  }
  y = Number(Math.max(0.15, Math.min(room.hauteur - 0.15, y)).toFixed(2));

  if (wall === 'north') return { x: along, y, z: Number((-room.profondeur / 2).toFixed(2)), wall };
  if (wall === 'south') return { x: along, y, z: Number((room.profondeur / 2).toFixed(2)), wall };
  if (wall === 'west') return { x: Number((-room.largeur / 2).toFixed(2)), y, z: along, wall };
  return { x: Number((room.largeur / 2).toFixed(2)), y, z: along, wall };
}

function computeSnappedPanelOnWall(
  room: RoomZone,
  wall: WallSide,
  worldPoint: THREE.Vector3,
  snapStep: number,
  magnetic: boolean,
): PointPosition3D {
  const maxX = Math.max(0.25, room.largeur / 2 - 0.28);
  const maxZ = Math.max(0.25, room.profondeur / 2 - 0.28);
  const rawAlong =
    wall === 'north' || wall === 'south' ? worldPoint.x - room.x : worldPoint.z - room.z;
  const maxAlong = wall === 'north' || wall === 'south' ? maxX : maxZ;

  const hStep = magnetic ? Math.min(snapStep, 0.25) : 0.05;
  let along = snap(rawAlong, hStep);
  if (magnetic && Math.abs(rawAlong) <= 0.2) along = 0;
  along = Number(Math.max(-maxAlong, Math.min(maxAlong, along)).toFixed(2));

  const rawY = worldPoint.y - room.y;
  let y = snap(rawY, magnetic ? 0.1 : 0.05);
  if (magnetic && Math.abs(rawY - 1.45) <= 0.24) {
    y = 1.45;
  }
  const minY = 0.35;
  const maxY = Math.max(minY, room.hauteur - 0.35);
  y = Number(Math.max(minY, Math.min(maxY, y)).toFixed(2));

  if (wall === 'north') return { x: along, y, z: Number((-room.profondeur / 2).toFixed(2)), wall };
  if (wall === 'south') return { x: along, y, z: Number((room.profondeur / 2).toFixed(2)), wall };
  if (wall === 'west') return { x: Number((-room.largeur / 2).toFixed(2)), y, z: along, wall };
  return { x: Number((room.largeur / 2).toFixed(2)), y, z: along, wall };
}

function panelMatchesPhaseFilter(panel: BoardElement, filter: PhaseFilter): boolean {
  if (filter === 'TOUTES') return true;
  if (panel.phases === 'TRI') return filter === 'L1' || filter === 'L2' || filter === 'L3';
  if (filter === 'INCONNU') return panel.phases === 'INCONNU';
  return panel.phases.includes(filter);
}

function getPointLocalAndNormal(
  room: RoomZone,
  point: ElectricalPoint,
  pos: PointPosition3D,
): { lx: number; ly: number; lz: number; rotY: number; isCeilingLight: boolean; normal: THREE.Vector3 } {
  const maxX = Math.max(0.15, room.largeur / 2 - 0.1);
  const maxZ = Math.max(0.15, room.profondeur / 2 - 0.1);
  const isCeilingLight = point.categorie === 'lumiere' && !pos.wall;
  const ly = isCeilingLight
    ? Math.max(1.2, room.hauteur - 0.05)
    : Math.max(0.12, Math.min(room.hauteur - 0.12, pos.y));

  let lx = Math.max(-maxX, Math.min(maxX, pos.x));
  let lz = Math.max(-maxZ, Math.min(maxZ, pos.z));
  let rotY = 0;
  const normal = new THREE.Vector3(0, -1, 0);

  if (!isCeilingLight) {
    const wall: WallSide = pos.wall ?? 'north';
    if (wall === 'north') {
      lz = -room.profondeur / 2;
      rotY = 0;
      normal.set(0, 0, 1);
    } else if (wall === 'south') {
      lz = room.profondeur / 2;
      rotY = Math.PI;
      normal.set(0, 0, -1);
    } else if (wall === 'west') {
      lx = -room.largeur / 2;
      rotY = Math.PI / 2;
      normal.set(1, 0, 0);
    } else {
      lx = room.largeur / 2;
      rotY = -Math.PI / 2;
      normal.set(-1, 0, 0);
    }
  }

  return { lx, ly, lz, rotY, isCeilingLight, normal };
}

function getPanelLocalAndNormal(
  room: RoomZone,
  pos: PointPosition3D,
): { lx: number; ly: number; lz: number; rotY: number; normal: THREE.Vector3 } {
  const maxX = Math.max(0.25, room.largeur / 2 - 0.25);
  const maxZ = Math.max(0.25, room.profondeur / 2 - 0.25);
  const ly = Math.max(0.35, Math.min(room.hauteur - 0.35, pos.y));
  const wall: WallSide = pos.wall ?? 'north';

  let lx = Math.max(-maxX, Math.min(maxX, pos.x));
  let lz = Math.max(-maxZ, Math.min(maxZ, pos.z));
  let rotY = 0;
  const normal = new THREE.Vector3(0, 0, 1);

  if (wall === 'north') {
    lz = -room.profondeur / 2;
    rotY = 0;
    normal.set(0, 0, 1);
  } else if (wall === 'south') {
    lz = room.profondeur / 2;
    rotY = Math.PI;
    normal.set(0, 0, -1);
  } else if (wall === 'west') {
    lx = -room.largeur / 2;
    rotY = Math.PI / 2;
    normal.set(1, 0, 0);
  } else {
    lx = room.largeur / 2;
    rotY = -Math.PI / 2;
    normal.set(-1, 0, 0);
  }

  return { lx, ly, lz, rotY, normal };
}

function getDefaultPanelPos(room: RoomZone): PointPosition3D {
  return {
    x: 0,
    y: Math.min(1.45, room.hauteur - 0.35),
    z: Number((-room.profondeur / 2).toFixed(2)),
    wall: 'north',
  };
}

function computeSnappedPointOnCeiling(
  room: RoomZone,
  worldPoint: THREE.Vector3,
  snapStep: number,
  magnetic: boolean,
): PointPosition3D {
  const maxX = Math.max(0.15, room.largeur / 2 - 0.25);
  const maxZ = Math.max(0.15, room.profondeur / 2 - 0.25);
  const step = magnetic ? Math.min(snapStep, 0.25) : 0.1;

  let lx = snap(worldPoint.x - room.x, step);
  let lz = snap(worldPoint.z - room.z, step);
  if (magnetic) {
    if (Math.abs(worldPoint.x - room.x) <= 0.22) lx = 0;
    if (Math.abs(worldPoint.z - room.z) <= 0.22) lz = 0;
  }

  lx = Number(Math.max(-maxX, Math.min(maxX, lx)).toFixed(2));
  lz = Number(Math.max(-maxZ, Math.min(maxZ, lz)).toFixed(2));
  const ly = Number(Math.max(1.2, room.hauteur - 0.06).toFixed(2));
  return { x: lx, y: ly, z: lz };
}

function resolveWallDragTarget(
  ray: THREE.Ray,
  room: RoomZone,
  currentWall?: WallSide,
): { wall: WallSide; point: THREE.Vector3 } | null {
  const curHit = new THREE.Vector3();
  let curPlaneOk = false;

  if (currentWall) {
    getWallWorldPlane(room, currentWall, _wallPlane);
    if (ray.intersectPlane(_wallPlane, curHit)) {
      curPlaneOk = true;
      const along =
        currentWall === 'north' || currentWall === 'south'
          ? curHit.x - room.x
          : curHit.z - room.z;
      const halfLen = getWallLength(room, currentWall) / 2;
      if (Math.abs(along) <= halfLen + 0.05) {
        return { wall: currentWall, point: curHit };
      }
    }
  }

  const candidates = currentWall
    ? ALL_WALLS.filter((w) => w !== currentWall && w !== OPPOSITE_WALL[currentWall])
    : ALL_WALLS;

  let bestWall: WallSide | null = null;
  let bestHit: THREE.Vector3 | null = null;
  let bestDistSq = Infinity;
  const candidateHit = new THREE.Vector3();

  for (const wall of candidates) {
    getWallWorldPlane(room, wall, _wallPlane);
    if (!ray.intersectPlane(_wallPlane, candidateHit)) continue;
    if (candidateHit.y < room.y - 0.15 || candidateHit.y > room.y + room.hauteur + 0.15) continue;
    const along =
      wall === 'north' || wall === 'south' ? candidateHit.x - room.x : candidateHit.z - room.z;
    const halfLen = getWallLength(room, wall) / 2;
    if (Math.abs(along) > halfLen + 0.08) continue;

    const dSq = ray.origin.distanceToSquared(candidateHit);
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestWall = wall;
      bestHit = candidateHit.clone();
    }
  }

  if (bestWall && bestHit) {
    return { wall: bestWall, point: bestHit };
  }

  if (currentWall && curPlaneOk) {
    return { wall: currentWall, point: curHit };
  }

  return null;
}

const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _wallPlane = new THREE.Plane();
const _rayHit = new THREE.Vector3();

function snap(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function detectSoftwareGl(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function disposeTree(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      const disposeMat = (m: THREE.Material) => {
        const std = m as THREE.MeshStandardMaterial & { map?: THREE.Texture | null };
        if (std.map) std.map.dispose();
        m.dispose();
      };
      if (Array.isArray(mesh.material)) mesh.material.forEach(disposeMat);
      else disposeMat(mesh.material);
    }
  });
}

function createRoomFloorLabel(room: RoomZone, maxAnisotropy: number): THREE.Mesh | null {
  if (room.largeur < 1.1 || room.profondeur < 1.1) return null;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const title = room.nom.length > 22 ? `${room.nom.slice(0, 21)}…` : room.nom;
  ctx.font = '700 44px "Plus Jakarta Sans", "DM Sans", system-ui, sans-serif';
  ctx.fillStyle = 'rgba(20, 28, 40, 0.84)';
  ctx.fillText(title, canvas.width / 2, 108, 470);

  ctx.font = '600 28px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillStyle = 'rgba(71, 85, 105, 0.85)';
  ctx.fillText(
    `${room.largeur.toFixed(1)} × ${room.profondeur.toFixed(1)} m`,
    canvas.width / 2,
    162,
    470,
  );

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;

  const maxW = Math.min(room.largeur * 0.82, 3.4);
  const maxH = Math.min(room.profondeur * 0.72, 1.7);
  const aspectW = Math.min(maxW, maxH * 2);
  const aspectH = aspectW / 2;

  const geo = new THREE.PlaneGeometry(aspectW, aspectH);
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.086;
  return mesh;
}

function nearVecWaypoint(v: THREE.Vector3, w: CableWaypoint, eps = 0.06): boolean {
  return (
    Math.abs(v.x - w.x) <= eps &&
    Math.abs(v.y - w.y) <= eps &&
    Math.abs(v.z - w.z) <= eps
  );
}

function toWaypoint(v: THREE.Vector3): CableWaypoint {
  return {
    x: Number(v.x.toFixed(2)),
    y: Number(v.y.toFixed(2)),
    z: Number(v.z.toFixed(2)),
  };
}

function resolveSegmentDragSetup(
  waypoints: CableWaypoint[],
  segA: THREE.Vector3,
  segB: THREE.Vector3,
): { workingWaypoints: CableWaypoint[]; idxA: number; idxB: number } | null {
  const working = waypoints.map((w) => ({ ...w }));
  if (working.length === 0) return null;

  for (let i = 0; i < working.length - 1; i++) {
    const a = working[i];
    const b = working[i + 1];
    if (
      (nearVecWaypoint(segA, a) && nearVecWaypoint(segB, b)) ||
      (nearVecWaypoint(segA, b) && nearVecWaypoint(segB, a))
    ) {
      return { workingWaypoints: working, idxA: i, idxB: i + 1 };
    }
  }

  // Pont orthogonal généré automatiquement avant le premier point ou après le dernier
  if (nearVecWaypoint(segB, working[0])) {
    working.unshift(toWaypoint(segA));
    return { workingWaypoints: working, idxA: 0, idxB: 1 };
  }
  if (nearVecWaypoint(segA, working[0])) {
    working.unshift(toWaypoint(segB));
    return { workingWaypoints: working, idxA: 0, idxB: 1 };
  }

  const lastIdx = working.length - 1;
  if (nearVecWaypoint(segA, working[lastIdx])) {
    working.push(toWaypoint(segB));
    return { workingWaypoints: working, idxA: lastIdx, idxB: lastIdx + 1 };
  }
  if (nearVecWaypoint(segB, working[lastIdx])) {
    working.push(toWaypoint(segA));
    return { workingWaypoints: working, idxA: lastIdx, idxB: lastIdx + 1 };
  }

  // Coin intermédiaire auto-inséré par appendOrthogonal
  for (let i = 0; i < working.length - 1; i++) {
    if (nearVecWaypoint(segA, working[i])) {
      working.splice(i + 1, 0, toWaypoint(segB));
      return { workingWaypoints: working, idxA: i, idxB: i + 1 };
    }
    if (nearVecWaypoint(segB, working[i + 1])) {
      working.splice(i + 1, 0, toWaypoint(segA));
      return { workingWaypoints: working, idxA: i + 1, idxB: i + 2 };
    }
  }

  return null;
}

function addThickCablePath(
  group: THREE.Group,
  pathPoints: THREE.Vector3[],
  colorHex: string | number,
  radius: number,
  opacity: number,
  pickMeta?: { routeKey: string; label: string },
) {
  if (pathPoints.length < 2) return;
  const transparent = opacity < 0.99;
  const mat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: opacity > 0.6 ? 0.25 : 0.08,
    roughness: 0.42,
    metalness: 0.15,
    transparent,
    opacity,
  });

  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const mid = new THREE.Vector3();

  for (let i = 0; i < pathPoints.length - 1; i++) {
    const a = pathPoints[i];
    const b = pathPoints[i + 1];
    const len = a.distanceTo(b);
    if (len < 0.004) continue;

    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 10), mat);
    mid.addVectors(a, b).multiplyScalar(0.5);
    cyl.position.copy(mid);
    dir.subVectors(b, a).normalize();
    cyl.quaternion.setFromUnitVectors(up, dir);

    const isStub = i === 0 || i === pathPoints.length - 2;
    if (pickMeta && !isStub && len >= 0.06) {
      const adx = Math.abs(b.x - a.x);
      const ady = Math.abs(b.y - a.y);
      const adz = Math.abs(b.z - a.z);
      const axis: 'x' | 'y' | 'z' = ady >= adx && ady >= adz ? 'y' : adx >= adz ? 'x' : 'z';
      cyl.userData = {
        kind: 'cable-segment',
        routeKey: pickMeta.routeKey,
        label: pickMeta.label,
        segA: a.clone(),
        segB: b.clone(),
        axis,
      };
    }

    group.add(cyl);

    if (i > 0) {
      const elbow = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.05, 10, 8), mat);
      elbow.position.copy(a);
      group.add(elbow);
    }
  }
}

function buildBuildingPerimeterGroup(
  buildingName: string,
  bRooms: RoomZone[],
  isActiveBuilding: boolean,
  maxAnisotropy: number,
): THREE.Group {
  const group = new THREE.Group();
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;

  for (const r of bRooms) {
    minX = Math.min(minX, r.x - r.largeur / 2);
    maxX = Math.max(maxX, r.x + r.largeur / 2);
    minZ = Math.min(minZ, r.z - r.profondeur / 2);
    maxZ = Math.max(maxZ, r.z + r.profondeur / 2);
    minY = Math.min(minY, r.y);
  }

  const pad = 0.3;
  const x0 = minX - pad;
  const x1 = maxX + pad;
  const z0 = minZ - pad;
  const z1 = maxZ + pad;
  const y = minY + 0.012;

  const pts = [
    new THREE.Vector3(x0, y, z0),
    new THREE.Vector3(x1, y, z0),
    new THREE.Vector3(x1, y, z0),
    new THREE.Vector3(x1, y, z1),
    new THREE.Vector3(x1, y, z1),
    new THREE.Vector3(x0, y, z1),
    new THREE.Vector3(x0, y, z1),
    new THREE.Vector3(x0, y, z0),
  ];
  const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
  const lineMat = new THREE.LineBasicMaterial({
    color: isActiveBuilding ? 0x4f46e5 : 0x64748b,
    transparent: true,
    opacity: isActiveBuilding ? 0.72 : 0.42,
  });
  group.add(new THREE.LineSegments(lineGeo, lineMat));

  // Étiquette au sol devant le bâtiment
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const label = `${buildingName.slice(0, 22)} · ${bRooms.length} p.`;
    ctx.fillStyle = isActiveBuilding ? 'rgba(79, 70, 229, 0.92)' : 'rgba(30, 41, 59, 0.84)';
    ctx.beginPath();
    ctx.roundRect(24, 24, 464, 80, 22);
    ctx.fill();

    ctx.font = '700 34px "Plus Jakarta Sans", "DM Sans", system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 256, 65, 430);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAnisotropy;
    const badge = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 0.6),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
      }),
    );
    badge.rotation.x = -Math.PI / 2;
    badge.position.set((x0 + x1) / 2, y + 0.005, z1 + 0.42);
    group.add(badge);
  }

  return group;
}

function buildOpeningGroup(
  room: RoomZone,
  opening: RoomOpening,
  isSelected: boolean,
  isPreview = false,
): THREE.Group {
  const group = new THREE.Group();
  const wallLen = getWallLength(room, opening.wall);
  const effWidth = Math.min(opening.width, Math.max(0.45, wallLen - 0.1));
  const effSill =
    opening.type === 'porte' ? 0 : Math.min(opening.sillHeight, Math.max(0, room.hauteur - 0.5));
  const effHeight = Math.min(opening.height, Math.max(0.4, room.hauteur - effSill - 0.04));

  const maxOffset = Math.max(0, wallLen / 2 - effWidth / 2);
  const clampedOffset = Math.max(-maxOffset, Math.min(maxOffset, opening.offset));

  const tf = getOpeningLocalTransform(room, opening.wall, clampedOffset);
  group.position.set(tf.x, 0, tf.z);
  group.rotation.y = tf.rotY;

  const frameColor = isPreview ? 0x0d9488 : isSelected ? 0x2563eb : 0x1e293b;
  const frameMat = new THREE.MeshStandardMaterial({
    color: frameColor,
    roughness: 0.45,
    metalness: 0.2,
    transparent: isPreview,
    opacity: isPreview ? 0.78 : 1,
  });

  if (opening.type === 'porte') {
    const t = 0.06;
    const depth = 0.11;

    const leftJamb = new THREE.Mesh(new THREE.BoxGeometry(t, effHeight, depth), frameMat);
    leftJamb.position.set(-effWidth / 2 + t / 2, effHeight / 2, 0);

    const rightJamb = new THREE.Mesh(new THREE.BoxGeometry(t, effHeight, depth), frameMat);
    rightJamb.position.set(effWidth / 2 - t / 2, effHeight / 2, 0);

    const lintel = new THREE.Mesh(new THREE.BoxGeometry(effWidth + 0.04, t, depth), frameMat);
    lintel.position.set(0, effHeight - t / 2, 0);

    group.add(leftJamb, rightJamb, lintel);

    const leafW = Math.max(0.25, effWidth - t * 2);
    const leafH = Math.max(0.3, effHeight - t);
    const leafPivot = new THREE.Group();
    leafPivot.position.set(-effWidth / 2 + t, 0, 0);
    leafPivot.rotation.y = -0.38;

    const leafMat = new THREE.MeshStandardMaterial({
      color: isPreview ? 0x5eead4 : isSelected ? 0x93c5fd : 0xd9a05b,
      roughness: 0.6,
      metalness: 0.05,
      transparent: isPreview,
      opacity: isPreview ? 0.65 : 0.92,
    });
    const leafMesh = new THREE.Mesh(new THREE.BoxGeometry(leafW, leafH, 0.036), leafMat);
    leafMesh.position.set(leafW / 2, leafH / 2 + 0.02, 0);
    leafPivot.add(leafMesh);

    const handleMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.25,
      metalness: 0.85,
    });
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 10), handleMat);
    knob.position.set(leafW - 0.09, Math.min(1.02, leafH * 0.5), 0.035);
    leafPivot.add(knob);
    group.add(leafPivot);

    const arcPoints: THREE.Vector3[] = [new THREE.Vector3(-effWidth / 2 + t, 0.09, 0)];
    const radius = leafW;
    const segments = 16;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * (Math.PI / 2);
      arcPoints.push(
        new THREE.Vector3(-effWidth / 2 + t + Math.cos(a) * radius, 0.09, Math.sin(a) * radius),
      );
    }
    const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPoints);
    const arcMat = new THREE.LineBasicMaterial({
      color: isPreview ? 0x0d9488 : isSelected ? 0x2563eb : 0x92400e,
      transparent: true,
      opacity: 0.75,
    });
    group.add(new THREE.Line(arcGeo, arcMat));
  } else {
    const t = 0.05;
    const depth = 0.1;
    const centerY = effSill + effHeight / 2;

    const leftBar = new THREE.Mesh(new THREE.BoxGeometry(t, effHeight, depth), frameMat);
    leftBar.position.set(-effWidth / 2 + t / 2, centerY, 0);

    const rightBar = new THREE.Mesh(new THREE.BoxGeometry(t, effHeight, depth), frameMat);
    rightBar.position.set(effWidth / 2 - t / 2, centerY, 0);

    const topBar = new THREE.Mesh(new THREE.BoxGeometry(effWidth, t, depth), frameMat);
    topBar.position.set(0, effSill + effHeight - t / 2, 0);

    const sillBar = new THREE.Mesh(
      new THREE.BoxGeometry(effWidth + 0.06, t * 1.2, depth + 0.05),
      frameMat,
    );
    sillBar.position.set(0, effSill + t / 2, 0);

    const mullion = new THREE.Mesh(
      new THREE.BoxGeometry(0.036, Math.max(0.2, effHeight - t * 2), depth * 0.75),
      frameMat,
    );
    mullion.position.set(0, centerY, 0);

    const glassMat = new THREE.MeshStandardMaterial({
      color: isPreview ? 0x2dd4bf : isSelected ? 0x60a5fa : 0x38bdf8,
      roughness: 0.12,
      metalness: 0.15,
      transparent: true,
      opacity: isPreview ? 0.35 : 0.42,
      depthWrite: false,
    });
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(
        Math.max(0.2, effWidth - t * 2),
        Math.max(0.2, effHeight - t * 2),
        0.025,
      ),
      glassMat,
    );
    glass.position.set(0, centerY, 0);

    group.add(leftBar, rightBar, topBar, sillBar, mullion, glass);
  }

  if (!isPreview) {
    const hitBox = new THREE.Mesh(
      new THREE.BoxGeometry(effWidth + 0.16, effHeight + 0.16, 0.28),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    hitBox.position.set(0, effSill + effHeight / 2, 0);
    hitBox.userData = {
      kind: 'opening',
      openingId: opening.opening_id,
      roomId: room.zone_id,
    };
    group.add(hitBox);
  }

  return group;
}

function buildElectricalPointGroup(
  room: RoomZone,
  point: ElectricalPoint,
  pos: PointPosition3D,
  isSelected: boolean,
  isCircuitHighlight: boolean,
  isDimmed: boolean,
  isPreview = false,
): THREE.Group {
  const group = new THREE.Group();
  const { lx, ly, lz, rotY, isCeilingLight } = getPointLocalAndNormal(room, point, pos);

  group.position.set(lx, ly, lz);
  group.rotation.y = rotY;

  const phaseHex = isDimmed ? '#cbd5e1' : PHASE_META[point.phase_relevee].hex;
  const opacity = isPreview ? 0.72 : isDimmed ? 0.28 : 1;
  const transparent = isPreview || isDimmed;

  const phaseMat = new THREE.MeshStandardMaterial({
    color: phaseHex,
    emissive: isDimmed ? '#000000' : phaseHex,
    emissiveIntensity: isDimmed ? 0 : 0.28,
    roughness: 0.4,
    metalness: 0.1,
    transparent,
    opacity,
  });

  const bodyMat = new THREE.MeshStandardMaterial({
    color: isDimmed ? 0xe2e8f0 : 0xf1f5f9,
    roughness: 0.55,
    metalness: 0.05,
    transparent,
    opacity,
  });

  const darkMat = new THREE.MeshStandardMaterial({
    color: isDimmed ? 0x94a3b8 : 0x1e293b,
    roughness: 0.42,
    metalness: 0.22,
    transparent,
    opacity,
  });

  if (point.categorie === 'prise') {
    // Pose en saillie côté intérieur (+Z local) pour ne jamais traverser vers la pièce voisine
    const backing = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.012), darkMat);
    backing.position.z = 0.006;

    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.034), phaseMat);
    frame.position.z = 0.029;

    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.024), bodyMat);
    plate.position.z = 0.05;

    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.064, 0.024, 18), phaseMat);
    socket.rotation.x = Math.PI / 2;
    socket.position.z = 0.066;

    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.024, 8), darkMat);
    pin.rotation.x = Math.PI / 2;
    pin.position.set(0, 0.026, 0.082);

    const holeL = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.008, 8), darkMat);
    holeL.rotation.x = Math.PI / 2;
    holeL.position.set(-0.026, -0.014, 0.077);

    const holeR = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.008, 8), darkMat);
    holeR.rotation.x = Math.PI / 2;
    holeR.position.set(0.026, -0.014, 0.077);

    group.add(backing, frame, plate, socket, pin, holeL, holeR);
  } else if (point.categorie === 'lumiere') {
    const fixture = new THREE.Group();
    if (isCeilingLight) {
      fixture.rotation.x = Math.PI; // plafonnier orienté vers le bas (-Y)
    } else {
      fixture.rotation.x = Math.PI / 2; // applique murale orientée vers l'intérieur (+Z local)
      fixture.position.z = 0.028;
    }

    const backCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.185, 0.185, 0.052, 20),
      phaseMat,
    );
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.16, 0.065, 18), darkMat);
    base.position.y = 0.012;

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.026, 8, 24), phaseMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.04;

    const bulbMat = new THREE.MeshStandardMaterial({
      color: phaseHex,
      emissive: phaseHex,
      emissiveIntensity: isDimmed ? 0.1 : 0.55,
      roughness: 0.25,
      metalness: 0.05,
      transparent,
      opacity,
    });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 12), bulbMat);
    bulb.position.y = 0.085;

    fixture.add(backCollar, base, ring, bulb);
    group.add(fixture);
  } else if (point.categorie === 'equipement_fixe') {
    // Bloc appareil fixe posé strictement côté intérieur (+Z >= 0.01) avec façade avant lisible
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.28, 0.24), darkMat);
    chassis.position.z = 0.13;

    const band = new THREE.Mesh(new THREE.BoxGeometry(0.41, 0.1, 0.25), phaseMat);
    band.position.set(0, 0.075, 0.13);

    const badge = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.018), bodyMat);
    badge.position.set(0, -0.03, 0.255);

    group.add(chassis, band, badge);
  } else {
    // Multiprise murale posée côté intérieur avec alvéoles orientées vers la pièce
    const backing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.17, 0.012), darkMat);
    backing.position.z = 0.006;
    group.add(backing);

    const stripGroup = new THREE.Group();
    stripGroup.rotation.x = Math.PI / 2;
    stripGroup.position.z = 0.032;

    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.036, 0.17), phaseMat);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.042, 0.12), darkMat);
    bar.position.y = 0.012;
    stripGroup.add(frame, bar);

    [-0.14, 0, 0.14].forEach((ox) => {
      const slot = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.032, 12), bodyMat);
      slot.position.set(ox, 0.022, 0);
      stripGroup.add(slot);
    });
    group.add(stripGroup);
  }

  // Halo de sélection directe ou de circuit raccordé au disjoncteur
  if ((isSelected || isCircuitHighlight) && !isPreview) {
    const selRing = new THREE.Mesh(
      new THREE.TorusGeometry(isSelected ? 0.3 : 0.27, isSelected ? 0.028 : 0.02, 10, 28),
      new THREE.MeshBasicMaterial({
        color: isSelected ? 0x2563eb : 0x4f46e5,
        transparent: !isSelected,
        opacity: isSelected ? 1 : 0.85,
      }),
    );
    if (isCeilingLight) {
      selRing.rotation.x = Math.PI / 2;
      selRing.position.y = -0.02;
    } else {
      selRing.position.z = 0.06;
    }
    group.add(selRing);
  }

  if (!isPreview) {
    const hitBox = new THREE.Mesh(
      isCeilingLight
        ? new THREE.BoxGeometry(0.54, 0.38, 0.54)
        : new THREE.BoxGeometry(0.56, 0.54, 0.28),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    if (isCeilingLight) hitBox.position.y = -0.08;
    else hitBox.position.z = 0.14;
    hitBox.userData = {
      kind: 'elec-point',
      pointId: point.point_id,
      roomId: room.zone_id,
    };
    group.add(hitBox);
  }

  return group;
}

function buildPanelGroup(
  room: RoomZone,
  panel: BoardElement,
  pos: PointPosition3D,
  isSelected: boolean,
  isFeederHighlight: boolean,
  isDimmed: boolean,
  isPreview = false,
): THREE.Group {
  const group = new THREE.Group();
  const { lx, ly, lz, rotY } = getPanelLocalAndNormal(room, pos);

  group.position.set(lx, ly, lz);
  group.rotation.y = rotY;

  const phaseHex = isDimmed ? '#cbd5e1' : BOARD_PHASE_META[panel.phases].hex;
  const opacity = isPreview ? 0.72 : isDimmed ? 0.3 : 1;
  const transparent = isPreview || isDimmed;

  const casingMat = new THREE.MeshStandardMaterial({
    color: isDimmed ? 0xe2e8f0 : 0xf8fafc,
    roughness: 0.48,
    metalness: 0.08,
    transparent,
    opacity,
  });

  const rimMat = new THREE.MeshStandardMaterial({
    color: isDimmed ? 0x94a3b8 : 0x1e293b,
    roughness: 0.42,
    metalness: 0.25,
    transparent,
    opacity,
  });

  const accentMat = new THREE.MeshStandardMaterial({
    color: phaseHex,
    emissive: isDimmed ? '#000000' : phaseHex,
    emissiveIntensity: isDimmed ? 0 : 0.24,
    roughness: 0.35,
    metalness: 0.1,
    transparent,
    opacity,
  });

  // Coffret mural posé en saillie côté intérieur (+Z local) avec façade DIN orientée vers la pièce
  const rim = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.62, 0.032), rimMat);
  rim.position.z = 0.016;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.56, 0.064), casingMat);
  body.position.z = 0.048;
  const headerBand = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.09, 0.028), accentMat);
  headerBand.position.set(0, 0.21, 0.076);

  // Rangées de disjoncteurs côté intérieur uniquement
  const railBar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.022), rimMat);
  railBar.position.set(0, 0.02, 0.076);

  const railBar2 = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.022), rimMat);
  railBar2.position.set(0, -0.15, 0.076);

  group.add(rim, body, headerBand, railBar, railBar2);

  // Témoins triphasés L1/L2/L3 si TRI ou multiphasé
  const showL1 = panel.phases === 'TRI' || panel.phases.includes('L1');
  const showL2 = panel.phases === 'TRI' || panel.phases.includes('L2');
  const showL3 = panel.phases === 'TRI' || panel.phases.includes('L3');
  const phaseDots: { active: boolean; hex: string; x: number }[] = [
    { active: showL1, hex: PHASE_META.L1.hex, x: -0.1 },
    { active: showL2, hex: PHASE_META.L2.hex, x: 0 },
    { active: showL3, hex: PHASE_META.L3.hex, x: 0.1 },
  ];
  for (const d of phaseDots) {
    if (!d.active) continue;
    const dotMat = new THREE.MeshStandardMaterial({
      color: isDimmed ? '#cbd5e1' : d.hex,
      emissive: isDimmed ? '#000000' : d.hex,
      emissiveIntensity: isDimmed ? 0 : 0.35,
      transparent,
      opacity,
    });
    const dot = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.026), dotMat);
    dot.position.set(d.x, 0.12, 0.08);
    group.add(dot);
  }

  if ((isSelected || isFeederHighlight) && !isPreview) {
    const selFrame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(0.56, 0.7, 0.14)),
      new THREE.LineBasicMaterial({ color: isSelected ? 0x2563eb : 0x4f46e5 }),
    );
    selFrame.position.z = 0.055;
    group.add(selFrame);
  }

  if (!isPreview) {
    const hitBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.58, 0.72, 0.22),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    hitBox.position.z = 0.1;
    hitBox.userData = {
      kind: 'elec-panel',
      panelId: panel.element_id,
      roomId: room.zone_id,
    };
    group.add(hitBox);
  }

  return group;
}

function buildRoomGroup(
  room: RoomZone,
  roomOpenings: RoomOpening[],
  roomPoints: ElectricalPoint[],
  pointPositions: Record<string, PointPosition3D>,
  roomPanels: BoardElement[],
  panelPositions: Record<string, PointPosition3D>,
  isSelected: boolean,
  selectedOpeningId: string | null,
  selectedPointId: string | null,
  selectedPanelId: string | null,
  circuitHighlightPointIds: Set<string> | null,
  circuitIsolatePoints: boolean,
  highlightedPanelIds: Set<string> | null,
  isolatePanelHighlight: boolean,
  phaseFilter: PhaseFilter,
  isGhostLevel: boolean,
  maxAnisotropy: number,
  roomTone: RoomColorTone = FOUR_COLOR_ROOM_PALETTE[0],
): THREE.Group {
  const group = new THREE.Group();
  group.position.set(room.x, room.y, room.z);

  if (isGhostLevel) {
    const wallGeo = new THREE.BoxGeometry(room.largeur, room.hauteur, room.profondeur);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(wallGeo),
      new THREE.LineBasicMaterial({
        color: 0x94a3b8,
        transparent: true,
        opacity: 0.25,
      }),
    );
    edges.position.y = room.hauteur / 2;
    group.add(edges);
    wallGeo.dispose();
    return group;
  }

  // 1. Floor slab (4-color architectural distinction for adjacent rooms)
  const floorGeo = new THREE.BoxGeometry(room.largeur, 0.08, room.profondeur);
  const floorMat = new THREE.MeshStandardMaterial({
    color: isSelected ? 0xbfdbfe : roomTone.floorHex,
    roughness: 0.9,
    metalness: 0.0,
  });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.position.y = 0.04;
  floorMesh.receiveShadow = true;
  floorMesh.userData = { kind: 'room-floor', roomId: room.zone_id, label: room.nom };
  group.add(floorMesh);

  const floorEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(floorGeo),
    new THREE.LineBasicMaterial({
      color: isSelected ? 0x2563eb : roomTone.edgeHex,
      transparent: true,
      opacity: isSelected ? 0.95 : 0.65,
    }),
  );
  floorEdges.position.y = 0.04;
  group.add(floorEdges);

  // 2. Floor label
  const floorLabel = createRoomFloorLabel(room, maxAnisotropy);
  if (floorLabel) group.add(floorLabel);

  // 3. Translucent walls volume
  const wallGeo = new THREE.BoxGeometry(room.largeur, room.hauteur, room.profondeur);
  const wallMat = new THREE.MeshStandardMaterial({
    color: isSelected ? 0x60a5fa : roomTone.wallHex,
    roughness: 0.55,
    metalness: 0.02,
    transparent: true,
    opacity: isSelected ? 0.18 : 0.15,
    depthWrite: false,
  });
  const wallMesh = new THREE.Mesh(wallGeo, wallMat);
  wallMesh.position.y = room.hauteur / 2;
  group.add(wallMesh);

  // 4. Architectural edges
  const edgesGeo = new THREE.EdgesGeometry(wallGeo);
  const edgeMat = new THREE.LineBasicMaterial({
    color: isSelected ? 0x2563eb : roomTone.edgeHex,
    transparent: true,
    opacity: isSelected ? 0.95 : 0.72,
  });
  const edges = new THREE.LineSegments(edgesGeo, edgeMat);
  edges.position.y = room.hauteur / 2;
  group.add(edges);

  // 5. Invisible wall hit planes ONLY for selected room
  if (isSelected) {
    const wallHitSpecs: {
      wall: WallSide;
      w: number;
      pos: [number, number, number];
      rotY: number;
    }[] = [
      { wall: 'north', w: room.largeur, pos: [0, room.hauteur / 2, -room.profondeur / 2], rotY: 0 },
      { wall: 'south', w: room.largeur, pos: [0, room.hauteur / 2, room.profondeur / 2], rotY: Math.PI },
      { wall: 'west', w: room.profondeur, pos: [-room.largeur / 2, room.hauteur / 2, 0], rotY: Math.PI / 2 },
      { wall: 'east', w: room.profondeur, pos: [room.largeur / 2, room.hauteur / 2, 0], rotY: -Math.PI / 2 },
    ];
    const wallHitMat = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    wallHitSpecs.forEach((spec) => {
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(spec.w, room.hauteur),
        wallHitMat.clone(),
      );
      plane.position.set(...spec.pos);
      plane.rotation.y = spec.rotY;
      plane.userData = { kind: 'wall', roomId: room.zone_id, wall: spec.wall };
      group.add(plane);
    });

    // Plan de plafond invisible (actif pour le placement des lumières au plafond)
    const ceilingPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(room.largeur, room.profondeur),
      wallHitMat.clone(),
    );
    ceilingPlane.position.set(0, room.hauteur, 0);
    ceilingPlane.rotation.x = Math.PI / 2;
    ceilingPlane.userData = { kind: 'ceiling', roomId: room.zone_id };
    group.add(ceilingPlane);

    wallHitMat.dispose();
  }

  // 6. Doors & Windows
  for (const op of roomOpenings) {
    group.add(buildOpeningGroup(room, op, op.opening_id === selectedOpeningId, false));
  }

  // 7. Electrical points inside this room
  for (const pt of roomPoints) {
    const pos = pointPositions[pt.point_id] ?? { x: 0, y: 0.35, z: 0 };
    const isCircuitHighlight = circuitHighlightPointIds ? circuitHighlightPointIds.has(pt.point_id) : false;
    const isDimmedByPhase = phaseFilter !== 'TOUTES' && pt.phase_relevee !== phaseFilter;
    const isDimmedByCircuit = circuitIsolatePoints && !isCircuitHighlight && pt.point_id !== selectedPointId;
    const isDimmed = isDimmedByPhase || isDimmedByCircuit;
    group.add(
      buildElectricalPointGroup(
        room,
        pt,
        pos,
        pt.point_id === selectedPointId,
        isCircuitHighlight,
        isDimmed,
        false,
      ),
    );
  }

  // 7b. Electrical panels (boitiers) mounted on walls
  for (const panel of roomPanels) {
    const pos = panelPositions[panel.element_id] ?? getDefaultPanelPos(room);
    const isFeederHighlight = highlightedPanelIds ? highlightedPanelIds.has(panel.element_id) : false;
    const isDimmedByPhase = !panelMatchesPhaseFilter(panel, phaseFilter);
    const isDimmedByCircuit =
      isolatePanelHighlight &&
      highlightedPanelIds !== null &&
      highlightedPanelIds.size > 0 &&
      !isFeederHighlight &&
      panel.element_id !== selectedPanelId;
    const isDimmed = isDimmedByPhase || isDimmedByCircuit;
    group.add(
      buildPanelGroup(
        room,
        panel,
        pos,
        panel.element_id === selectedPanelId,
        isFeederHighlight,
        isDimmed,
        false,
      ),
    );
  }

  // 8. Room resize/move handles when selected
  if (isSelected) {
    const handleMat = new THREE.MeshStandardMaterial({
      color: 0x2563eb,
      roughness: 0.3,
      metalness: 0.2,
    });
    const centerMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.35,
      metalness: 0.3,
    });

    const movePuck = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.12, 20), centerMat);
    movePuck.position.set(0, 0.12, 0);
    movePuck.userData = {
      kind: 'handle',
      action: 'move',
      roomId: room.zone_id,
      label: 'Glisser pour déplacer la pièce',
    };
    group.add(movePuck);

    const edgesSpec: {
      pos: [number, number, number];
      size: [number, number, number];
      action: string;
    }[] = [
      { pos: [room.largeur / 2, 0.14, 0], size: [0.22, 0.22, 0.65], action: 'resize-x+' },
      { pos: [-room.largeur / 2, 0.14, 0], size: [0.22, 0.22, 0.65], action: 'resize-x-' },
      { pos: [0, 0.14, room.profondeur / 2], size: [0.65, 0.22, 0.22], action: 'resize-z+' },
      { pos: [0, 0.14, -room.profondeur / 2], size: [0.65, 0.22, 0.22], action: 'resize-z-' },
    ];

    edgesSpec.forEach((spec) => {
      const h = new THREE.Mesh(new THREE.BoxGeometry(...spec.size), handleMat);
      h.position.set(...spec.pos);
      h.userData = {
        kind: 'handle',
        action: spec.action,
        roomId: room.zone_id,
        label: 'Glisser pour redimensionner',
      };
      group.add(h);
    });

    const heightHandle = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), handleMat);
    heightHandle.position.set(0, room.hauteur + 0.18, 0);
    heightHandle.userData = {
      kind: 'handle',
      action: 'resize-h',
      roomId: room.zone_id,
      label: 'Glisser verticalement pour ajuster la hauteur',
    };
    group.add(heightHandle);
  }

  return group;
}

export const RoomBuilder3D: React.FC<RoomBuilder3DProps> = ({
  rooms,
  openings,
  points,
  pointPositions,
  panels = [],
  breakers = [],
  panelPositions = {},
  cableRoutes = {},
  selectedRoomId,
  selectedOpeningId,
  selectedPointId,
  selectedPanelId = null,
  selectedBreakerId = null,
  focusRequest = null,
  workspace = 'construction',
  mode,
  activePointCategory,
  activePointPhase,
  phaseFilter,
  snapStep = 0.1,
  magneticSnap = true,
  workElevation = 0,
  levelFilter = 'all',
  onSelectRoom,
  onSelectOpening,
  onSelectPoint,
  onSelectPanel,
  onCreateRoom,
  onUpdateRoom,
  onRoomTransformEnd,
  onCreateOpening,
  onUpdateOpening,
  onCreatePoint,
  onUpdatePointPosition,
  onCreatePanel,
  onUpdatePanelPosition,
  onUpdateCableRoute,
  onActivePointCategoryChange,
  onActivePointPhaseChange,
  onPhaseFilterChange,
  onModeChange,
  onInteractionStart,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [liveMeasure, setLiveMeasure] = useState<string | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const [selectedCableKey, setSelectedCableKey] = useState<string | null>(null);
  const [activeCableSummary, setActiveCableSummary] = useState<{
    routeKey: string;
    label: string;
    isCustom: boolean;
  } | null>(null);

  const propsRef = useRef({
    rooms,
    openings,
    points,
    pointPositions,
    panels,
    breakers,
    panelPositions,
    cableRoutes,
    selectedRoomId,
    selectedOpeningId,
    selectedPointId,
    selectedPanelId,
    selectedBreakerId,
    workspace,
    mode,
    activePointCategory,
    activePointPhase,
    phaseFilter,
    snapStep,
    magneticSnap,
    workElevation,
    levelFilter,
    onSelectRoom,
    onSelectOpening,
    onSelectPoint,
    onSelectPanel,
    onCreateRoom,
    onUpdateRoom,
    onRoomTransformEnd,
    onCreateOpening,
    onUpdateOpening,
    onCreatePoint,
    onUpdatePointPosition,
    onCreatePanel,
    onUpdatePanelPosition,
    onUpdateCableRoute,
    onModeChange,
    onInteractionStart,
  });
  propsRef.current = {
    rooms,
    openings,
    points,
    pointPositions,
    panels,
    breakers,
    panelPositions,
    cableRoutes,
    selectedRoomId,
    selectedOpeningId,
    selectedPointId,
    selectedPanelId,
    selectedBreakerId,
    workspace,
    mode,
    activePointCategory,
    activePointPhase,
    phaseFilter,
    snapStep,
    magneticSnap,
    workElevation,
    levelFilter,
    onSelectRoom,
    onSelectOpening,
    onSelectPoint,
    onSelectPanel,
    onCreateRoom,
    onUpdateRoom,
    onRoomTransformEnd,
    onCreateOpening,
    onUpdateOpening,
    onCreatePoint,
    onUpdatePointPosition,
    onCreatePanel,
    onUpdatePanelPosition,
    onUpdateCableRoute,
    onModeChange,
    onInteractionStart,
  };

  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    grid: THREE.GridHelper;
    roomsGroup: THREE.Group;
    circuitGroup: THREE.Group;
    ghostGroup: THREE.Group;
    guideGroup: THREE.Group;
    pickables: THREE.Object3D[];
    wallPickables: THREE.Object3D[];
    ceilingPickables: THREE.Object3D[];
    cableRouteMetaMap: Map<string, CableRouteMeta>;
    selectedFloorMesh: THREE.Object3D | null;
    maxAnisotropy: number;
    isSoftwareGl: boolean;
    cameraAnim: {
      active: boolean;
      targetPos: THREE.Vector3;
      targetLook: THREE.Vector3;
    };
    requestRender: () => void;
  } | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const isSoftwareGl = detectSoftwareGl();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglUnavailable(true);
      return;
    }

    const w = Math.max(320, mount.clientWidth);
    const h = Math.max(240, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy() || 1);

    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xebf0f5);
    scene.fog = new THREE.Fog(0xebf0f5, 26, 65);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(44, w / h, 0.2, 150);
    camera.position.set(9, 9, 11);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.minDistance = 4;
    controls.maxDistance = 45;
    controls.target.set(0, 0.8, 0);

    scene.add(new THREE.HemisphereLight(0xf8fafc, 0xcbd5e1, 0.85));
    const keyLight = new THREE.DirectionalLight(0xfff7ed, 1.3);
    keyLight.position.set(10, 18, 10);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xe0f2fe, 0.45);
    rimLight.position.set(-10, 8, -10);
    scene.add(rimLight);

    const grid = new THREE.GridHelper(40, 80, 0x94a3b8, 0xd4dde7);
    grid.position.y = -0.005;
    scene.add(grid);

    const roomsGroup = new THREE.Group();
    const circuitGroup = new THREE.Group();
    const ghostGroup = new THREE.Group();
    const guideGroup = new THREE.Group();
    scene.add(roomsGroup, circuitGroup, ghostGroup, guideGroup);

    if (!isSoftwareGl) renderer.compile(scene, camera);

    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    const clock = new THREE.Clock();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const st = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (st === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const cameraAnim = {
      active: false,
      targetPos: new THREE.Vector3(),
      targetLook: new THREE.Vector3(),
    };

    const state = {
      scene,
      camera,
      renderer,
      controls,
      grid,
      roomsGroup,
      circuitGroup,
      ghostGroup,
      guideGroup,
      pickables: [] as THREE.Object3D[],
      wallPickables: [] as THREE.Object3D[],
      ceilingPickables: [] as THREE.Object3D[],
      cableRouteMetaMap: new Map<string, CableRouteMeta>(),
      selectedFloorMesh: null as THREE.Object3D | null,
      maxAnisotropy,
      isSoftwareGl,
      cameraAnim,
      requestRender: () => {},
    };

    const requestRender = () => {
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        renderDirty = false;
        if (cameraAnim.active) {
          if (isSoftwareGl) {
            camera.position.copy(cameraAnim.targetPos);
            controls.target.copy(cameraAnim.targetLook);
            cameraAnim.active = false;
          } else {
            camera.position.lerp(cameraAnim.targetPos, 0.14);
            controls.target.lerp(cameraAnim.targetLook, 0.14);
            if (
              camera.position.distanceTo(cameraAnim.targetPos) < 0.04 &&
              controls.target.distanceTo(cameraAnim.targetLook) < 0.04
            ) {
              camera.position.copy(cameraAnim.targetPos);
              controls.target.copy(cameraAnim.targetLook);
              cameraAnim.active = false;
            } else {
              renderDirty = true;
            }
          }
        }
        if (controls.update() && !isSoftwareGl) renderDirty = true;
        renderer.render(scene, camera);
        const done = () => {
          renderBusy = false;
          if (renderDirty) requestRender();
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    };

    state.requestRender = requestRender;
    sceneRef.current = state;

    controls.addEventListener('change', requestRender);
    controls.addEventListener('start', () => {
      cameraAnim.active = false;
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let activeDrag: DragAction | null = null;
    let dragSnapshotTaken = false;
    let drawRect: { x: number; z: number; largeur: number; profondeur: number } | null = null;
    let pointerDownScreen = { x: 0, y: 0 };

    const updatePointer = (ev: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const hitAtElevation = (ev: PointerEvent, elevationY: number): THREE.Vector3 | null => {
      updatePointer(ev);
      raycaster.setFromCamera(pointer, camera);
      _groundPlane.constant = -elevationY;
      return raycaster.ray.intersectPlane(_groundPlane, _rayHit) ? _rayHit : null;
    };

    const clearGhost = () => {
      disposeTree(ghostGroup);
      ghostGroup.clear();
      requestRender();
    };

    const renderRoomGhost = (
      rect: { x: number; y: number; z: number; largeur: number; profondeur: number } | null,
    ) => {
      disposeTree(ghostGroup);
      ghostGroup.clear();
      if (!rect) {
        requestRender();
        return;
      }
      const boxGeo = new THREE.BoxGeometry(rect.largeur, 2.5, rect.profondeur);
      const boxMat = new THREE.MeshStandardMaterial({
        color: 0x2563eb,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      });
      const box = new THREE.Mesh(boxGeo, boxMat);
      box.position.set(rect.x, rect.y + 1.25, rect.z);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(boxGeo),
        new THREE.LineBasicMaterial({ color: 0x2563eb }),
      );
      edges.position.copy(box.position);
      ghostGroup.add(box, edges);
      requestRender();
    };

    const renderOpeningGhost = (room: RoomZone, opening: RoomOpening) => {
      disposeTree(ghostGroup);
      ghostGroup.clear();

      const wallLen = getWallLength(room, opening.wall);
      const wallTf = getOpeningLocalTransform(room, opening.wall, 0);
      const wallHighlight = new THREE.Mesh(
        new THREE.PlaneGeometry(wallLen, room.hauteur),
        new THREE.MeshBasicMaterial({
          color: 0x0d9488,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.14,
          depthWrite: false,
        }),
      );
      wallHighlight.position.set(room.x + wallTf.x, room.y + room.hauteur / 2, room.z + wallTf.z);
      wallHighlight.rotation.y = wallTf.rotY;
      ghostGroup.add(wallHighlight);

      const preview = buildOpeningGroup(room, opening, false, true);
      preview.position.y += room.y;
      preview.position.x += room.x;
      preview.position.z += room.z;
      ghostGroup.add(preview);
      requestRender();
    };

    const renderPointGhost = (room: RoomZone, pos: PointPosition3D) => {
      disposeTree(ghostGroup);
      ghostGroup.clear();

      const phaseColor = PHASE_META[propsRef.current.activePointPhase].hex;
      if (pos.wall) {
        const wallLen = getWallLength(room, pos.wall);
        const wallTf = getOpeningLocalTransform(room, pos.wall, 0);
        const wallHighlight = new THREE.Mesh(
          new THREE.PlaneGeometry(wallLen, room.hauteur),
          new THREE.MeshBasicMaterial({
            color: phaseColor,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.14,
            depthWrite: false,
          }),
        );
        wallHighlight.position.set(room.x + wallTf.x, room.y + room.hauteur / 2, room.z + wallTf.z);
        wallHighlight.rotation.y = wallTf.rotY;
        ghostGroup.add(wallHighlight);
      } else {
        const ceilingHighlight = new THREE.Mesh(
          new THREE.PlaneGeometry(room.largeur, room.profondeur),
          new THREE.MeshBasicMaterial({
            color: phaseColor,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.16,
            depthWrite: false,
          }),
        );
        ceilingHighlight.position.set(room.x, room.y + room.hauteur, room.z);
        ceilingHighlight.rotation.x = -Math.PI / 2;
        ghostGroup.add(ceilingHighlight);
      }

      const fakePoint: ElectricalPoint = {
        scenario: 'actuel',
        point_id: '__preview__',
        nom: '',
        zone_id: room.zone_id,
        disjoncteur_id: '',
        categorie: propsRef.current.activePointCategory,
        type_appareil: '',
        phase_relevee: propsRef.current.activePointPhase,
        puissance_est_w: null,
        statut: 'existant',
        note: '',
      };

      const preview = buildElectricalPointGroup(room, fakePoint, pos, false, false, false, true);
      preview.position.x += room.x;
      preview.position.y += room.y;
      preview.position.z += room.z;
      ghostGroup.add(preview);
      requestRender();
    };

    const renderPanelGhost = (room: RoomZone, pos: PointPosition3D) => {
      disposeTree(ghostGroup);
      ghostGroup.clear();
      const fakePanel: BoardElement = {
        scenario: 'actuel',
        element_id: '__preview_panel__',
        type_element: 'boitier',
        nom: 'Tableau',
        zone_id: room.zone_id,
        parent_id: '',
        phases: 'TRI',
        calibre_a: null,
        statut: 'existant',
        note: '',
      };
      const preview = buildPanelGroup(room, fakePanel, pos, false, false, false, true);
      preview.position.x += room.x;
      preview.position.y += room.y;
      preview.position.z += room.z;
      ghostGroup.add(preview);
      requestRender();
    };

    const renderGuides = (guideX: number | null, guideZ: number | null, elevationY: number) => {
      disposeTree(guideGroup);
      guideGroup.clear();
      const guideMat = new THREE.LineBasicMaterial({ color: 0x0d9488 });
      if (guideX !== null) {
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(guideX, elevationY + 0.03, -20),
          new THREE.Vector3(guideX, elevationY + 0.03, 20),
        ]);
        guideGroup.add(new THREE.Line(geo, guideMat));
      }
      if (guideZ !== null) {
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-20, elevationY + 0.03, guideZ),
          new THREE.Vector3(20, elevationY + 0.03, guideZ),
        ]);
        guideGroup.add(new THREE.Line(geo, guideMat));
      }
      if (guideX === null && guideZ === null) guideMat.dispose();
      requestRender();
    };

    const getOpeningPlacementFromEvent = (
      ev: PointerEvent,
      openingType: OpeningType,
    ): {
      room: RoomZone;
      wall: WallSide;
      offset: number;
      sillHeight: number;
      centered: boolean;
    } | null => {
      updatePointer(ev);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(state.wallPickables, false);
      if (hits.length === 0) return null;

      const hit = hits[0];
      const { roomId, wall } = hit.object.userData as { roomId: string; wall: WallSide };
      const room = propsRef.current.rooms.find((r) => r.zone_id === roomId);
      if (!room) return null;

      const defaultWidth = openingType === 'porte' ? 0.9 : 1.2;
      const defaultHeight = openingType === 'porte' ? 2.05 : 1.15;
      const { offset, centered } = computeSnappedOpeningOffset(
        room,
        wall,
        hit.point,
        defaultWidth,
        propsRef.current.snapStep,
        propsRef.current.magneticSnap,
      );
      const sillHeight =
        openingType === 'porte'
          ? 0
          : computeSnappedOpeningSill(
              room,
              hit.point.y,
              defaultHeight,
              propsRef.current.magneticSnap,
            );
      return { room, wall, offset, sillHeight, centered };
    };

    const getPointPlacementFromEvent = (
      ev: PointerEvent,
    ): { room: RoomZone; pos: PointPosition3D; surfaceLabel: string } | null => {
      const {
        rooms: curRooms,
        activePointCategory: cat,
        snapStep: step,
        magneticSnap: mag,
      } = propsRef.current;

      updatePointer(ev);
      raycaster.setFromCamera(pointer, camera);

      const targets =
        cat === 'lumiere'
          ? [...state.ceilingPickables, ...state.wallPickables]
          : state.wallPickables;

      const hits = raycaster.intersectObjects(targets, false);
      if (hits.length === 0) return null;

      const hit = hits[0];
      const { kind, roomId, wall } = hit.object.userData as {
        kind: string;
        roomId: string;
        wall?: WallSide;
      };
      const room = curRooms.find((r) => r.zone_id === roomId);
      if (!room) return null;

      if (kind === 'ceiling' && cat === 'lumiere') {
        const pos = computeSnappedPointOnCeiling(room, hit.point, step, mag);
        return {
          room,
          pos,
          surfaceLabel: `Plafond · (${pos.x.toFixed(1)}, ${pos.z.toFixed(1)})`,
        };
      }

      if (wall) {
        const pos = computeSnappedPointOnWall(room, wall, hit.point, cat, step, mag);
        return {
          room,
          pos,
          surfaceLabel: `Mur ${WALL_LABELS[wall]} · h ${pos.y.toFixed(1)} m`,
        };
      }

      return null;
    };

    const getPanelPlacementFromEvent = (
      ev: PointerEvent,
    ): { room: RoomZone; pos: PointPosition3D; surfaceLabel: string } | null => {
      const { rooms: curRooms, snapStep: step, magneticSnap: mag } = propsRef.current;

      updatePointer(ev);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(state.wallPickables, false);
      if (hits.length === 0) return null;

      const hit = hits[0];
      const { roomId, wall } = hit.object.userData as { roomId: string; wall?: WallSide };
      const room = curRooms.find((r) => r.zone_id === roomId);
      if (!room || !wall) return null;

      const pos = computeSnappedPanelOnWall(room, wall, hit.point, step, mag);
      return {
        room,
        pos,
        surfaceLabel: `Mur ${WALL_LABELS[wall]} · h ${pos.y.toFixed(1)} m`,
      };
    };

    const onPointerDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      pointerDownScreen = { x: ev.clientX, y: ev.clientY };
      dragSnapshotTaken = false;
      const {
        mode: curMode,
        rooms: curRooms,
        openings: curOpenings,
        points: curPoints,
        pointPositions: curPositions,
        panels: curPanels,
        panelPositions: curPanelPositions,
        snapStep: step,
        magneticSnap: mag,
        workElevation: workY,
        workspace: curWorkspace,
      } = propsRef.current;

      if (curWorkspace === 'exploitation') {
        return;
      }

      if (curMode === 'draw') {
        const hit = hitAtElevation(ev, workY);
        if (!hit) return;
        controls.enabled = false;
        const walls = collectOtherWallPlanes(curRooms);
        const sx = snapCoordToWalls(hit.x, walls.xs, step, mag);
        const sz = snapCoordToWalls(hit.z, walls.zs, step, mag);
        activeDrag = { type: 'draw', startX: sx.value, startZ: sz.value };
        drawRect = { x: sx.value, z: sz.value, largeur: step, profondeur: step };
        renderRoomGhost({ ...drawRect, y: workY });
        renderGuides(sx.snappedTo, sz.snappedTo, workY);
        setLiveMeasure(
          `${step.toFixed(1)} m × ${step.toFixed(1)} m${sx.snappedTo !== null || sz.snappedTo !== null ? ' · Aimanté' : ''}`,
        );
        return;
      }

      if (curMode === 'door' || curMode === 'window' || curMode === 'point' || curMode === 'panel') {
        return;
      }

      updatePointer(ev);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(state.pickables, false);
      if (hits.length === 0) return;

      // 0a. Interactive cable handles (corner, insert-corner, elevation)
      const cableHandleHit = hits.find((h) => h.object.userData?.kind === 'cable-handle');
      if (cableHandleHit) {
        const data = cableHandleHit.object.userData as {
          handleType: 'corner' | 'insert-corner' | 'elevation';
          routeKey: string;
          wpIndex?: number;
          insertIndex?: number;
          mid?: CableWaypoint;
          baseY?: number;
        };
        const meta = state.cableRouteMetaMap.get(data.routeKey);
        if (meta) {
          controls.enabled = false;
          setSelectedCableKey(data.routeKey);
          if (data.handleType === 'corner' && typeof data.wpIndex === 'number') {
            const wp = meta.waypoints[data.wpIndex];
            if (wp) {
              activeDrag = {
                type: 'cable-corner',
                routeKey: data.routeKey,
                label: meta.label,
                startWaypoints: meta.waypoints.map((w) => ({ ...w })),
                wpIndex: data.wpIndex,
                fixedY: wp.y,
                pOut: meta.pOut.clone(),
                cOut: meta.cOut.clone(),
              };
              setLiveMeasure(`${meta.label} · Coude (${wp.x.toFixed(2)}, ${wp.z.toFixed(2)})`);
            }
          } else if (
            data.handleType === 'insert-corner' &&
            typeof data.insertIndex === 'number' &&
            data.mid
          ) {
            const nextWps = meta.waypoints.map((w) => ({ ...w }));
            nextWps.splice(data.insertIndex, 0, { ...data.mid });
            activeDrag = {
              type: 'cable-corner',
              routeKey: data.routeKey,
              label: meta.label,
              startWaypoints: nextWps,
              wpIndex: data.insertIndex,
              fixedY: data.mid.y,
              pOut: meta.pOut.clone(),
              cOut: meta.cOut.clone(),
            };
            setLiveMeasure(`${meta.label} · Nouveau coude`);
          } else if (data.handleType === 'elevation' && typeof data.baseY === 'number') {
            activeDrag = {
              type: 'cable-elevation',
              routeKey: data.routeKey,
              label: meta.label,
              startWaypoints: meta.waypoints.map((w) => ({ ...w })),
              startClientY: ev.clientY,
              baseY: data.baseY,
              pOut: meta.pOut.clone(),
              cOut: meta.cOut.clone(),
            };
            setLiveMeasure(`${meta.label} · Hauteur ${data.baseY.toFixed(2)} m`);
          }
          return;
        }
      }

      // 0b. Electrical panel hit (drag directly)
      const panelHit = hits.find((h) => h.object.userData?.kind === 'elec-panel');
      if (panelHit) {
        const { panelId } = panelHit.object.userData as { panelId: string };
        const panel = curPanels.find((p) => p.element_id === panelId);
        const room = panel ? curRooms.find((r) => r.zone_id === panel.zone_id) : undefined;
        if (panel && room) {
          const pos = curPanelPositions[panel.element_id] ?? {
            x: 0,
            y: Math.min(1.45, room.hauteur - 0.35),
            z: Number((-room.profondeur / 2).toFixed(2)),
            wall: 'north',
          };
          controls.enabled = false;
          setSelectedCableKey(null);
          propsRef.current.onSelectRoom(room.zone_id);
          propsRef.current.onSelectOpening(null);
          propsRef.current.onSelectPoint(null);
          propsRef.current.onSelectPanel?.(panel.element_id);
          activeDrag = { type: 'move-panel', panel, room, pos };
          setLiveMeasure(`${panel.nom} · ${BOARD_PHASE_META[panel.phases].shortLabel}`);
          return;
        }
      }

      // 1. Electrical point hit (drag directly)
      const pointHit = hits.find((h) => h.object.userData?.kind === 'elec-point');
      if (pointHit) {
        const { pointId } = pointHit.object.userData as { pointId: string };
        const point = curPoints.find((p) => p.point_id === pointId);
        const room = point ? curRooms.find((r) => r.zone_id === point.zone_id) : undefined;
        if (point && room) {
          const pos = curPositions[point.point_id] ?? { x: 0, y: 0.35, z: 0 };
          controls.enabled = false;
          setSelectedCableKey(null);
          propsRef.current.onSelectRoom(room.zone_id);
          propsRef.current.onSelectOpening(null);
          propsRef.current.onSelectPanel?.(null);
          propsRef.current.onSelectPoint(point.point_id);
          activeDrag = { type: 'move-point', point, room, pos };
          setLiveMeasure(`${point.nom} · ${PHASE_META[point.phase_relevee].shortLabel}`);
          return;
        }
      }

      // 2. Room handles
      const handleHit = hits.find((h) => h.object.userData?.kind === 'handle');
      if (handleHit) {
        const { action, roomId } = handleHit.object.userData as { action: string; roomId: string };
        const room = curRooms.find((r) => r.zone_id === roomId);
        if (!room) return;
        controls.enabled = false;
        setSelectedCableKey(null);

        if (action === 'resize-h') {
          activeDrag = { type: 'resize-h', room, startClientY: ev.clientY, startH: room.hauteur };
          setLiveMeasure(`Hauteur : ${room.hauteur.toFixed(1)} m`);
          return;
        }

        const ground = hitAtElevation(ev, room.y);
        if (!ground) return;

        if (action === 'move') {
          activeDrag = {
            type: 'move',
            room,
            offsetX: ground.x - room.x,
            offsetZ: ground.z - room.z,
          };
        } else if (action === 'resize-x+') {
          activeDrag = { type: 'resize-x+', room, anchorMinX: room.x - room.largeur / 2 };
        } else if (action === 'resize-x-') {
          activeDrag = { type: 'resize-x-', room, anchorMaxX: room.x + room.largeur / 2 };
        } else if (action === 'resize-z+') {
          activeDrag = { type: 'resize-z+', room, anchorMinZ: room.z - room.profondeur / 2 };
        } else if (action === 'resize-z-') {
          activeDrag = { type: 'resize-z-', room, anchorMaxZ: room.z + room.profondeur / 2 };
        }
        return;
      }

      // 3. Openings
      const openingHit = hits.find((h) => h.object.userData?.kind === 'opening');
      if (openingHit) {
        const { openingId } = openingHit.object.userData as { openingId: string };
        const opening = curOpenings.find((o) => o.opening_id === openingId);
        const room = opening ? curRooms.find((r) => r.zone_id === opening.zone_id) : undefined;
        if (opening && room) {
          controls.enabled = false;
          setSelectedCableKey(null);
          propsRef.current.onSelectRoom(room.zone_id);
          propsRef.current.onSelectPoint(null);
          propsRef.current.onSelectPanel?.(null);
          propsRef.current.onSelectOpening(opening.opening_id);
          activeDrag = { type: 'move-opening', opening, room };
          const label = opening.type === 'porte' ? 'Porte' : 'Fenêtre';
          setLiveMeasure(
            `${label} · Mur ${WALL_LABELS[opening.wall]} · ${
              Math.abs(opening.offset) < 0.01
                ? 'Centré'
                : `${opening.offset > 0 ? '+' : ''}${opening.offset.toFixed(2)} m`
            }`,
          );
          return;
        }
      }

      // 4. Cable segments (drag perpendicular or vertical, checked before room-floor)
      const cableSegHit = hits.find((h) => h.object.userData?.kind === 'cable-segment');
      if (cableSegHit) {
        const data = cableSegHit.object.userData as {
          routeKey: string;
          label: string;
          segA: THREE.Vector3;
          segB: THREE.Vector3;
          axis: 'x' | 'y' | 'z';
        };
        const meta = state.cableRouteMetaMap.get(data.routeKey);
        if (meta) {
          controls.enabled = false;
          setSelectedCableKey(data.routeKey);
          if (data.axis === 'y') {
            const baseY = meta.waypoints[0]?.y ?? data.segA.y;
            activeDrag = {
              type: 'cable-elevation',
              routeKey: data.routeKey,
              label: meta.label,
              startWaypoints: meta.waypoints.map((w) => ({ ...w })),
              startClientY: ev.clientY,
              baseY,
              pOut: meta.pOut.clone(),
              cOut: meta.cOut.clone(),
            };
            setLiveMeasure(`${meta.label} · Hauteur ${baseY.toFixed(2)} m`);
          } else {
            const setup = resolveSegmentDragSetup(meta.waypoints, data.segA, data.segB);
            if (setup) {
              activeDrag = {
                type: 'cable-segment',
                routeKey: data.routeKey,
                label: meta.label,
                startWaypoints: setup.workingWaypoints,
                idxA: setup.idxA,
                idxB: setup.idxB,
                axis: data.axis,
                fixedY: data.segA.y,
                midX: (data.segA.x + data.segB.x) / 2,
                midZ: (data.segA.z + data.segB.z) / 2,
                pOut: meta.pOut.clone(),
                cOut: meta.cOut.clone(),
              };
              setLiveMeasure(`${meta.label} · Déplacer tronçon`);
            } else {
              controls.enabled = true;
            }
          }
          return;
        }
      }
    };

    const onPointerMove = (ev: PointerEvent) => {
      const {
        rooms: curRooms,
        snapStep: step,
        magneticSnap: mag,
        workElevation: workY,
        onUpdateRoom: updateRoom,
        onUpdateOpening: updateOpening,
        onUpdatePointPosition: updatePointPos,
        mode: curMode,
        activePointCategory: cat,
        activePointPhase: phase,
      } = propsRef.current;

      if (!activeDrag) {
        if (curMode === 'draw') {
          renderer.domElement.style.cursor = 'crosshair';
          return;
        }
        if (curMode === 'door' || curMode === 'window') {
          const opType: OpeningType = curMode === 'door' ? 'porte' : 'fenetre';
          const placement = getOpeningPlacementFromEvent(ev, opType);
          if (placement) {
            renderer.domElement.style.cursor = 'copy';
            renderOpeningGhost(placement.room, {
              opening_id: '__preview__',
              zone_id: placement.room.zone_id,
              type: opType,
              wall: placement.wall,
              offset: placement.offset,
              width: opType === 'porte' ? 0.9 : 1.2,
              height: opType === 'porte' ? 2.05 : 1.15,
              sillHeight: placement.sillHeight,
            });
            setLiveMeasure(
              `${opType === 'porte' ? 'Porte' : 'Fenêtre'} · ${placement.room.nom} (${
                WALL_LABELS[placement.wall]
              }) · ${
                placement.centered
                  ? 'Centré'
                  : `${placement.offset > 0 ? '+' : ''}${placement.offset.toFixed(2)} m`
              }${opType === 'fenetre' ? ` · Allège ${placement.sillHeight.toFixed(1)} m` : ''}`,
            );
          } else {
            renderer.domElement.style.cursor = 'grab';
            clearGhost();
            setLiveMeasure(null);
          }
          return;
        }

        if (curMode === 'point') {
          const placement = getPointPlacementFromEvent(ev);
          if (placement) {
            renderer.domElement.style.cursor = 'copy';
            renderPointGhost(placement.room, placement.pos);
            setLiveMeasure(
              `${POINT_CATEGORY_LABELS[cat]} (${PHASE_META[phase].shortLabel}) · ${placement.surfaceLabel}`,
            );
          } else {
            renderer.domElement.style.cursor = 'grab';
            clearGhost();
            setLiveMeasure(null);
          }
          return;
        }

        if (curMode === 'panel') {
          const placement = getPanelPlacementFromEvent(ev);
          if (placement) {
            renderer.domElement.style.cursor = 'copy';
            renderPanelGhost(placement.room, placement.pos);
            setLiveMeasure(`Tableau · ${placement.surfaceLabel}`);
          } else {
            renderer.domElement.style.cursor = 'grab';
            clearGhost();
            setLiveMeasure(null);
          }
          return;
        }

        clearGhost();
        updatePointer(ev);
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(state.pickables, false);
        renderer.domElement.style.cursor = hits.length > 0 ? 'pointer' : 'grab';
        return;
      }

      if (activeDrag.type !== 'draw' && !dragSnapshotTaken) {
        if (Math.hypot(ev.clientX - pointerDownScreen.x, ev.clientY - pointerDownScreen.y) < 3) {
          return;
        }
        dragSnapshotTaken = true;
        propsRef.current.onInteractionStart?.();
      }

      if (activeDrag.type === 'move-panel') {
        const { panel, room, pos } = activeDrag;
        updatePointer(ev);
        raycaster.setFromCamera(pointer, camera);
        const wallTarget = resolveWallDragTarget(raycaster.ray, room, pos.wall);
        if (wallTarget) {
          const nextPos = computeSnappedPanelOnWall(
            room,
            wallTarget.wall,
            wallTarget.point,
            step,
            mag,
          );
          activeDrag.pos = nextPos;
          setLiveMeasure(
            `${panel.nom} · Mur ${WALL_LABELS[wallTarget.wall]} · h ${nextPos.y.toFixed(1)} m`,
          );
          propsRef.current.onUpdatePanelPosition?.(panel.element_id, nextPos);
        }
        return;
      }

      if (activeDrag.type === 'move-point') {
        const { point, room, pos } = activeDrag;
        updatePointer(ev);
        raycaster.setFromCamera(pointer, camera);

        if (point.categorie === 'lumiere' && !pos.wall) {
          _groundPlane.constant = -(room.y + room.hauteur);
          if (raycaster.ray.intersectPlane(_groundPlane, _rayHit)) {
            const insideX = Math.abs(_rayHit.x - room.x) <= room.largeur / 2 + 0.12;
            const insideZ = Math.abs(_rayHit.z - room.z) <= room.profondeur / 2 + 0.12;
            if (insideX && insideZ) {
              const nextPos = computeSnappedPointOnCeiling(room, _rayHit, step, mag);
              activeDrag.pos = nextPos;
              setLiveMeasure(
                `${point.nom} · Plafond (${nextPos.x.toFixed(1)}, ${nextPos.z.toFixed(1)})`,
              );
              updatePointPos(point.point_id, nextPos);
              return;
            }
          }
          // Si glissé hors du plafond sur un mur, basculer sur ce mur
          const wallTarget = resolveWallDragTarget(raycaster.ray, room, undefined);
          if (wallTarget) {
            const nextPos = computeSnappedPointOnWall(
              room,
              wallTarget.wall,
              wallTarget.point,
              point.categorie,
              step,
              mag,
            );
            activeDrag.pos = nextPos;
            setLiveMeasure(
              `${point.nom} · Mur ${WALL_LABELS[wallTarget.wall]} · h ${nextPos.y.toFixed(1)} m`,
            );
            updatePointPos(point.point_id, nextPos);
          }
          return;
        }

        const wallTarget = resolveWallDragTarget(raycaster.ray, room, pos.wall);
        if (wallTarget) {
          // Si une applique murale est glissée nettement sur le plafond, la passer au plafond
          if (
            point.categorie === 'lumiere' &&
            wallTarget.point.y > room.y + room.hauteur + 0.15
          ) {
            _groundPlane.constant = -(room.y + room.hauteur);
            if (raycaster.ray.intersectPlane(_groundPlane, _rayHit)) {
              const insideX = Math.abs(_rayHit.x - room.x) <= room.largeur / 2 - 0.15;
              const insideZ = Math.abs(_rayHit.z - room.z) <= room.profondeur / 2 - 0.15;
              if (insideX && insideZ) {
                const nextPos = computeSnappedPointOnCeiling(room, _rayHit, step, mag);
                activeDrag.pos = nextPos;
                setLiveMeasure(
                  `${point.nom} · Plafond (${nextPos.x.toFixed(1)}, ${nextPos.z.toFixed(1)})`,
                );
                updatePointPos(point.point_id, nextPos);
                return;
              }
            }
          }

          const nextPos = computeSnappedPointOnWall(
            room,
            wallTarget.wall,
            wallTarget.point,
            point.categorie,
            step,
            mag,
          );
          activeDrag.pos = nextPos;
          setLiveMeasure(
            `${point.nom} · Mur ${WALL_LABELS[wallTarget.wall]} · h ${nextPos.y.toFixed(1)} m`,
          );
          updatePointPos(point.point_id, nextPos);
        }
        return;
      }

      if (activeDrag.type === 'move-opening') {
        updatePointer(ev);
        raycaster.setFromCamera(pointer, camera);
        const wallTarget = resolveWallDragTarget(
          raycaster.ray,
          activeDrag.room,
          activeDrag.opening.wall,
        );
        if (wallTarget) {
          const { offset, centered } = computeSnappedOpeningOffset(
            activeDrag.room,
            wallTarget.wall,
            wallTarget.point,
            activeDrag.opening.width,
            step,
            mag,
          );
          const sillHeight =
            activeDrag.opening.type === 'fenetre'
              ? computeSnappedOpeningSill(
                  activeDrag.room,
                  wallTarget.point.y,
                  activeDrag.opening.height,
                  mag,
                )
              : 0;
          const updated = {
            ...activeDrag.opening,
            wall: wallTarget.wall,
            offset,
            sillHeight,
          };
          activeDrag.opening = updated;
          const label = updated.type === 'porte' ? 'Porte' : 'Fenêtre';
          setLiveMeasure(
            `${label} · Mur ${WALL_LABELS[updated.wall]} · ${
              centered ? 'Centré' : `${offset > 0 ? '+' : ''}${offset.toFixed(2)} m`
            }${updated.type === 'fenetre' ? ` · Allège ${sillHeight.toFixed(1)} m` : ''}`,
          );
          updateOpening(updated);
        }
        return;
      }

      if (activeDrag.type === 'resize-h') {
        const dy = (activeDrag.startClientY - ev.clientY) * 0.02;
        const nextH = Math.max(1.5, Math.min(6, snap(activeDrag.startH + dy, 0.1)));
        const updated = { ...activeDrag.room, hauteur: Number(nextH.toFixed(2)) };
        setLiveMeasure(`Hauteur : ${updated.hauteur.toFixed(1)} m`);
        updateRoom(updated);
        return;
      }

      if (activeDrag.type === 'cable-elevation') {
        const drag = activeDrag;
        const peerYs: number[] = [];
        state.cableRouteMetaMap.forEach((m, key) => {
          if (key === drag.routeKey) return;
          m.waypoints.forEach((w) => peerYs.push(w.y));
        });
        const dy = (drag.startClientY - ev.clientY) * 0.02;
        const snapped = snapCableY(
          drag.baseY + dy,
          curRooms,
          drag.pOut,
          drag.cOut,
          peerYs,
          mag,
        );
        const deltaY = snapped.y - drag.baseY;
        const nextWps = drag.startWaypoints.map((w) => ({
          ...w,
          y: Number(Math.max(-1.5, Math.min(10, w.y + deltaY)).toFixed(2)),
        }));
        drag.lastWaypoints = nextWps;
        setLiveMeasure(
          `${drag.label} · h ${snapped.y.toFixed(2)} m${snapped.snapLabel ? ` · ${snapped.snapLabel}` : ''}`,
        );
        propsRef.current.onUpdateCableRoute?.(drag.routeKey, nextWps, false);
        return;
      }

      if (activeDrag.type === 'cable-corner') {
        const drag = activeDrag;
        const hit = hitAtElevation(ev, drag.fixedY);
        if (!hit) return;
        const peerXs: number[] = [];
        const peerZs: number[] = [];
        state.cableRouteMetaMap.forEach((m, key) => {
          if (key === drag.routeKey) return;
          m.waypoints.forEach((w) => {
            peerXs.push(w.x);
            peerZs.push(w.z);
          });
        });
        const snapped = snapCableXZ(
          hit.x,
          hit.z,
          curRooms,
          drag.pOut,
          drag.cOut,
          peerXs,
          peerZs,
          step,
          mag,
        );
        renderGuides(snapped.guideX, snapped.guideZ, drag.fixedY);
        const nextWps = drag.startWaypoints.map((w, idx) =>
          idx === drag.wpIndex ? { x: snapped.x, y: drag.fixedY, z: snapped.z } : { ...w },
        );
        drag.lastWaypoints = nextWps;
        setLiveMeasure(
          `${drag.label} · (${snapped.x.toFixed(2)}, ${snapped.z.toFixed(2)})${snapped.snapLabel ? ` · ${snapped.snapLabel}` : ''}`,
        );
        propsRef.current.onUpdateCableRoute?.(drag.routeKey, nextWps, false);
        return;
      }

      if (activeDrag.type === 'cable-segment') {
        const drag = activeDrag;
        const hit = hitAtElevation(ev, drag.fixedY);
        if (!hit) return;
        const peerXs: number[] = [];
        const peerZs: number[] = [];
        state.cableRouteMetaMap.forEach((m, key) => {
          if (key === drag.routeKey) return;
          m.waypoints.forEach((w) => {
            peerXs.push(w.x);
            peerZs.push(w.z);
          });
        });
        const snapped = snapCableXZ(
          drag.axis === 'z' ? hit.x : drag.midX,
          drag.axis === 'x' ? hit.z : drag.midZ,
          curRooms,
          drag.pOut,
          drag.cOut,
          peerXs,
          peerZs,
          step,
          mag,
        );
        const nextWps = drag.startWaypoints.map((w, idx) => {
          if (idx !== drag.idxA && idx !== drag.idxB) return { ...w };
          return drag.axis === 'x' ? { ...w, z: snapped.z } : { ...w, x: snapped.x };
        });
        renderGuides(
          drag.axis === 'z' ? snapped.guideX : null,
          drag.axis === 'x' ? snapped.guideZ : null,
          drag.fixedY,
        );
        drag.lastWaypoints = nextWps;
        const coordText =
          drag.axis === 'x' ? `Z = ${snapped.z.toFixed(2)} m` : `X = ${snapped.x.toFixed(2)} m`;
        setLiveMeasure(
          `${drag.label} · ${coordText}${snapped.snapLabel ? ` · ${snapped.snapLabel}` : ''}`,
        );
        propsRef.current.onUpdateCableRoute?.(drag.routeKey, nextWps, false);
        return;
      }

      const targetElevation = activeDrag.type === 'draw' ? workY : activeDrag.room.y;
      const hit = hitAtElevation(ev, targetElevation);
      if (!hit) return;

      if (activeDrag.type === 'draw') {
        const walls = collectOtherWallPlanes(curRooms);
        const cx = snapCoordToWalls(hit.x, walls.xs, step, mag);
        const cz = snapCoordToWalls(hit.z, walls.zs, step, mag);
        const minX = Math.min(activeDrag.startX, cx.value);
        const maxX = Math.max(activeDrag.startX, cx.value);
        const minZ = Math.min(activeDrag.startZ, cz.value);
        const maxZ = Math.max(activeDrag.startZ, cz.value);
        const largeur = Math.max(step, Number((maxX - minX).toFixed(2)));
        const profondeur = Math.max(step, Number((maxZ - minZ).toFixed(2)));
        drawRect = {
          x: Number((minX + largeur / 2).toFixed(2)),
          z: Number((minZ + profondeur / 2).toFixed(2)),
          largeur,
          profondeur,
        };
        renderRoomGhost({ ...drawRect, y: workY });
        renderGuides(cx.snappedTo, cz.snappedTo, workY);
        const connectedBat = findConnectedBuilding(
          {
            x: drawRect.x,
            y: workY,
            z: drawRect.z,
            largeur,
            profondeur,
            hauteur: 2.6,
          },
          curRooms,
        );
        const batHint = connectedBat
          ? ` → ${connectedBat.buildingName}`
          : curRooms.length > 0
            ? ` · Nouveau : ${getNextBuildingMeta(curRooms).buildingName}`
            : '';
        setLiveMeasure(
          `${largeur.toFixed(1)} m × ${profondeur.toFixed(1)} m${cx.snappedTo !== null || cz.snappedTo !== null ? ' · Aimanté' : ''}${batHint}`,
        );
        return;
      }

      const otherWalls = collectOtherWallPlanes(curRooms, activeDrag.room.zone_id);

      if (activeDrag.type === 'move') {
        const snapped = snapRoomMoveToWalls(
          hit.x - activeDrag.offsetX,
          hit.z - activeDrag.offsetZ,
          activeDrag.room.largeur,
          activeDrag.room.profondeur,
          otherWalls,
          step,
          mag,
        );
        renderGuides(snapped.guideX, snapped.guideZ, activeDrag.room.y);
        const isSnapped = snapped.guideX !== null || snapped.guideZ !== null;
        const connectedBat = findConnectedBuilding(
          { ...activeDrag.room, x: snapped.x, z: snapped.z },
          curRooms,
          activeDrag.room.zone_id,
        );
        const batHint =
          connectedBat && connectedBat.buildingId !== activeDrag.room.buildingId
            ? ` · → ${connectedBat.buildingName}`
            : '';
        setLiveMeasure(
          `${
            isSnapped
              ? `Collé bord à bord · (${snapped.x.toFixed(2)}, ${snapped.z.toFixed(2)})`
              : `Position : (${snapped.x.toFixed(1)}, ${snapped.z.toFixed(1)})`
          }${batHint}`,
        );
        updateRoom({ ...activeDrag.room, x: snapped.x, z: snapped.z });
        return;
      }

      if (activeDrag.type === 'resize-x+') {
        const sx = snapCoordToWalls(hit.x, otherWalls.xs, step, mag);
        const maxX = Math.max(activeDrag.anchorMinX + 0.5, sx.value);
        const largeur = Number((maxX - activeDrag.anchorMinX).toFixed(2));
        const x = Number((activeDrag.anchorMinX + largeur / 2).toFixed(2));
        renderGuides(sx.snappedTo, null, activeDrag.room.y);
        setLiveMeasure(
          `${largeur.toFixed(1)} m × ${activeDrag.room.profondeur.toFixed(1)} m${sx.snappedTo !== null ? ' · Aimanté' : ''}`,
        );
        updateRoom({ ...activeDrag.room, x, largeur });
      } else if (activeDrag.type === 'resize-x-') {
        const sx = snapCoordToWalls(hit.x, otherWalls.xs, step, mag);
        const minX = Math.min(activeDrag.anchorMaxX - 0.5, sx.value);
        const largeur = Number((activeDrag.anchorMaxX - minX).toFixed(2));
        const x = Number((minX + largeur / 2).toFixed(2));
        renderGuides(sx.snappedTo, null, activeDrag.room.y);
        setLiveMeasure(
          `${largeur.toFixed(1)} m × ${activeDrag.room.profondeur.toFixed(1)} m${sx.snappedTo !== null ? ' · Aimanté' : ''}`,
        );
        updateRoom({ ...activeDrag.room, x, largeur });
      } else if (activeDrag.type === 'resize-z+') {
        const sz = snapCoordToWalls(hit.z, otherWalls.zs, step, mag);
        const maxZ = Math.max(activeDrag.anchorMinZ + 0.5, sz.value);
        const profondeur = Number((maxZ - activeDrag.anchorMinZ).toFixed(2));
        const z = Number((activeDrag.anchorMinZ + profondeur / 2).toFixed(2));
        renderGuides(null, sz.snappedTo, activeDrag.room.y);
        setLiveMeasure(
          `${activeDrag.room.largeur.toFixed(1)} m × ${profondeur.toFixed(1)} m${sz.snappedTo !== null ? ' · Aimanté' : ''}`,
        );
        updateRoom({ ...activeDrag.room, z, profondeur });
      } else if (activeDrag.type === 'resize-z-') {
        const sz = snapCoordToWalls(hit.z, otherWalls.zs, step, mag);
        const minZ = Math.min(activeDrag.anchorMaxZ - 0.5, sz.value);
        const profondeur = Number((activeDrag.anchorMaxZ - minZ).toFixed(2));
        const z = Number((minZ + profondeur / 2).toFixed(2));
        renderGuides(null, sz.snappedTo, activeDrag.room.y);
        setLiveMeasure(
          `${activeDrag.room.largeur.toFixed(1)} m × ${profondeur.toFixed(1)} m${sz.snappedTo !== null ? ' · Aimanté' : ''}`,
        );
        updateRoom({ ...activeDrag.room, z, profondeur });
      }
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (activeDrag) {
        renderGuides(null, null, propsRef.current.workElevation);
        if (activeDrag.type === 'draw' && drawRect) {
          renderRoomGhost(null);
          propsRef.current.onCreateRoom({
            x: drawRect.x,
            y: propsRef.current.workElevation,
            z: drawRect.z,
            largeur: Math.max(0.5, drawRect.largeur),
            profondeur: Math.max(0.5, drawRect.profondeur),
            hauteur: 2.6,
          });
        } else if (
          dragSnapshotTaken &&
          (activeDrag.type === 'move' ||
            activeDrag.type === 'resize-x+' ||
            activeDrag.type === 'resize-x-' ||
            activeDrag.type === 'resize-z+' ||
            activeDrag.type === 'resize-z-')
        ) {
          propsRef.current.onRoomTransformEnd?.(activeDrag.room.zone_id);
        } else if (
          activeDrag.type === 'cable-corner' ||
          activeDrag.type === 'cable-segment' ||
          activeDrag.type === 'cable-elevation'
        ) {
          if (dragSnapshotTaken && activeDrag.lastWaypoints) {
            propsRef.current.onUpdateCableRoute?.(
              activeDrag.routeKey,
              simplifyCableWaypoints(activeDrag.lastWaypoints),
              false,
            );
          } else if (!dragSnapshotTaken) {
            const meta = state.cableRouteMetaMap.get(activeDrag.routeKey);
            if (meta) {
              propsRef.current.onSelectRoom(meta.roomId);
              propsRef.current.onSelectOpening(null);
              if (meta.kind === 'point') {
                propsRef.current.onSelectPanel?.(null);
                propsRef.current.onSelectPoint(meta.targetId);
              } else {
                propsRef.current.onSelectPoint(null);
                propsRef.current.onSelectPanel?.(meta.targetId);
              }
            }
          }
        }
        activeDrag = null;
        dragSnapshotTaken = false;
        drawRect = null;
        controls.enabled = true;
        setLiveMeasure(null);
        return;
      }

      const dist = Math.hypot(ev.clientX - pointerDownScreen.x, ev.clientY - pointerDownScreen.y);
      if (dist > 6) return;

      const curMode = propsRef.current.mode;
      if (curMode === 'door' || curMode === 'window') {
        const opType: OpeningType = curMode === 'door' ? 'porte' : 'fenetre';
        const placement = getOpeningPlacementFromEvent(ev, opType);
        if (placement) {
          propsRef.current.onCreateOpening({
            zone_id: placement.room.zone_id,
            type: opType,
            wall: placement.wall,
            offset: placement.offset,
            width: opType === 'porte' ? 0.9 : 1.2,
            height: opType === 'porte' ? 2.05 : 1.15,
            sillHeight: placement.sillHeight,
          });
          clearGhost();
          setLiveMeasure(null);
          return;
        }

        updatePointer(ev);
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(state.pickables, false);
        const floorHit = hits.find((h) => h.object.userData?.kind === 'room-floor');
        if (floorHit) {
          propsRef.current.onSelectOpening(null);
          propsRef.current.onSelectPoint(null);
          propsRef.current.onSelectRoom(String(floorHit.object.userData.roomId));
        }
        return;
      }

      if (curMode === 'point') {
        const placement = getPointPlacementFromEvent(ev);
        if (placement) {
          propsRef.current.onCreatePoint(placement.room.zone_id, placement.pos);
          clearGhost();
          setLiveMeasure(null);
          return;
        }

        updatePointer(ev);
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(state.pickables, false);
        const floorHit = hits.find((h) => h.object.userData?.kind === 'room-floor');
        if (floorHit) {
          propsRef.current.onSelectOpening(null);
          propsRef.current.onSelectPoint(null);
          propsRef.current.onSelectPanel?.(null);
          propsRef.current.onSelectRoom(String(floorHit.object.userData.roomId));
        }
        return;
      }

      if (curMode === 'panel') {
        const placement = getPanelPlacementFromEvent(ev);
        if (placement) {
          propsRef.current.onCreatePanel?.(placement.room.zone_id, placement.pos);
          clearGhost();
          setLiveMeasure(null);
          return;
        }

        updatePointer(ev);
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(state.pickables, false);
        const floorHit = hits.find((h) => h.object.userData?.kind === 'room-floor');
        if (floorHit) {
          propsRef.current.onSelectOpening(null);
          propsRef.current.onSelectPoint(null);
          propsRef.current.onSelectPanel?.(null);
          propsRef.current.onSelectRoom(String(floorHit.object.userData.roomId));
        }
        return;
      }

      if (curMode === 'select') {
        updatePointer(ev);
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(state.pickables, false);

        const panelHit = hits.find((h) => h.object.userData?.kind === 'elec-panel');
        if (panelHit) {
          setSelectedCableKey(null);
          propsRef.current.onSelectRoom(String(panelHit.object.userData.roomId));
          propsRef.current.onSelectOpening(null);
          propsRef.current.onSelectPoint(null);
          propsRef.current.onSelectPanel?.(String(panelHit.object.userData.panelId));
          return;
        }

        const pointHit = hits.find((h) => h.object.userData?.kind === 'elec-point');
        if (pointHit) {
          setSelectedCableKey(null);
          propsRef.current.onSelectRoom(String(pointHit.object.userData.roomId));
          propsRef.current.onSelectOpening(null);
          propsRef.current.onSelectPanel?.(null);
          propsRef.current.onSelectPoint(String(pointHit.object.userData.pointId));
          return;
        }

        if (propsRef.current.workspace === 'construction') {
          const openingHit = hits.find((h) => h.object.userData?.kind === 'opening');
          if (openingHit) {
            setSelectedCableKey(null);
            propsRef.current.onSelectRoom(String(openingHit.object.userData.roomId));
            propsRef.current.onSelectPoint(null);
            propsRef.current.onSelectPanel?.(null);
            propsRef.current.onSelectOpening(String(openingHit.object.userData.openingId));
            return;
          }
          const cableHit = hits.find((h) => h.object.userData?.kind === 'cable-segment');
          if (cableHit) {
            const { routeKey } = cableHit.object.userData as { routeKey: string };
            setSelectedCableKey(routeKey);
            const meta = state.cableRouteMetaMap.get(routeKey);
            if (meta) {
              propsRef.current.onSelectRoom(meta.roomId);
              propsRef.current.onSelectOpening(null);
              if (meta.kind === 'point') {
                propsRef.current.onSelectPanel?.(null);
                propsRef.current.onSelectPoint(meta.targetId);
              } else {
                propsRef.current.onSelectPoint(null);
                propsRef.current.onSelectPanel?.(meta.targetId);
              }
            }
            return;
          }
        }

        const floorHit = hits.find((h) => h.object.userData?.kind === 'room-floor');
        if (floorHit) {
          setSelectedCableKey(null);
          propsRef.current.onSelectOpening(null);
          propsRef.current.onSelectPoint(null);
          propsRef.current.onSelectPanel?.(null);
          propsRef.current.onSelectRoom(String(floorHit.object.userData.roomId));
        } else if (hits.length === 0) {
          setSelectedCableKey(null);
          propsRef.current.onSelectOpening(null);
          propsRef.current.onSelectPoint(null);
          propsRef.current.onSelectPanel?.(null);
          propsRef.current.onSelectRoom(null);
        }
      }
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && propsRef.current.mode !== 'select') {
        clearGhost();
        setLiveMeasure(null);
        propsRef.current.onModeChange?.('select');
      }
    };

    const dom = renderer.domElement;
    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDown);

    const ro = new ResizeObserver(() => {
      const nw = Math.max(320, mount.clientWidth);
      const nh = Math.max(240, mount.clientHeight);
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
      requestRender();
    });
    ro.observe(mount);

    requestRender();

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      ro.disconnect();
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      controls.dispose();
      disposeTree(roomsGroup);
      disposeTree(circuitGroup);
      disposeTree(ghostGroup);
      disposeTree(guideGroup);
      scene.environment?.dispose();
      renderer.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;

    s.grid.position.y = workElevation - 0.005;

    disposeTree(s.roomsGroup);
    s.roomsGroup.clear();
    disposeTree(s.circuitGroup);
    s.circuitGroup.clear();
    s.pickables = [];
    s.wallPickables = [];
    s.ceilingPickables = [];
    s.cableRouteMetaMap.clear();
    s.selectedFloorMesh = null;

    const isReadOnly = workspace === 'exploitation';

    // Calcul de la surbrillance bidirectionnelle disjoncteur <-> points électriques
    const roomsById = new Map(rooms.map((r) => [r.zone_id, r]));
    const panelsById = new Map(panels.map((p) => [p.element_id, p]));
    const breakersById = new Map(breakers.map((b) => [b.element_id, b]));

    const activeBreaker = selectedBreakerId ? breakersById.get(selectedBreakerId) ?? null : null;
    const selectedPointObj = selectedPointId
      ? points.find((pt) => pt.point_id === selectedPointId) ?? null
      : null;
    const pointBreaker =
      !activeBreaker && selectedPointObj?.disjoncteur_id
        ? breakersById.get(selectedPointObj.disjoncteur_id) ?? null
        : null;

    const effectiveBreaker = activeBreaker ?? pointBreaker;
    const isolateCircuit = Boolean(activeBreaker);

    const highlightedPanelIds = new Set<string>();
    if (effectiveBreaker) {
      highlightedPanelIds.add(effectiveBreaker.parent_id);
      panels.forEach((sp) => {
        if (sp.parent_id === effectiveBreaker.element_id) {
          highlightedPanelIds.add(sp.element_id);
        }
      });
    } else if (selectedPanelId) {
      highlightedPanelIds.add(selectedPanelId);
      const selPanel = panelsById.get(selectedPanelId);
      if (selPanel?.parent_id) {
        const pInfo = findParentPanelForId(selPanel.parent_id, panelsById, breakersById);
        if (pInfo) highlightedPanelIds.add(pInfo.parentPanel.element_id);
      }
      getDirectSubPanelsOfPanel(selectedPanelId, panels, breakers).forEach((sub) => {
        highlightedPanelIds.add(sub.panel.element_id);
      });
    }

    let circuitHighlightPointIds: Set<string> | null = null;
    if (effectiveBreaker) {
      circuitHighlightPointIds = new Set(
        points
          .filter((pt) => pt.disjoncteur_id === effectiveBreaker.element_id)
          .map((pt) => pt.point_id),
      );
    }

    // Périmètres multi-bâtiments au sol
    const buildings = getBuildingSummaries(rooms);
    if (buildings.length > 1) {
      const selectedRoomObj = selectedRoomId ? roomsById.get(selectedRoomId) : null;
      const activeBuildingId = selectedRoomObj?.buildingId ?? null;
      for (const bat of buildings) {
        s.roomsGroup.add(
          buildBuildingPerimeterGroup(
            bat.buildingName,
            bat.rooms,
            activeBuildingId === bat.buildingId,
            s.maxAnisotropy,
          ),
        );
      }
    }

    const roomTones = computeFourColorRoomTones(rooms);

    for (const room of rooms) {
      const isGhostLevel = levelFilter === 'active' && Math.abs(room.y - workElevation) > 0.6;
      const isSelected = room.zone_id === selectedRoomId && !isGhostLevel;
      const roomOpenings = openings.filter((o) => o.zone_id === room.zone_id);
      const roomPoints = points.filter((p) => p.zone_id === room.zone_id);
      const roomPanels = panels.filter((p) => p.zone_id === room.zone_id);
      const grp = buildRoomGroup(
        room,
        roomOpenings,
        roomPoints,
        pointPositions,
        roomPanels,
        panelPositions,
        isSelected,
        selectedOpeningId,
        selectedPointId,
        selectedPanelId,
        circuitHighlightPointIds,
        isolateCircuit,
        highlightedPanelIds.size > 0 ? highlightedPanelIds : null,
        isolateCircuit,
        phaseFilter,
        isGhostLevel,
        s.maxAnisotropy,
        roomTones.get(room.zone_id) ?? FOUR_COLOR_ROOM_PALETTE[0],
      );
      s.roomsGroup.add(grp);
      if (!isGhostLevel) {
        grp.traverse((child) => {
          const kind = child.userData?.kind;
          if (isReadOnly && kind === 'handle') {
            child.visible = false;
            return;
          }
          if (
            kind === 'room-floor' ||
            kind === 'handle' ||
            kind === 'opening' ||
            kind === 'elec-point' ||
            kind === 'elec-panel'
          ) {
            s.pickables.push(child);
            if (kind === 'room-floor' && isSelected) {
              s.selectedFloorMesh = child;
            }
          } else if (kind === 'wall') {
            s.wallPickables.push(child);
          } else if (kind === 'ceiling') {
            s.ceilingPickables.push(child);
          }
        });
      }
    }

    // Tracés schématiques 3D épais entre le tableau amont et les points du disjoncteur actif
    if (effectiveBreaker) {
      const feederPanel = panelsById.get(effectiveBreaker.parent_id);
      const panelRoom = feederPanel ? roomsById.get(feederPanel.zone_id) : undefined;
      if (feederPanel && panelRoom) {
        const panelLocal = getPanelLocalAndNormal(
          panelRoom,
          panelPositions[feederPanel.element_id] ?? getDefaultPanelPos(panelRoom),
        );
        const panelWorld = new THREE.Vector3(
          panelRoom.x + panelLocal.lx,
          panelRoom.y + panelLocal.ly,
          panelRoom.z + panelLocal.lz,
        );
        const panelOut = panelWorld.clone().addScaledVector(panelLocal.normal, 0.16);
        const traceHex = BOARD_PHASE_META[effectiveBreaker.phases].hex;

        const targetPoints = points.filter(
          (pt) => pt.disjoncteur_id === effectiveBreaker.element_id,
        );

        // Jalon visuel sur le coffret amont
        const hubDot = new THREE.Mesh(
          new THREE.SphereGeometry(0.072, 14, 12),
          new THREE.MeshBasicMaterial({ color: traceHex }),
        );
        hubDot.position.copy(panelOut);
        s.circuitGroup.add(hubDot);

        for (const pt of targetPoints) {
          const ptRoom = roomsById.get(pt.zone_id);
          if (!ptRoom) continue;
          const ptPos = pointPositions[pt.point_id] ?? { x: 0, y: 0.35, z: 0 };
          const ptLocal = getPointLocalAndNormal(ptRoom, pt, ptPos);
          const ptWorld = new THREE.Vector3(
            ptRoom.x + ptLocal.lx,
            ptRoom.y + ptLocal.ly,
            ptRoom.z + ptLocal.lz,
          );
          const ptOut = ptWorld.clone().addScaledVector(ptLocal.normal, 0.12);

          const isPrimary = activeBreaker ? true : pt.point_id === selectedPointId;
          const routeKey = `point:${pt.point_id}`;
          const defaultWps = getDefaultPointCableWaypoints(
            panelOut,
            ptOut,
            ptRoom.zone_id === panelRoom.zone_id,
            panelRoom.y + panelRoom.hauteur,
          );
          const customWps = cableRoutes[routeKey];
          const activeWps = customWps && customWps.length > 0 ? customWps : defaultWps;

          const path = buildOrthogonalCablePoints(panelWorld, panelOut, ptOut, ptWorld, activeWps);
          s.cableRouteMetaMap.set(routeKey, {
            routeKey,
            kind: 'point',
            targetId: pt.point_id,
            roomId: pt.zone_id,
            label: pt.nom,
            pOut: panelOut.clone(),
            cOut: ptOut.clone(),
            waypoints: activeWps.map((w) => ({ ...w })),
            defaultWaypoints: defaultWps,
            isCustom: Boolean(customWps && customWps.length > 0),
          });

          addThickCablePath(
            s.circuitGroup,
            path,
            traceHex,
            isPrimary ? 0.025 : 0.015,
            isPrimary ? 0.94 : 0.38,
            { routeKey, label: pt.nom },
          );
        }
      }
    }

    // Liaisons d'alimentation tableau -> sous-tableau (y compris inter-bâtiments enterrées)
    for (const childPanel of panels) {
      if (!childPanel.parent_id) continue;
      const parentInfo = findParentPanelForId(childPanel.parent_id, panelsById, breakersById);
      if (!parentInfo) continue;

      const parentPanel = parentInfo.parentPanel;
      const feederBreaker = parentInfo.feederBreaker;
      const parentRoom = roomsById.get(parentPanel.zone_id);
      const childRoom = roomsById.get(childPanel.zone_id);
      if (!parentRoom || !childRoom) continue;

      const pLocal = getPanelLocalAndNormal(
        parentRoom,
        panelPositions[parentPanel.element_id] ?? getDefaultPanelPos(parentRoom),
      );
      const pWorld = new THREE.Vector3(
        parentRoom.x + pLocal.lx,
        parentRoom.y + pLocal.ly,
        parentRoom.z + pLocal.lz,
      );
      const pOut = pWorld.clone().addScaledVector(pLocal.normal, 0.18);

      const cLocal = getPanelLocalAndNormal(
        childRoom,
        panelPositions[childPanel.element_id] ?? getDefaultPanelPos(childRoom),
      );
      const cWorld = new THREE.Vector3(
        childRoom.x + cLocal.lx,
        childRoom.y + cLocal.ly,
        childRoom.z + cLocal.lz,
      );
      const cOut = cWorld.clone().addScaledVector(cLocal.normal, 0.18);

      const isActiveBreakerFeeder =
        Boolean(effectiveBreaker) && feederBreaker?.element_id === effectiveBreaker?.element_id;
      const isSelectedPanelLink =
        !effectiveBreaker &&
        Boolean(selectedPanelId) &&
        (selectedPanelId === childPanel.element_id || selectedPanelId === parentPanel.element_id);

      const isPrimaryFeeder = isActiveBreakerFeeder || isSelectedPanelLink;
      const feederPhase = feederBreaker?.phases ?? childPanel.phases;
      const feederHex = BOARD_PHASE_META[feederPhase].hex;

      const crossBuilding =
        (parentRoom.buildingId || 'BAT_1') !== (childRoom.buildingId || 'BAT_1');
      const routeKey = `panel:${childPanel.element_id}`;
      const defaultWps = getDefaultPanelCableWaypoints(
        pOut,
        cOut,
        childRoom.zone_id === parentRoom.zone_id,
        crossBuilding,
        parentRoom.y + parentRoom.hauteur,
        Math.min(parentRoom.y, childRoom.y),
      );
      const customWps = cableRoutes[routeKey];
      const activeWps = customWps && customWps.length > 0 ? customWps : defaultWps;

      const feederPath = buildOrthogonalCablePoints(pWorld, pOut, cOut, cWorld, activeWps);
      s.cableRouteMetaMap.set(routeKey, {
        routeKey,
        kind: 'panel',
        targetId: childPanel.element_id,
        roomId: childPanel.zone_id,
        label: childPanel.nom,
        pOut: pOut.clone(),
        cOut: cOut.clone(),
        waypoints: activeWps.map((w) => ({ ...w })),
        defaultWaypoints: defaultWps,
        isCustom: Boolean(customWps && customWps.length > 0),
      });

      const feederOpacity = effectiveBreaker
        ? isActiveBreakerFeeder
          ? 0.94
          : 0.18
        : isSelectedPanelLink
          ? 0.92
          : 0.48;
      const feederRadius = isPrimaryFeeder ? 0.036 : 0.016;

      addThickCablePath(s.circuitGroup, feederPath, feederHex, feederRadius, feederOpacity, {
        routeKey,
        label: childPanel.nom,
      });

      if (isPrimaryFeeder) {
        const subDot = new THREE.Mesh(
          new THREE.SphereGeometry(0.068, 12, 10),
          new THREE.MeshBasicMaterial({ color: feederHex }),
        );
        subDot.position.copy(cOut);
        s.circuitGroup.add(subDot);
      }
    }

    // Poignées interactives pour déplacer le tracé des câbles en mode Construction
    const effectiveActiveCableKey =
      selectedCableKey && s.cableRouteMetaMap.has(selectedCableKey)
        ? selectedCableKey
        : selectedPointId && s.cableRouteMetaMap.has(`point:${selectedPointId}`)
          ? `point:${selectedPointId}`
          : selectedPanelId && s.cableRouteMetaMap.has(`panel:${selectedPanelId}`)
            ? `panel:${selectedPanelId}`
            : null;

    if (!isReadOnly) {
      s.circuitGroup.traverse((child) => {
        if (child.userData?.kind === 'cable-segment') {
          s.pickables.push(child);
        }
      });

      if (effectiveActiveCableKey) {
        const meta = s.cableRouteMetaMap.get(effectiveActiveCableKey);
        if (meta && meta.waypoints.length > 0) {
          const cornerMat = new THREE.MeshStandardMaterial({
            color: 0x2563eb,
            emissive: 0x1d4ed8,
            emissiveIntensity: 0.35,
            roughness: 0.3,
          });
          const insertMat = new THREE.MeshStandardMaterial({
            color: 0x4f46e5,
            emissive: 0x3730a3,
            emissiveIntensity: 0.3,
            roughness: 0.3,
          });
          const elevMat = new THREE.MeshStandardMaterial({
            color: 0x0f172a,
            emissive: 0x1e293b,
            emissiveIntensity: 0.25,
            roughness: 0.25,
          });

          meta.waypoints.forEach((wp, wpIdx) => {
            const cornerSphere = new THREE.Mesh(
              new THREE.SphereGeometry(0.085, 14, 12),
              cornerMat,
            );
            cornerSphere.position.set(wp.x, wp.y, wp.z);
            cornerSphere.userData = {
              kind: 'cable-handle',
              handleType: 'corner',
              routeKey: meta.routeKey,
              wpIndex: wpIdx,
            };
            s.circuitGroup.add(cornerSphere);
            s.pickables.push(cornerSphere);
          });

          let bestMid = {
            x: meta.waypoints[0].x,
            y: meta.waypoints[0].y,
            z: meta.waypoints[0].z,
            len: -1,
          };

          for (let i = 0; i < meta.waypoints.length - 1; i++) {
            const a = meta.waypoints[i];
            const b = meta.waypoints[i + 1];
            const distXZ = Math.hypot(b.x - a.x, b.z - a.z);
            const midX = Number(((a.x + b.x) / 2).toFixed(2));
            const midY = Number(((a.y + b.y) / 2).toFixed(2));
            const midZ = Number(((a.z + b.z) / 2).toFixed(2));

            if (distXZ > bestMid.len) {
              bestMid = { x: midX, y: midY, z: midZ, len: distXZ };
            }

            if (distXZ >= 0.75) {
              const bead = new THREE.Mesh(
                new THREE.SphereGeometry(0.06, 12, 10),
                insertMat,
              );
              bead.position.set(midX, midY, midZ);
              bead.userData = {
                kind: 'cable-handle',
                handleType: 'insert-corner',
                routeKey: meta.routeKey,
                insertIndex: i + 1,
                mid: { x: midX, y: midY, z: midZ },
              };
              s.circuitGroup.add(bead);
              s.pickables.push(bead);
            }
          }

          const stem = new THREE.Mesh(
            new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8),
            elevMat,
          );
          stem.position.set(bestMid.x, bestMid.y + 0.11, bestMid.z);
          s.circuitGroup.add(stem);

          const elevHandle = new THREE.Mesh(
            new THREE.OctahedronGeometry(0.11, 0),
            elevMat,
          );
          elevHandle.position.set(bestMid.x, bestMid.y + 0.22, bestMid.z);
          elevHandle.userData = {
            kind: 'cable-handle',
            handleType: 'elevation',
            routeKey: meta.routeKey,
            baseY: bestMid.y,
          };
          s.circuitGroup.add(elevHandle);
          s.pickables.push(elevHandle);
        }
      }
    }

    const activeMeta =
      !isReadOnly && effectiveActiveCableKey
        ? s.cableRouteMetaMap.get(effectiveActiveCableKey) ?? null
        : null;
    setActiveCableSummary((prev) => {
      const next = activeMeta
        ? { routeKey: activeMeta.routeKey, label: activeMeta.label, isCustom: activeMeta.isCustom }
        : null;
      if (!prev && !next) return prev;
      if (
        prev &&
        next &&
        prev.routeKey === next.routeKey &&
        prev.label === next.label &&
        prev.isCustom === next.isCustom
      ) {
        return prev;
      }
      return next;
    });

    s.requestRender();
  }, [
    rooms,
    openings,
    points,
    pointPositions,
    panels,
    breakers,
    panelPositions,
    cableRoutes,
    selectedRoomId,
    selectedOpeningId,
    selectedPointId,
    selectedPanelId,
    selectedBreakerId,
    selectedCableKey,
    phaseFilter,
    workElevation,
    levelFilter,
    workspace,
  ]);

  useEffect(() => {
    if (workspace !== 'construction') {
      setSelectedCableKey(null);
    }
  }, [workspace, selectedBreakerId]);

  useEffect(() => {
    if (!focusRequest) return;
    const s = sceneRef.current;
    if (!s) return;

    const roomsById = new Map(rooms.map((r) => [r.zone_id, r]));
    const panelsById = new Map(panels.map((p) => [p.element_id, p]));
    const box = new THREE.Box3();
    let hasCoords = false;

    const addPanelToBox = (panelId: string) => {
      const panel = panelsById.get(panelId);
      const room = panel ? roomsById.get(panel.zone_id) : undefined;
      if (!panel || !room) return;
      const local = getPanelLocalAndNormal(
        room,
        panelPositions[panel.element_id] ?? getDefaultPanelPos(room),
      );
      box.expandByPoint(new THREE.Vector3(room.x + local.lx, room.y + local.ly, room.z + local.lz));
      hasCoords = true;
    };

    const addPointToBox = (pt: ElectricalPoint) => {
      const room = roomsById.get(pt.zone_id);
      if (!room) return;
      const local = getPointLocalAndNormal(
        room,
        pt,
        pointPositions[pt.point_id] ?? { x: 0, y: 0.35, z: 0 },
      );
      box.expandByPoint(new THREE.Vector3(room.x + local.lx, room.y + local.ly, room.z + local.lz));
      hasCoords = true;
    };

    if (focusRequest.targetPanelId) {
      addPanelToBox(focusRequest.targetPanelId);
    }
    if (focusRequest.targetBreakerId) {
      points
        .filter((pt) => pt.disjoncteur_id === focusRequest.targetBreakerId)
        .forEach(addPointToBox);
      panels
        .filter((sp) => sp.parent_id === focusRequest.targetBreakerId)
        .forEach((sp) => addPanelToBox(sp.element_id));
    }
    if (focusRequest.targetPointId) {
      const pt = points.find((p) => p.point_id === focusRequest.targetPointId);
      if (pt) addPointToBox(pt);
    }

    if (!hasCoords) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const dist = Math.min(28, Math.max(5.5, size.length() * 1.45));

    const viewDir = s.camera.position.clone().sub(s.controls.target);
    if (viewDir.lengthSq() < 0.01) viewDir.set(0.65, 0.65, 0.85);
    viewDir.normalize();
    viewDir.y = Math.max(0.38, viewDir.y);
    viewDir.normalize();

    s.cameraAnim.targetLook.copy(center);
    s.cameraAnim.targetPos.copy(center).addScaledVector(viewDir, dist);
    s.cameraAnim.active = true;
    s.requestRender();
  }, [focusRequest, panels, panelPositions, points, pointPositions, rooms]);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    if (mode !== 'door' && mode !== 'window' && mode !== 'point' && mode !== 'panel') {
      disposeTree(s.ghostGroup);
      s.ghostGroup.clear();
      setLiveMeasure(null);
      s.requestRender();
    }
  }, [mode]);

  const isConstruction = workspace === 'construction';

  const renderPhaseFilterBar = () =>
    onPhaseFilterChange ? (
      <div className="pointer-events-auto w-fit flex items-center gap-1 p-1 rounded-xl bg-white/95 border border-slate-200 shadow-xs">
        <button
          type="button"
          onClick={() => onPhaseFilterChange('TOUTES')}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0 transition-colors ${
            phaseFilter === 'TOUTES'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Toutes
        </button>
        {(['L1', 'L2', 'L3', 'INCONNU'] as PhaseCode[]).map((p) => {
          const meta = PHASE_META[p];
          const active = phaseFilter === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => onPhaseFilterChange(active ? 'TOUTES' : p)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                active ? `${meta.bgClass} text-white` : 'text-slate-700 hover:bg-slate-100'
              }`}
              title={meta.label}
            >
              <span
                className="w-2 h-2 rounded-xs shrink-0"
                style={{ backgroundColor: active ? '#ffffff' : meta.hex }}
              />
              {meta.shortLabel}
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <div className="relative w-full h-full overflow-hidden">
      <div ref={mountRef} className="w-full h-full" />

      {webglUnavailable && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#EBF0F5] p-6 text-center text-sm text-slate-700">
          WebGL indisponible sur ce navigateur.
        </div>
      )}

      {/* Mesure en direct lors d'un tracé ou glisser-déposer */}
      {liveMeasure && (
        <div className="pointer-events-none absolute top-3 left-3 z-10 w-fit px-3 py-1 rounded-lg bg-slate-900 text-white font-mono-num text-xs font-semibold shadow-sm">
          {liveMeasure}
        </div>
      )}

      {/* Pilule d'édition et réinitialisation du tracé câble actif */}
      {!liveMeasure && isConstruction && activeCableSummary && (
        <div className="pointer-events-auto absolute top-3 left-3 z-10 w-fit px-2.5 py-1.5 rounded-xl bg-white/95 border border-slate-200 shadow-sm flex items-center gap-2 text-xs">
          <span className="font-semibold text-slate-900 truncate max-w-[180px]">
            Tracé : {activeCableSummary.label}
          </span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
              activeCableSummary.isCustom
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {activeCableSummary.isCustom ? 'Personnalisé' : 'Par défaut'}
          </span>
          {activeCableSummary.isCustom && onUpdateCableRoute && (
            <button
              type="button"
              onClick={() => {
                onUpdateCableRoute(activeCableSummary.routeKey, null, true);
                setSelectedCableKey(null);
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold transition-colors"
              title="Revenir au chemin automatique par défaut"
            >
              <RotateCcw className="w-3 h-3" />
              Réinitialiser
            </button>
          )}
        </div>
      )}

      {/* Top-Right Phase Filter en mode Exploitation */}
      {!isConstruction && onPhaseFilterChange && (
        <div className="absolute top-3 right-3 z-10">{renderPhaseFilterBar()}</div>
      )}

      {/* Dock de construction (affiché uniquement en mode Construction) */}
      {isConstruction && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center max-w-[96%]">
          {/* Sélecteur rapide de phase à poser */}
          {mode === 'point' && onActivePointPhaseChange && (
            <div className="mb-1.5 px-2.5 py-1.5 rounded-xl bg-white/95 border border-slate-200 shadow-sm flex items-center gap-2">
              <span className="text-[11px] font-medium text-slate-500 whitespace-nowrap shrink-0">
                Phase :
              </span>
              <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-100">
                {(['L1', 'L2', 'L3', 'INCONNU'] as PhaseCode[]).map((ph) => {
                  const meta = PHASE_META[ph];
                  const active = activePointPhase === ph;
                  return (
                    <button
                      key={ph}
                      type="button"
                      onClick={() => onActivePointPhaseChange(ph)}
                      className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                        active ? `${meta.bgClass} text-white shadow-xs` : 'text-slate-700 hover:text-slate-950'
                      }`}
                    >
                      <span
                        className="w-2 h-2 rounded-xs shrink-0"
                        style={{ backgroundColor: active ? '#ffffff' : meta.hex }}
                      />
                      {meta.shortLabel}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setDockCollapsed((v) => !v)}
            className="mb-1 px-3 py-1 rounded-t-xl rounded-b-lg bg-white/95 border border-slate-200 shadow-xs text-[11px] font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            {dockCollapsed ? 'Afficher les outils' : 'Masquer les outils'}
            {dockCollapsed ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>

          {!dockCollapsed && onModeChange && (
            <div className="px-2 py-1.5 rounded-2xl bg-white/95 border border-slate-200 shadow-md flex flex-wrap items-center justify-center gap-1">
              <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100">
                <button
                  type="button"
                  onClick={() => onModeChange('select')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                    mode === 'select' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Hand className="w-3.5 h-3.5" />
                  Sélectionner
                </button>

                <div className="h-4 w-px bg-slate-200 mx-0.5" />

                <button
                  type="button"
                  onClick={() => onModeChange(mode === 'draw' ? 'select' : 'draw')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                    mode === 'draw' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <SquarePlus className="w-3.5 h-3.5" />
                  Pièce
                </button>
                <button
                  type="button"
                  onClick={() => onModeChange(mode === 'door' ? 'select' : 'door')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                    mode === 'door' ? 'bg-amber-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <DoorOpen className="w-3.5 h-3.5" />
                  Porte
                </button>
                <button
                  type="button"
                  onClick={() => onModeChange(mode === 'window' ? 'select' : 'window')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                    mode === 'window' ? 'bg-sky-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <AppWindow className="w-3.5 h-3.5" />
                  Fenêtre
                </button>

                <div className="h-4 w-px bg-slate-200 mx-0.5" />

                <button
                  type="button"
                  onClick={() => {
                    if (mode === 'point' && activePointCategory === 'prise') {
                      onModeChange('select');
                    } else {
                      onActivePointCategoryChange?.('prise');
                      onModeChange('point');
                    }
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                    mode === 'point' && activePointCategory === 'prise'
                      ? 'bg-rose-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <PlugZap className="w-3.5 h-3.5" />
                  Prise
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (mode === 'point' && activePointCategory === 'lumiere') {
                      onModeChange('select');
                    } else {
                      onActivePointCategoryChange?.('lumiere');
                      onModeChange('point');
                    }
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                    mode === 'point' && activePointCategory === 'lumiere'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Lightbulb className="w-3.5 h-3.5" />
                  Lumière
                </button>
                <button
                  type="button"
                  onClick={() => onModeChange(mode === 'panel' ? 'select' : 'panel')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                    mode === 'panel'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  Tableau
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
