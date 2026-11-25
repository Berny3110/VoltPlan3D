import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  ChevronDown,
  Download,
  Eye,
  FolderArchive,
  PanelRight,
  RotateCcw,
  SquarePlus,
  Undo2,
  Upload,
  Zap,
} from 'lucide-react';
import { SideInspectorDrawer } from './components/SideInspectorDrawer';
import { CircuitFocusRequest, RoomBuilder3D } from './modules/scene3d/RoomBuilder3D';
import {
  exportScenarioToZip,
  importScenarioFromZip,
  loadLocalProject,
  saveLocalProject,
} from './modules/storage/scenarioZip';
import {
  BoardElement,
  BoardPhaseConfig,
  CableWaypoint,
  ElectricalPoint,
  InteractionMode,
  LevelFilterMode,
  PhaseCode,
  PhaseFilter,
  PointCategory,
  PointPosition3D,
  RoomOpening,
  RoomZone,
  SceneConfig,
  WorkspaceTab,
} from './types/room3d';
import {
  findConnectedBuilding,
  getNextBuildingMeta,
} from './utils/buildings';
import { computeElevationBounds, getRoomCutState } from './utils/levels';

const INITIAL_ROOM: RoomZone = {
  zone_id: 'Z_ATELIER',
  nom: 'Pièce 1 — RDC',
  buildingId: 'BAT_1',
  buildingName: 'Bâtiment 1',
  x: 0,
  y: 0,
  z: 0,
  largeur: 5,
  profondeur: 4,
  hauteur: 2.6,
};

const CATEGORY_DEFAULT_PREFIX: Record<PointCategory, string> = {
  prise: 'Prise',
  lumiere: 'Lumière',
  equipement_fixe: 'Équipement',
  rallonge_multiprise: 'Multiprise',
};

interface ProjectSnapshot {
  rooms: RoomZone[];
  openings: RoomOpening[];
  points: ElectricalPoint[];
  pointPositions: Record<string, PointPosition3D>;
  boardElements: BoardElement[];
  panelPositions: Record<string, PointPosition3D>;
  cableRoutes: Record<string, CableWaypoint[]>;
  selectedRoomId: string | null;
  selectedOpeningId: string | null;
  selectedPointId: string | null;
  selectedPanelId: string | null;
}

