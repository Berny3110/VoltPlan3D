import * as THREE from 'three';
import { CableWaypoint, RoomZone } from '../types/room3d';

export function getDefaultPointCableWaypoints(
  pOut: THREE.Vector3,
  cOut: THREE.Vector3,
  sameRoom: boolean,
  panelRoomTopY: number,
): CableWaypoint[] {
  const rawTrunkY = Math.max(pOut.y, cOut.y) + 0.24;
  const trunkY = Number(
    (sameRoom ? Math.min(panelRoomTopY - 0.08, rawTrunkY) : rawTrunkY).toFixed(2),
  );
  return [
    { x: Number(pOut.x.toFixed(2)), y: trunkY, z: Number(pOut.z.toFixed(2)) },
    { x: Number(cOut.x.toFixed(2)), y: trunkY, z: Number(pOut.z.toFixed(2)) },
    { x: Number(cOut.x.toFixed(2)), y: trunkY, z: Number(cOut.z.toFixed(2)) },
  ];
}

export function getDefaultPanelCableWaypoints(
  pOut: THREE.Vector3,
  cOut: THREE.Vector3,
  sameRoom: boolean,
  crossBuilding: boolean,
  panelRoomTopY: number,
  minBuildingY: number,
): CableWaypoint[] {
  const trunkY = Number(
    (crossBuilding
      ? minBuildingY + 0.14
      : sameRoom
        ? Math.min(panelRoomTopY - 0.08, Math.max(pOut.y, cOut.y) + 0.32)
        : Math.max(pOut.y, cOut.y) + 0.34
    ).toFixed(2),
  );
  return [
    { x: Number(pOut.x.toFixed(2)), y: trunkY, z: Number(pOut.z.toFixed(2)) },
    { x: Number(cOut.x.toFixed(2)), y: trunkY, z: Number(pOut.z.toFixed(2)) },
    { x: Number(cOut.x.toFixed(2)), y: trunkY, z: Number(cOut.z.toFixed(2)) },
  ];
}

function appendOrthogonal(out: THREE.Vector3[], target: THREE.Vector3) {
  const last = out[out.length - 1];
  if (!last) {
    out.push(target.clone());
    return;
  }
  const dx = Math.abs(target.x - last.x);
  const dy = Math.abs(target.y - last.y);
  const dz = Math.abs(target.z - last.z);
  if (dx < 0.005 && dy < 0.005 && dz < 0.005) return;

  // Garde les transitions orthogonales sans diagonales
  let cur = last.clone();
  if (dx >= 0.005 && (dz >= 0.005 || dy >= 0.005)) {
    cur = new THREE.Vector3(target.x, cur.y, cur.z);
    out.push(cur);
  }
  if (dz >= 0.005 && dy >= 0.005) {
    cur = new THREE.Vector3(cur.x, cur.y, target.z);
    out.push(cur);
  }
  if (cur.distanceToSquared(target) > 0.000025) {
    out.push(target.clone());
  }
}

export function buildOrthogonalCablePoints(
  pWorld: THREE.Vector3,
  pOut: THREE.Vector3,
  cOut: THREE.Vector3,
  cWorld: THREE.Vector3,
  spineWaypoints: CableWaypoint[],
): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [pWorld.clone(), pOut.clone()];

  if (spineWaypoints.length === 0) {
    appendOrthogonal(pts, cOut);
    pts.push(cWorld.clone());
    return pts;
  }

  const first = spineWaypoints[0];
  const last = spineWaypoints[spineWaypoints.length - 1];

  // Départ vertical du coffret jusqu'à la hauteur du premier tronçon
  const pRise = new THREE.Vector3(pOut.x, first.y, pOut.z);
  appendOrthogonal(pts, pRise);

  for (const wp of spineWaypoints) {
    appendOrthogonal(pts, new THREE.Vector3(wp.x, wp.y, wp.z));
  }

  // Retour orthogonal au-dessus/en face du point ou sous-tableau d'arrivée
  const cDrop = new THREE.Vector3(cOut.x, last.y, cOut.z);
  appendOrthogonal(pts, cDrop);
  appendOrthogonal(pts, cOut);
  pts.push(cWorld.clone());

  // Nettoyage des points colinéaires redondants
  const cleaned: THREE.Vector3[] = [];
  for (const p of pts) {
    if (cleaned.length > 0 && cleaned[cleaned.length - 1].distanceTo(p) < 0.005) continue;
    cleaned.push(p);
  }
  return cleaned;
}

export function simplifyCableWaypoints(wps: CableWaypoint[]): CableWaypoint[] {
  if (wps.length <= 2) return wps.map((w) => ({ ...w }));
  const out: CableWaypoint[] = [];
  for (const w of wps) {
    const rounded: CableWaypoint = {
      x: Number(w.x.toFixed(2)),
      y: Number(w.y.toFixed(2)),
      z: Number(w.z.toFixed(2)),
    };
    const prev = out[out.length - 1];
    if (
      prev &&
      Math.abs(prev.x - rounded.x) < 0.02 &&
      Math.abs(prev.y - rounded.y) < 0.02 &&
      Math.abs(prev.z - rounded.z) < 0.02
    ) {
      continue;
    }
    out.push(rounded);
  }
  return out;
}

export interface CableSnapXZResult {
  x: number;
  z: number;
  guideX: number | null;
  guideZ: number | null;
  snapLabel: string | null;
}