export default function App() {
  const saved = useMemo(() => loadLocalProject(), []);

  const [rooms, setRooms] = useState<RoomZone[]>(() =>
    saved && saved.rooms.length > 0 ? saved.rooms : [INITIAL_ROOM],
  );
  const [openings, setOpenings] = useState<RoomOpening[]>(() => (saved ? saved.openings : []));
  const [points, setPoints] = useState<ElectricalPoint[]>(() => (saved ? saved.points : []));
  const [pointPositions, setPointPositions] = useState<Record<string, PointPosition3D>>(() =>
    saved ? saved.pointPositions : {},
  );
  const [boardElements, setBoardElements] = useState<BoardElement[]>(() =>
    saved ? saved.boardElements : [],
  );
  const [panelPositions, setPanelPositions] = useState<Record<string, PointPosition3D>>(() =>
    saved ? saved.panelPositions : {},
  );
  const [cableRoutes, setCableRoutes] = useState<Record<string, CableWaypoint[]>>(() =>
    saved ? saved.cableRoutes : {},
  );

  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(() =>
    saved ? saved.sceneConfig.selectedRoomId : INITIAL_ROOM.zone_id,
  );
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(
    () => saved?.sceneConfig.selectedOpeningId ?? null,
  );
  const [selectedPointId, setSelectedPointId] = useState<string | null>(
    () => saved?.sceneConfig.selectedPointId ?? null,
  );
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(
    () => saved?.sceneConfig.selectedPanelId ?? null,
  );
  const [selectedBreakerId, setSelectedBreakerId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<CircuitFocusRequest | null>(null);

  const [workspace, setWorkspace] = useState<WorkspaceTab>('construction');
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(false);
  const [zipMenuOpen, setZipMenuOpen] = useState<boolean>(false);

  const [mode, setMode] = useState<InteractionMode>('select');
  const [activePointCategory, setActivePointCategory] = useState<PointCategory>('prise');
  const [activePointPhase, setActivePointPhase] = useState<PhaseCode>('L1');
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>('TOUTES');

  const snapStep = 0.1;
  const magneticSnap = true;
  const [levelFilter, setLevelFilter] = useState<LevelFilterMode>(() =>
    saved?.sceneConfig.levelFilter === 'active' ? 'active' : 'all',
  );
  const [cutPlaneY, setCutPlaneY] = useState<number | null>(() =>
    saved?.sceneConfig.levelFilter === 'active'
      ? (saved.sceneConfig.cutPlaneY ?? saved.sceneConfig.workElevation ?? 0)
      : null,
  );
  const [workElevation, setWorkElevation] = useState<number>(0);
  const [undoStack, setUndoStack] = useState<ProjectSnapshot[]>([]);
  const [fileNotice, setFileNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const zipMenuRef = useRef<HTMLDivElement | null>(null);

  const latestSnapshotRef = useRef<ProjectSnapshot>({
    rooms,
    openings,
    points,
    pointPositions,
    boardElements,
    panelPositions,
    cableRoutes,
    selectedRoomId,
    selectedOpeningId,
    selectedPointId,
    selectedPanelId,
  });
  latestSnapshotRef.current = {
    rooms,
    openings,
    points,
    pointPositions,
    boardElements,
    panelPositions,
    cableRoutes,
    selectedRoomId,
    selectedOpeningId,
    selectedPointId,
    selectedPanelId,
  };

  const pushUndoSnapshot = useCallback(() => {
    const snap = latestSnapshotRef.current;
    setUndoStack((prev) => {
      const next = [...prev, snap];
      return next.length > 40 ? next.slice(next.length - 40) : next;
    });
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setRooms(last.rooms);
      setOpenings(last.openings);
      setPoints(last.points);
      setPointPositions(last.pointPositions);
      setBoardElements(last.boardElements);
      setPanelPositions(last.panelPositions);
      setCableRoutes(last.cableRoutes);
      setSelectedRoomId(last.selectedRoomId);
      setSelectedOpeningId(last.selectedOpeningId);
      setSelectedPointId(last.selectedPointId);
      setSelectedPanelId(last.selectedPanelId);
      setSelectedBreakerId(null);
      setMode('select');
      return prev.slice(0, -1);
    });
  }, []);

  const sceneConfig: SceneConfig = useMemo(
    () => ({
      scenario: 'actuel',
      snapStep,
      magneticSnap,
      workElevation,
      levelFilter,
      cutPlaneY,
      selectedRoomId,
      selectedOpeningId,
      selectedPointId,
      selectedPanelId,
      phaseFilter,
    }),
    [
      snapStep,
      magneticSnap,
      workElevation,
      levelFilter,
      cutPlaneY,
      selectedRoomId,
      selectedOpeningId,
      selectedPointId,
      selectedPanelId,
      phaseFilter,
    ],
  );

  useEffect(() => {
    saveLocalProject(
      rooms,
      openings,
      points,
      pointPositions,
      boardElements,
      panelPositions,
      cableRoutes,
      sceneConfig,
    );
  }, [
    rooms,
    openings,
    points,
    pointPositions,
    boardElements,
    panelPositions,
    cableRoutes,
    sceneConfig,
  ]);

  useEffect(() => {
    if (!fileNotice) return;
    const t = window.setTimeout(() => setFileNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [fileNotice]);

  useEffect(() => {
    if (!zipMenuOpen) return;
    const onPointerDown = (ev: PointerEvent) => {
      if (zipMenuRef.current && !zipMenuRef.current.contains(ev.target as Node)) {
        setZipMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [zipMenuOpen]);

  const panels = useMemo(
    () => boardElements.filter((el) => el.type_element === 'boitier'),
    [boardElements],
  );

  const breakers = useMemo(
    () => boardElements.filter((el) => el.type_element === 'disjoncteur'),
    [boardElements],
  );

  const elevationBounds = useMemo(() => computeElevationBounds(rooms), [rooms]);

  useEffect(() => {
    if (levelFilter !== 'active') return;
    if (!elevationBounds.hasMultipleLevels) {
      setLevelFilter('all');
      setCutPlaneY(null);
      return;
    }
    if (cutPlaneY === null) {
      setCutPlaneY(Number(Math.max(elevationBounds.minY, elevationBounds.maxY - 0.1).toFixed(1)));
      return;
    }
    if (cutPlaneY < elevationBounds.minY - 0.05) {
      setCutPlaneY(elevationBounds.minY);
    } else if (cutPlaneY > elevationBounds.maxY + 0.05) {
      setLevelFilter('all');
      setCutPlaneY(null);
    }
  }, [cutPlaneY, elevationBounds.hasMultipleLevels, elevationBounds.maxY, elevationBounds.minY, levelFilter]);

  const handleLevelCutChange = useCallback(
    (nextFilter: LevelFilterMode, nextCutY: number | null) => {
      setLevelFilter(nextFilter);
      setCutPlaneY(nextCutY);
    },
    [],
  );

  const selectedRoom = useMemo(
    () => rooms.find((r) => r.zone_id === selectedRoomId) ?? null,
    [rooms, selectedRoomId],
  );

  const handleDeletePanel = useCallback(
    (panelId: string) => {
      pushUndoSnapshot();
      const removedBreakerIds = new Set(
        boardElements
          .filter((el) => el.type_element === 'disjoncteur' && el.parent_id === panelId)
          .map((el) => el.element_id),
      );
      setBoardElements((prev) =>
        prev
          .filter((el) => el.element_id !== panelId && el.parent_id !== panelId)
          .map((el) =>
            el.type_element === 'boitier' &&
            (el.parent_id === panelId || removedBreakerIds.has(el.parent_id))
              ? { ...el, parent_id: '' }
              : el,
          ),
      );
      setPanelPositions((prev) => {
        const next = { ...prev };
        delete next[panelId];
        return next;
      });
      setCableRoutes((prev) => {
        const next = { ...prev };
        delete next[`panel:${panelId}`];
        return next;
      });
      if (removedBreakerIds.size > 0) {
        setPoints((prev) =>
          prev.map((pt) =>
            removedBreakerIds.has(pt.disjoncteur_id) ? { ...pt, disjoncteur_id: '' } : pt,
          ),
        );
      }
      if (selectedPanelId === panelId) setSelectedPanelId(null);
      if (selectedBreakerId && removedBreakerIds.has(selectedBreakerId)) {
        setSelectedBreakerId(null);
      }
    },
    [boardElements, pushUndoSnapshot, selectedBreakerId, selectedPanelId],
  );

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      const tag = target?.tagName;
      const isTextInput =
        (tag === 'INPUT' && (target as HTMLInputElement).type !== 'range') || tag === 'TEXTAREA';

      if (ev.key === 'Escape' && zipMenuOpen) {
        setZipMenuOpen(false);
        return;
      }

      if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === 'z') {
        if (isTextInput) return;
        ev.preventDefault();
        handleUndo();
        return;
      }

      if (ev.key !== 'Delete' && ev.key !== 'Backspace') return;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (workspace === 'exploitation') return;

      if (selectedPanelId) {
        ev.preventDefault();
        handleDeletePanel(selectedPanelId);
        return;
      }
      if (selectedPointId) {
        ev.preventDefault();
        pushUndoSnapshot();
        setPoints((prev) => prev.filter((p) => p.point_id !== selectedPointId));
        setPointPositions((prev) => {
          const next = { ...prev };
          delete next[selectedPointId];
          return next;
        });
        setCableRoutes((prev) => {
          const next = { ...prev };
          delete next[`point:${selectedPointId}`];
          return next;
        });
        setSelectedPointId(null);
        return;
      }
      if (selectedOpeningId) {
        ev.preventDefault();
        pushUndoSnapshot();
        setOpenings((prev) => prev.filter((o) => o.opening_id !== selectedOpeningId));
        setSelectedOpeningId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    handleDeletePanel,
    handleUndo,
    pushUndoSnapshot,
    selectedOpeningId,
    selectedPanelId,
    selectedPointId,
    workspace,
    zipMenuOpen,
  ]);

  const handleWorkspaceChange = (nextTab: WorkspaceTab) => {
    setWorkspace(nextTab);
    if (nextTab === 'exploitation') {
      setMode('select');
      setSelectedOpeningId(null);
    } else {
      setPhaseFilter('TOUTES');
    }
  };

  const handleSelectRoomFrom3D = useCallback((zoneId: string | null) => {
    setSelectedRoomId(zoneId);
    setSelectedBreakerId(null);
    if (zoneId !== null) {
      setInspectorOpen(true);
    }
  }, []);

  const handleSelectOpeningFrom3D = useCallback((openingId: string | null) => {
    setSelectedOpeningId(openingId);
    setSelectedBreakerId(null);
    if (openingId !== null) {
      setInspectorOpen(true);
    }
  }, []);

  const handleSelectPointFrom3D = useCallback((pointId: string | null) => {
    setSelectedPointId(pointId);
    setSelectedBreakerId(null);
    if (pointId !== null) {
      setInspectorOpen(true);
    }
  }, []);

  const handleSelectPanelFrom3D = useCallback((panelId: string | null) => {
    setSelectedPanelId(panelId);
    setSelectedBreakerId(null);
    if (panelId !== null) {
      setInspectorOpen(true);
    }
  }, []);

  const ensureRoomLevelVisible = useCallback(
    (zoneId: string | null) => {
      if (!zoneId || levelFilter !== 'active') return;
      const room = rooms.find((r) => r.zone_id === zoneId);
      if (!room) return;
      if (getRoomCutState(room, cutPlaneY, elevationBounds.maxY) !== 'traversed') {
        const nextCut = Number(
          Math.min(
            elevationBounds.maxY - 0.1,
            room.y + Math.min(1.2, Math.max(0.1, room.hauteur * 0.5)),
          ).toFixed(1),
        );
        setCutPlaneY(Math.max(elevationBounds.minY, nextCut));
      }
    },
    [cutPlaneY, elevationBounds.maxY, elevationBounds.minY, levelFilter, rooms],
  );

  const handleSelectRoomFromDrawer = useCallback(
    (zoneId: string | null) => {
      setSelectedRoomId(zoneId);
      ensureRoomLevelVisible(zoneId);
    },
    [ensureRoomLevelVisible],
  );

  const handleSelectOpeningFromDrawer = useCallback(
    (openingId: string | null) => {
      setSelectedOpeningId(openingId);
      if (openingId) {
        const op = openings.find((o) => o.opening_id === openingId);
        if (op) ensureRoomLevelVisible(op.zone_id);
      }
    },
    [ensureRoomLevelVisible, openings],
  );

  const handleSelectPointFromDrawer = useCallback(
    (pointId: string | null) => {
      setSelectedPointId(pointId);
      if (pointId) {
        const pt = points.find((p) => p.point_id === pointId);
        if (pt) ensureRoomLevelVisible(pt.zone_id);
      }
    },
    [ensureRoomLevelVisible, points],
  );

  const handleSelectPanelFromDrawer = useCallback(
    (panelId: string | null) => {
      setSelectedPanelId(panelId);
      if (panelId) {
        const pnl = panels.find((p) => p.element_id === panelId);
        if (pnl) ensureRoomLevelVisible(pnl.zone_id);
      }
    },
    [ensureRoomLevelVisible, panels],
  );

  const handleFocusCircuit = useCallback(
    (panelId: string, breakerId: string) => {
      const pnl = panels.find((p) => p.element_id === panelId);
      if (pnl) ensureRoomLevelVisible(pnl.zone_id);
      setFocusRequest({
        nonce: Date.now() + Math.random(),
        targetPanelId: panelId,
        targetBreakerId: breakerId,
      });
    },
    [ensureRoomLevelVisible, panels],
  );

  const handleFocusPoint = useCallback(
    (pointId: string) => {
      const pt = points.find((p) => p.point_id === pointId);
      if (pt) ensureRoomLevelVisible(pt.zone_id);
      setFocusRequest({
        nonce: Date.now() + Math.random(),
        targetPointId: pointId,
      });
    },
    [ensureRoomLevelVisible, points],
  );

  const handleCreateRoom = (geometry: Omit<RoomZone, 'zone_id' | 'nom'>) => {
    pushUndoSnapshot();
    let idx = rooms.length + 1;
    const existingIds = new Set(rooms.map((r) => r.zone_id));
    while (existingIds.has(`Z_PIECE_${idx}`)) idx += 1;
    const newId = `Z_PIECE_${idx}`;

    const connected = findConnectedBuilding(geometry, rooms);
    const buildingMeta = connected ?? getNextBuildingMeta(rooms);

    const newRoom: RoomZone = {
      zone_id: newId,
      nom: `Pièce ${idx}`,
      buildingId: buildingMeta.buildingId,
      buildingName: buildingMeta.buildingName,
      ...geometry,
    };
    setRooms((prev) => [...prev, newRoom]);
    setSelectedRoomId(newId);
    setSelectedOpeningId(null);
    setSelectedPointId(null);
    setSelectedPanelId(null);
    setInspectorOpen(true);
    setWorkElevation(0);
    if (levelFilter === 'active') {
      const nextMaxY = Math.max(elevationBounds.maxY, newRoom.y + newRoom.hauteur);
      if (getRoomCutState(newRoom, cutPlaneY, nextMaxY) !== 'traversed') {
        const nextCut = Number(
          Math.min(
            nextMaxY - 0.1,
            newRoom.y + Math.min(1.2, Math.max(0.1, newRoom.hauteur * 0.5)),
          ).toFixed(1),
        );
        setCutPlaneY(Math.max(Math.min(elevationBounds.minY, newRoom.y), nextCut));
      }
    }
    setMode('select');
  };

  const handleUpdateRoom = (updated: RoomZone) => {
    setRooms((prev) => prev.map((r) => (r.zone_id === updated.zone_id ? updated : r)));
  };

  const handleRoomTransformEnd = useCallback(
    (zoneId: string) => {
      setRooms((prev) => {
        const target = prev.find((r) => r.zone_id === zoneId);
        if (!target) return prev;
        const sameBuildingCount = prev.filter((r) => r.buildingId === target.buildingId).length;
        // Si c'est une pièce isolée déplacée contre un autre bâtiment, la rattacher intelligemment
        if (sameBuildingCount === 1) {
          const connected = findConnectedBuilding(target, prev, target.zone_id);
          if (connected && connected.buildingId !== target.buildingId) {
            return prev.map((r) =>
              r.zone_id === zoneId
                ? {
                    ...r,
                    buildingId: connected.buildingId,
                    buildingName: connected.buildingName,
                  }
                : r,
            );
          }
        }
        return prev;
      });
    },
    [],
  );

  const handleRenameBuilding = useCallback((buildingId: string, nextName: string) => {
    setRooms((prev) =>
      prev.map((r) => (r.buildingId === buildingId ? { ...r, buildingName: nextName } : r)),
    );
  }, []);

  const handleAssignRoomBuilding = useCallback(
    (zoneId: string, targetBuildingId: string | '__new__') => {
      pushUndoSnapshot();
      setRooms((prev) => {
        if (targetBuildingId === '__new__') {
          const meta = getNextBuildingMeta(prev);
          return prev.map((r) =>
            r.zone_id === zoneId
              ? { ...r, buildingId: meta.buildingId, buildingName: meta.buildingName }
              : r,
          );
        }
        const refRoom = prev.find((r) => r.buildingId === targetBuildingId);
        if (!refRoom) return prev;
        return prev.map((r) =>
          r.zone_id === zoneId
            ? {
                ...r,
                buildingId: targetBuildingId,
                buildingName: refRoom.buildingName || targetBuildingId,
              }
            : r,
        );
      });
    },
    [pushUndoSnapshot],
  );

  const handleDeleteSelectedRoom = () => {
    if (!selectedRoomId) return;
    pushUndoSnapshot();
    const removedPointIds = new Set(
      points.filter((p) => p.zone_id === selectedRoomId).map((p) => p.point_id),
    );
    const removedPanelIds = new Set(
      panels.filter((p) => p.zone_id === selectedRoomId).map((p) => p.element_id),
    );
    const removedBreakerIds = new Set(
      breakers
        .filter((b) => b.zone_id === selectedRoomId || removedPanelIds.has(b.parent_id))
        .map((b) => b.element_id),
    );
    setRooms((prev) => prev.filter((r) => r.zone_id !== selectedRoomId));
    setOpenings((prev) => prev.filter((o) => o.zone_id !== selectedRoomId));
    setPoints((prev) =>
      prev
        .filter((p) => p.zone_id !== selectedRoomId)
        .map((p) => (removedBreakerIds.has(p.disjoncteur_id) ? { ...p, disjoncteur_id: '' } : p)),
    );
    setPointPositions((prev) => {
      const next = { ...prev };
      removedPointIds.forEach((id) => delete next[id]);
      return next;
    });
    setBoardElements((prev) =>
      prev
        .filter(
          (el) =>
            !removedPanelIds.has(el.element_id) &&
            !removedBreakerIds.has(el.element_id) &&
            el.zone_id !== selectedRoomId,
        )
        .map((el) =>
          el.type_element === 'boitier' &&
          (removedPanelIds.has(el.parent_id) || removedBreakerIds.has(el.parent_id))
            ? { ...el, parent_id: '' }
            : el,
        ),
    );
    setPanelPositions((prev) => {
      const next = { ...prev };
      removedPanelIds.forEach((id) => delete next[id]);
      return next;
    });
    setCableRoutes((prev) => {
      const next = { ...prev };
      removedPointIds.forEach((id) => delete next[`point:${id}`]);
      removedPanelIds.forEach((id) => delete next[`panel:${id}`]);
      return next;
    });
    setSelectedRoomId(null);
    setSelectedOpeningId(null);
    setSelectedPointId(null);
    setSelectedPanelId(null);
    setSelectedBreakerId(null);
    setInspectorOpen(false);
  };

  const handleCreateOpening = (draft: Omit<RoomOpening, 'opening_id'>) => {
    pushUndoSnapshot();
    let idx = openings.length + 1;
    const existingIds = new Set(openings.map((o) => o.opening_id));
    while (existingIds.has(`OUV_${idx}`)) idx += 1;
    const newId = `OUV_${idx}`;
    const created: RoomOpening = { opening_id: newId, ...draft };
    setOpenings((prev) => [...prev, created]);
    setSelectedRoomId(draft.zone_id);
    setSelectedPointId(null);
    setSelectedPanelId(null);
    setSelectedOpeningId(newId);
    setInspectorOpen(true);
  };

  const handleUpdateOpening = (updated: RoomOpening) => {
    setOpenings((prev) => prev.map((o) => (o.opening_id === updated.opening_id ? updated : o)));
  };

  const handleDeleteOpening = (openingId: string) => {
    pushUndoSnapshot();
    setOpenings((prev) => prev.filter((o) => o.opening_id !== openingId));
    if (selectedOpeningId === openingId) setSelectedOpeningId(null);
  };

  const handleCreatePoint = (zoneId: string, pos: PointPosition3D) => {
    pushUndoSnapshot();
    let idx = points.length + 1;
    const existingIds = new Set(points.map((p) => p.point_id));
    while (existingIds.has(`PT_${String(idx).padStart(3, '0')}`)) idx += 1;
    const newId = `PT_${String(idx).padStart(3, '0')}`;
    const sameZoneCount = points.filter(
      (p) => p.zone_id === zoneId && p.categorie === activePointCategory,
    ).length;

    const newPoint: ElectricalPoint = {
      scenario: 'actuel',
      point_id: newId,
      nom: `${CATEGORY_DEFAULT_PREFIX[activePointCategory]} ${sameZoneCount + 1}`,
      zone_id: zoneId,
      disjoncteur_id: '',
      categorie: activePointCategory,
      type_appareil: activePointCategory === 'lumiere' ? 'eclairage' : '',
      phase_relevee: activePointPhase,
      puissance_est_w: null,
      statut: 'existant',
      note: '',
    };

    setPoints((prev) => [...prev, newPoint]);
    setPointPositions((prev) => ({ ...prev, [newId]: pos }));
    setSelectedRoomId(zoneId);
    setSelectedOpeningId(null);
    setSelectedPanelId(null);
    setSelectedPointId(newId);
    setInspectorOpen(true);
  };

  const handleUpdatePoint = (updated: ElectricalPoint) => {
    setPoints((prev) => prev.map((p) => (p.point_id === updated.point_id ? updated : p)));
  };

  const handleUpdatePointPosition = (pointId: string, pos: PointPosition3D) => {
    setPointPositions((prev) => ({ ...prev, [pointId]: pos }));
  };

  const handleDeletePoint = (pointId: string) => {
    pushUndoSnapshot();
    setPoints((prev) => prev.filter((p) => p.point_id !== pointId));
    setPointPositions((prev) => {
      const next = { ...prev };
      delete next[pointId];
      return next;
    });
    setCableRoutes((prev) => {
      const next = { ...prev };
      delete next[`point:${pointId}`];
      return next;
    });
    if (selectedPointId === pointId) setSelectedPointId(null);
  };

  const handleUpdateCableRoute = useCallback(
    (routeKey: string, waypoints: CableWaypoint[] | null, withUndo = false) => {
      if (withUndo) pushUndoSnapshot();
      setCableRoutes((prev) => {
        if (!waypoints || waypoints.length === 0) {
          if (!(routeKey in prev)) return prev;
          const next = { ...prev };
          delete next[routeKey];
          return next;
        }
        return { ...prev, [routeKey]: waypoints };
      });
    },
    [pushUndoSnapshot],
  );

  const handleCreatePanel = (zoneId: string, pos: PointPosition3D) => {
    pushUndoSnapshot();
    const existingIds = new Set(boardElements.map((el) => el.element_id));
    let newId = 'TB_MAIN';
    let idx = panels.length + 1;
    if (existingIds.has(newId)) {
      while (existingIds.has(`TB_${idx}`)) idx += 1;
      newId = `TB_${idx}`;
    }
    const isMain = panels.length === 0;
    const newPanel: BoardElement = {
      scenario: 'actuel',
      element_id: newId,
      type_element: 'boitier',
      nom: isMain ? 'Tableau Principal' : `Tableau secondaire ${panels.length + 1}`,
      zone_id: zoneId,
      parent_id: '',
      phases: 'TRI',
      calibre_a: 63,
      statut: 'existant',
      note: '',
    };
    setBoardElements((prev) => [...prev, newPanel]);
    setPanelPositions((prev) => ({ ...prev, [newId]: pos }));
    setSelectedRoomId(zoneId);
    setSelectedOpeningId(null);
    setSelectedPointId(null);
    setSelectedPanelId(newId);
    setInspectorOpen(true);
    setMode('select');
  };

  const handleUpdateBoardElement = (updated: BoardElement) => {
    setBoardElements((prev) =>
      prev.map((el) => (el.element_id === updated.element_id ? updated : el)),
    );
  };

  const handleUpdatePanelPosition = (panelId: string, pos: PointPosition3D) => {
    setPanelPositions((prev) => ({ ...prev, [panelId]: pos }));
  };

  const handleAddBreaker = (panelId: string) => {
    const panel = panels.find((p) => p.element_id === panelId);
    if (!panel) return;
    pushUndoSnapshot();
    const existingIds = new Set(boardElements.map((el) => el.element_id));
    let idx = breakers.length + 1;
    while (existingIds.has(`DJ_${String(idx).padStart(2, '0')}`)) idx += 1;
    const newId = `DJ_${String(idx).padStart(2, '0')}`;
    const siblingCount = breakers.filter((b) => b.parent_id === panelId).length + 1;
    const defaultPhase: BoardPhaseConfig =
      panel.phases === 'L1' || panel.phases === 'L2' || panel.phases === 'L3'
        ? panel.phases
        : 'L1';

    const newBreaker: BoardElement = {
      scenario: 'actuel',
      element_id: newId,
      type_element: 'disjoncteur',
      nom: `D${siblingCount} — Circuit`,
      zone_id: panel.zone_id,
      parent_id: panelId,
      phases: defaultPhase,
      calibre_a: 16,
      statut: 'existant',
      note: '',
    };
    setBoardElements((prev) => [...prev, newBreaker]);
  };

  const handleDeleteBreaker = (breakerId: string) => {
    pushUndoSnapshot();
    setBoardElements((prev) =>
      prev
        .filter((el) => el.element_id !== breakerId)
        .map((el) =>
          el.type_element === 'boitier' && el.parent_id === breakerId
            ? { ...el, parent_id: '' }
            : el,
        ),
    );
    setPoints((prev) =>
      prev.map((pt) => (pt.disjoncteur_id === breakerId ? { ...pt, disjoncteur_id: '' } : pt)),
    );
    if (selectedBreakerId === breakerId) setSelectedBreakerId(null);
  };

  const handleModeChange = (nextMode: InteractionMode) => {
    const activeCut = levelFilter === 'active' ? cutPlaneY : null;
    const isVisibleRoom = (r: RoomZone) =>
      activeCut === null || getRoomCutState(r, activeCut, elevationBounds.maxY) === 'traversed';

    if (
      (nextMode === 'door' || nextMode === 'window' || nextMode === 'point' || nextMode === 'panel') &&
      !selectedRoomId &&
      rooms.length > 0
    ) {
      const match = rooms.find(isVisibleRoom) ?? rooms[0];
      setSelectedRoomId(match.zone_id);
    }
    if (nextMode !== 'select') {
      setWorkspace('construction');
      setPhaseFilter('TOUTES');
    }
    if (nextMode === 'draw') {
      if (activeCut !== null) {
        const selVisible = selectedRoom && isVisibleRoom(selectedRoom) ? selectedRoom : null;
        const firstVisible = rooms.find(isVisibleRoom) ?? null;
        setWorkElevation(selVisible?.y ?? firstVisible?.y ?? 0);
      } else {
        setWorkElevation(0);
      }
    } else {
      setWorkElevation(0);
    }
    if (nextMode === 'point') {
      setSelectedOpeningId(null);
      setSelectedPanelId(null);
    } else if (nextMode === 'panel') {
      setSelectedOpeningId(null);
      setSelectedPointId(null);
    } else if (nextMode === 'draw' || nextMode === 'door' || nextMode === 'window') {
      setSelectedPointId(null);
      setSelectedPanelId(null);
    }
    setMode(nextMode);
  };

  const handleReset = () => {
    pushUndoSnapshot();
    setRooms([INITIAL_ROOM]);
    setOpenings([]);
    setPoints([]);
    setPointPositions({});
    setBoardElements([]);
    setPanelPositions({});
    setCableRoutes({});
    setSelectedRoomId(INITIAL_ROOM.zone_id);
    setSelectedOpeningId(null);
    setSelectedPointId(null);
    setSelectedPanelId(null);
    setSelectedBreakerId(null);
    setInspectorOpen(false);
    setPhaseFilter('TOUTES');
    setLevelFilter('all');
    setCutPlaneY(null);
    setWorkElevation(0);
    setMode('select');
    setZipMenuOpen(false);
  };

  const handleDrawAboveSelected = () => {
    if (!selectedRoom) return;
    const topY = Number((selectedRoom.y + selectedRoom.hauteur).toFixed(2));
    setWorkspace('construction');
    setWorkElevation(topY);
    setSelectedOpeningId(null);
    setSelectedPointId(null);
    setSelectedPanelId(null);
    setMode('draw');
  };

  const handleExportZip = async () => {
    setZipMenuOpen(false);
    try {
      await exportScenarioToZip(
        rooms,
        openings,
        points,
        pointPositions,
        boardElements,
        panelPositions,
        cableRoutes,
        sceneConfig,
      );
      setFileNotice({
        tone: 'ok',
        text: `ZIP exporté : ${rooms.length} pièce(s), ${panels.length} tableau(x), ${points.length} point(s).`,
      });
    } catch {
      setFileNotice({ tone: 'err', text: 'Erreur lors de la création du fichier ZIP.' });
    }
  };

  const handleImportZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setZipMenuOpen(false);
    if (!file) return;

    try {
      const res = await importScenarioFromZip(file);
      if (res.rooms.length === 0) {
        setFileNotice({ tone: 'err', text: 'Aucune pièce trouvée dans zones.csv.' });
        return;
      }
      pushUndoSnapshot();
      setRooms(res.rooms);
      setOpenings(res.openings);
      setPoints(res.points);
      setPointPositions(res.pointPositions);
      setBoardElements(res.boardElements);
      setPanelPositions(res.panelPositions);
      setCableRoutes(res.cableRoutes);
      const importedBounds = computeElevationBounds(res.rooms);
      const nextLevelFilter: LevelFilterMode =
        importedBounds.hasMultipleLevels && res.sceneConfig.levelFilter === 'active'
          ? 'active'
          : 'all';
      setLevelFilter(nextLevelFilter);
      setCutPlaneY(
        nextLevelFilter === 'active'
          ? (res.sceneConfig.cutPlaneY ?? res.sceneConfig.workElevation ?? importedBounds.minY)
          : null,
      );
      setWorkElevation(0);
      setPhaseFilter('TOUTES');

      const restoredSel =
        res.sceneConfig.selectedRoomId &&
        res.rooms.some((r) => r.zone_id === res.sceneConfig.selectedRoomId)
          ? res.sceneConfig.selectedRoomId
          : res.rooms[0].zone_id;
      setSelectedRoomId(restoredSel);
      setSelectedOpeningId(
        res.sceneConfig.selectedOpeningId &&
          res.openings.some((o) => o.opening_id === res.sceneConfig.selectedOpeningId)
          ? res.sceneConfig.selectedOpeningId
          : null,
      );
      setSelectedPointId(
        res.sceneConfig.selectedPointId &&
          res.points.some((p) => p.point_id === res.sceneConfig.selectedPointId)
          ? res.sceneConfig.selectedPointId
          : null,
      );
      setSelectedPanelId(
        res.sceneConfig.selectedPanelId &&
          res.boardElements.some(
            (el) => el.type_element === 'boitier' && el.element_id === res.sceneConfig.selectedPanelId,
          )
          ? res.sceneConfig.selectedPanelId
          : null,
      );
      setSelectedBreakerId(null);
      setMode('select');
      const importedPanelsCount = res.boardElements.filter(
        (el) => el.type_element === 'boitier',
      ).length;
      setFileNotice({
        tone: 'ok',
        text:
          res.warnings.length > 0
            ? `Importé (${res.rooms.length} pièces, ${importedPanelsCount} tab., ${res.points.length} pts). ${res.warnings[0]}`
            : `Restauré : ${res.rooms.length} pièce(s), ${importedPanelsCount} tableau(x), ${res.points.length} point(s).`,
      });
    } catch (err) {
      setFileNotice({
        tone: 'err',
        text: err instanceof Error ? err.message : 'Archive ZIP invalide.',
      });
    }
  };

  return (
    <div className="h-screen flex flex-col bg-[#EBF0F5] text-slate-900 overflow-hidden">
      {/* En-tête studio plat : Marque | Switcher Construction / Exploitation | Actions */}
      <header className="h-[52px] bg-white border-b border-slate-200 px-4 sm:px-5 flex items-center justify-between gap-4 shrink-0 z-30">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
            <Zap className="w-4 h-4" />
          </div>
          <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            VoltPlan <span className="text-slate-400 font-medium">3D</span>
          </span>
        </div>

        {/* Sélecteur d'espace de travail */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 border border-slate-200/80">
          <button
            type="button"
            onClick={() => handleWorkspaceChange('construction')}
            className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
              workspace === 'construction'
                ? 'bg-white text-slate-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            Construction
          </button>
          <button
            type="button"
            onClick={() => handleWorkspaceChange('exploitation')}
            className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
              workspace === 'exploitation'
                ? 'bg-white text-slate-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            Exploitation
          </button>
        </div>

        {/* Actions globales sobres */}
        <div className="flex items-center gap-2 shrink-0">
          {workspace === 'construction' && (
            <button
              type="button"
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              title="Annuler la dernière action (Ctrl+Z)"
              className={`h-8 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 studio-btn ${
                undoStack.length > 0
                  ? 'text-slate-800'
                  : 'text-slate-400 opacity-50 cursor-not-allowed'
              }`}
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Annuler</span>
            </button>
          )}

          {/* Menu ZIP compact */}
          <div className="relative" ref={zipMenuRef}>
            <button
              type="button"
              onClick={() => setZipMenuOpen((v) => !v)}
              className="h-8 px-2.5 rounded-lg text-xs font-semibold text-slate-700 flex items-center gap-1.5 whitespace-nowrap shrink-0 studio-btn"
              title="Exporter ou importer un scénario .zip"
            >
              <FolderArchive className="w-3.5 h-3.5 text-slate-500" />
              <span>ZIP</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {zipMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-48 studio-panel rounded-xl p-1.5 z-40 flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={handleExportZip}
                  className="w-full px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-800 hover:bg-slate-100 flex items-center gap-2 text-left"
                >
                  <Download className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  Exporter .zip
                </button>
                <label className="w-full px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-800 hover:bg-slate-100 flex items-center gap-2 cursor-pointer">
                  <Upload className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                  Importer .zip
                  <input type="file" accept=".zip" onChange={handleImportZip} className="hidden" />
                </label>
                <div className="my-1 border-t border-slate-100" />
                <button
                  type="button"
                  onClick={handleReset}
                  className="w-full px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-700 hover:bg-red-50 flex items-center gap-2 text-left"
                >
                  <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                  Réinitialiser (1 pièce)
                </button>
              </div>
            )}
          </div>

          {workspace === 'construction' && (
            <button
              type="button"
              onClick={() => handleModeChange(mode === 'draw' ? 'select' : 'draw')}
              className={`h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                mode === 'draw'
                  ? 'bg-slate-900 text-white'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              <SquarePlus className="w-3.5 h-3.5" />
              {mode === 'draw' ? 'Terminer' : '+ Pièce'}
            </button>
          )}

          <button
            type="button"
            onClick={() => setInspectorOpen((v) => !v)}
            title={inspectorOpen ? 'Masquer le panneau latéral' : 'Afficher le panneau latéral'}
            className={`h-8 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
              inspectorOpen
                ? 'bg-slate-900 text-white'
                : 'studio-btn text-slate-700'
            }`}
          >
            <PanelRight className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Panneau</span>
          </button>
        </div>
      </header>

      {/* Viewport 3D plein écran + tiroir latéral pleine hauteur */}
      <main className="relative flex-1 min-h-0 flex overflow-hidden">
        <div className="relative flex-1 min-w-0 h-full">
          <RoomBuilder3D
            rooms={rooms}
            openings={openings}
            points={points}
            pointPositions={pointPositions}
            panels={panels}
            breakers={breakers}
            panelPositions={panelPositions}
            cableRoutes={cableRoutes}
            selectedRoomId={selectedRoomId}
            selectedOpeningId={selectedOpeningId}
            selectedPointId={selectedPointId}
            selectedPanelId={selectedPanelId}
            selectedBreakerId={selectedBreakerId}
            focusRequest={focusRequest}
            workspace={workspace}
            mode={mode}
            activePointCategory={activePointCategory}
            activePointPhase={activePointPhase}
            phaseFilter={phaseFilter}
            snapStep={snapStep}
            magneticSnap={magneticSnap}
            workElevation={workElevation}
            levelFilter={levelFilter}
            cutPlaneY={cutPlaneY}
            onLevelCutChange={handleLevelCutChange}
            onSelectRoom={handleSelectRoomFrom3D}
            onSelectOpening={handleSelectOpeningFrom3D}
            onSelectPoint={handleSelectPointFrom3D}
            onSelectPanel={handleSelectPanelFrom3D}
            onCreateRoom={handleCreateRoom}
            onUpdateRoom={handleUpdateRoom}
            onRoomTransformEnd={handleRoomTransformEnd}
            onCreateOpening={handleCreateOpening}
            onUpdateOpening={handleUpdateOpening}
            onCreatePoint={handleCreatePoint}
            onUpdatePointPosition={handleUpdatePointPosition}
            onCreatePanel={handleCreatePanel}
            onUpdatePanelPosition={handleUpdatePanelPosition}
            onUpdateCableRoute={handleUpdateCableRoute}
            onActivePointCategoryChange={setActivePointCategory}
            onActivePointPhaseChange={setActivePointPhase}
            onPhaseFilterChange={setPhaseFilter}
            onModeChange={handleModeChange}
            onInteractionStart={pushUndoSnapshot}
          />

          {/* Notification discrète d'import/export ZIP */}
          {fileNotice && (
            <div
              className={`absolute top-3 left-3 z-20 studio-panel rounded-xl px-3 py-1.5 text-xs font-medium ${
                fileNotice.tone === 'err' ? 'text-red-700 border-red-200' : 'text-slate-800'
              }`}
            >
              {fileNotice.text}
            </div>
          )}
        </div>

        {inspectorOpen && (
          <SideInspectorDrawer
            workspace={workspace}
            mode={mode}
            activePointCategory={activePointCategory}
            magneticSnap={magneticSnap}
            rooms={rooms}
            openings={openings}
            points={points}
            pointPositions={pointPositions}
            panels={panels}
            breakers={breakers}
            panelPositions={panelPositions}
            cableRoutes={cableRoutes}
            selectedRoomId={selectedRoomId}
            selectedOpeningId={selectedOpeningId}
            selectedPointId={selectedPointId}
            selectedPanelId={selectedPanelId}
            selectedBreakerId={selectedBreakerId}
            onClose={() => setInspectorOpen(false)}
            onSwitchWorkspace={handleWorkspaceChange}
            onModeChange={handleModeChange}
            onActivePointCategoryChange={setActivePointCategory}
            onSelectRoom={handleSelectRoomFromDrawer}
            onSelectOpening={handleSelectOpeningFromDrawer}
            onSelectPoint={handleSelectPointFromDrawer}
            onSelectPanel={handleSelectPanelFromDrawer}
            onSelectBreaker={setSelectedBreakerId}
            onFocusCircuit={handleFocusCircuit}
            onFocusPoint={handleFocusPoint}
            onUpdateRoom={handleUpdateRoom}
            onRenameBuilding={handleRenameBuilding}
            onAssignRoomBuilding={handleAssignRoomBuilding}
            onDeleteSelectedRoom={handleDeleteSelectedRoom}
            onDrawAboveSelected={handleDrawAboveSelected}
            onUpdateOpening={handleUpdateOpening}
            onDeleteOpening={handleDeleteOpening}
            onUpdatePoint={handleUpdatePoint}
            onUpdatePointPosition={handleUpdatePointPosition}
            onDeletePoint={handleDeletePoint}
            onUpdateBoardElement={handleUpdateBoardElement}
            onDeletePanel={handleDeletePanel}
            onAddBreaker={handleAddBreaker}
            onDeleteBreaker={handleDeleteBreaker}
            onUpdateCableRoute={handleUpdateCableRoute}
            onPushUndoSnapshot={pushUndoSnapshot}
          />
        )}
      </main>
    </div>
  );
}