export function snapCableXZ(
  rawX: number,
  rawZ: number,
  rooms: RoomZone[],
  pOut: THREE.Vector3,
  cOut: THREE.Vector3,
  peerXs: number[],
  peerZs: number[],
  snapStep: number,
  magnetic: boolean,
): CableSnapXZResult {
  const step = magnetic ? Math.min(snapStep, 0.25) : 0.1;
  let x = Number((Math.round(rawX / step) * step).toFixed(2));
  let z = Number((Math.round(rawZ / step) * step).toFixed(2));
  let guideX: number | null = null;
  let guideZ: number | null = null;
  let labelX: string | null = null;
  let labelZ: string | null = null;

  if (!magnetic) {
    return { x, z, guideX, guideZ, snapLabel: null };
  }

  const candidatesX: { val: number; label: string; prio: number }[] = [
    { val: Number(pOut.x.toFixed(2)), label: 'Aligné départ', prio: 1 },
    { val: Number(cOut.x.toFixed(2)), label: 'Aligné arrivée', prio: 1 },
  ];
  const candidatesZ: { val: number; label: string; prio: number }[] = [
    { val: Number(pOut.z.toFixed(2)), label: 'Aligné départ', prio: 1 },
    { val: Number(cOut.z.toFixed(2)), label: 'Aligné arrivée', prio: 1 },
  ];

  for (const px of peerXs) {
    candidatesX.push({ val: Number(px.toFixed(2)), label: 'Aligné câble', prio: 2 });
  }
  for (const pz of peerZs) {
    candidatesZ.push({ val: Number(pz.toFixed(2)), label: 'Aligné câble', prio: 2 });
  }

  for (const r of rooms) {
    const minX = Number((r.x - r.largeur / 2).toFixed(2));
    const maxX = Number((r.x + r.largeur / 2).toFixed(2));
    const minZ = Number((r.z - r.profondeur / 2).toFixed(2));
    const maxZ = Number((r.z + r.profondeur / 2).toFixed(2));
    candidatesX.push(
      { val: minX, label: `Mur Ouest (${r.nom})`, prio: 3 },
      { val: maxX, label: `Mur Est (${r.nom})`, prio: 3 },
      { val: Number((minX + 0.06).toFixed(2)), label: `Goulotte Ouest`, prio: 4 },
      { val: Number((maxX - 0.06).toFixed(2)), label: `Goulotte Est`, prio: 4 },
    );
    candidatesZ.push(
      { val: minZ, label: `Mur Nord (${r.nom})`, prio: 3 },
      { val: maxZ, label: `Mur Sud (${r.nom})`, prio: 3 },
      { val: Number((minZ + 0.06).toFixed(2)), label: `Goulotte Nord`, prio: 4 },
      { val: Number((maxZ - 0.06).toFixed(2)), label: `Goulotte Sud`, prio: 4 },
    );
  }

  let bestScoreX = 0.26;
  for (const c of candidatesX) {
    const d = Math.abs(rawX - c.val);
    if (d <= 0.24 && (d < bestScoreX || (Math.abs(d - bestScoreX) < 0.02 && c.prio < 3))) {
      bestScoreX = d;
      x = c.val;
      guideX = c.val;
      labelX = c.label;
    }
  }

  let bestScoreZ = 0.26;
  for (const c of candidatesZ) {
    const d = Math.abs(rawZ - c.val);
    if (d <= 0.24 && (d < bestScoreZ || (Math.abs(d - bestScoreZ) < 0.02 && c.prio < 3))) {
      bestScoreZ = d;
      z = c.val;
      guideZ = c.val;
      labelZ = c.label;
    }
  }

  const snapLabel = labelX && labelZ ? `${labelX} + ${labelZ}` : labelX ?? labelZ;
  return { x, z, guideX, guideZ, snapLabel };
}

export function snapCableY(
  rawY: number,
  rooms: RoomZone[],
  pOut: THREE.Vector3,
  cOut: THREE.Vector3,
  peerYs: number[],
  magnetic: boolean,
): { y: number; snapLabel: string | null } {
  const clamped = Math.max(-1.5, Math.min(10, rawY));
  if (!magnetic) {
    return { y: Number((Math.round(clamped * 10) / 10).toFixed(2)), snapLabel: null };
  }

  const candidates: { val: number; label: string }[] = [
    { val: Number(pOut.y.toFixed(2)), label: 'Niveau départ' },
    { val: Number(cOut.y.toFixed(2)), label: 'Niveau arrivée' },
  ];

  for (const py of peerYs) {
    candidates.push({ val: Number(py.toFixed(2)), label: 'Aligné autre câble' });
  }

  for (const r of rooms) {
    candidates.push(
      { val: Number((r.y + r.hauteur - 0.08).toFixed(2)), label: `Plafond (${r.nom})` },
      { val: Number((r.y + 0.14).toFixed(2)), label: `Plinthe (${r.nom})` },
      { val: Number((r.y - 0.12).toFixed(2)), label: `Sous-dalle (${r.nom})` },
      { val: Number(r.y.toFixed(2)), label: `Sol (${r.nom})` },
    );
  }

  let bestY = Number((Math.round(clamped * 10) / 10).toFixed(2));
  let bestDist = 0.16;
  let snapLabel: string | null = null;

  for (const c of candidates) {
    const d = Math.abs(clamped - c.val);
    if (d <= bestDist) {
      bestDist = d;
      bestY = c.val;
      snapLabel = c.label;
    }
  }

  return { y: bestY, snapLabel };
}
