import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  Eye,
  LayoutGrid,
  Lightbulb,
  MapPin,
  Minus,
  PlugZap,
  Plus,
  RotateCcw,
  Search,
  SquarePlus,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import {
  BOARD_PHASE_META,
  BoardElement,
  BoardPhaseConfig,
  CableWaypoint,
  ElectricalPoint,
  InteractionMode,
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
} from '../types/room3d';
import { getBuildingSummaries } from '../utils/buildings';
import {
  computePanelBalance,
  findParentPanelForId,
  getDirectSubPanelsOfPanel,
  wouldCreatePanelCycle,
} from '../utils/electrical';

type OverviewTab = 'rooms' | 'panels';
type RoomCategoryTab = 'lumieres' | 'prises' | 'tableaux';

const WALL_LABELS: Record<WallSide, string> = {
  north: 'Mur Nord',
  south: 'Mur Sud',
  east: 'Mur Est',
  west: 'Mur Ouest',
};

function shortBreakerCode(el: BoardElement): string {
  const m = el.nom.match(/^([A-Za-z]+\d+)\b/);
  if (m) return m[1];
  return el.element_id;
}

function formatWattsCompact(watts: number): string {
  if (watts >= 1000) {
    return `${(watts / 1000).toFixed(1)} kW`;
  }
  return `${watts} W`;
}

function snapElevationToRooms(
  rawY: number,
  currentRoomId: string,
  rooms: RoomZone[],
  magneticSnap: boolean,
): number {
  if (!magneticSnap) return Number(rawY.toFixed(2));
  const candidates = new Set<number>([0]);
  for (const r of rooms) {
    if (r.zone_id === currentRoomId) continue;
    candidates.add(Number(r.y.toFixed(2)));
    candidates.add(Number((r.y + r.hauteur).toFixed(2)));
  }
  let best = Number(rawY.toFixed(2));
  let bestDiff = 0.06;
  for (const c of candidates) {
    const d = Math.abs(rawY - c);
    if (d <= bestDiff) {
      bestDiff = d;
      best = c;
    }
  }
  return best;
}

export interface SideInspectorDrawerProps {
  workspace: WorkspaceTab;
  mode: InteractionMode;
  activePointCategory: PointCategory;
  magneticSnap: boolean;
  rooms: RoomZone[];
  openings: RoomOpening[];
  points: ElectricalPoint[];
  pointPositions: Record<string, PointPosition3D>;
  panels: BoardElement[];
  breakers: BoardElement[];
  panelPositions: Record<string, PointPosition3D>;
  cableRoutes?: Record<string, CableWaypoint[]>;
  selectedRoomId: string | null;
  selectedOpeningId: string | null;
  selectedPointId: string | null;
  selectedPanelId: string | null;
  selectedBreakerId: string | null;
  onClose: () => void;
  onSwitchWorkspace: (tab: WorkspaceTab) => void;
  onModeChange: (mode: InteractionMode) => void;
  onActivePointCategoryChange: (cat: PointCategory) => void;
  onSelectRoom: (zoneId: string | null) => void;
  onSelectOpening: (openingId: string | null) => void;
  onSelectPoint: (pointId: string | null) => void;
  onSelectPanel: (panelId: string | null) => void;
  onSelectBreaker: (breakerId: string | null) => void;
  onFocusCircuit: (panelId: string, breakerId: string) => void;
  onFocusPoint: (pointId: string) => void;
  onUpdateRoom: (room: RoomZone) => void;
  onRenameBuilding: (buildingId: string, nextName: string) => void;
  onAssignRoomBuilding: (zoneId: string, targetBuildingId: string | '__new__') => void;
  onDeleteSelectedRoom: () => void;
  onDrawAboveSelected: () => void;
  onUpdateOpening: (opening: RoomOpening) => void;
  onDeleteOpening: (openingId: string) => void;
  onUpdatePoint: (point: ElectricalPoint) => void;
  onUpdatePointPosition: (pointId: string, pos: PointPosition3D) => void;
  onDeletePoint: (pointId: string) => void;
  onUpdateBoardElement: (el: BoardElement) => void;
  onDeletePanel: (panelId: string) => void;
  onAddBreaker: (panelId: string) => void;
  onDeleteBreaker: (breakerId: string) => void;
  onUpdateCableRoute?: (
    routeKey: string,
    waypoints: CableWaypoint[] | null,
    withUndo?: boolean,
  ) => void;
  onPushUndoSnapshot: () => void;
}

export const SideInspectorDrawer: React.FC<SideInspectorDrawerProps> = ({
  workspace,
  mode,
  activePointCategory,
  magneticSnap,
  rooms,
  openings,
  points,
  pointPositions,
  panels,
  breakers,
  panelPositions,
  cableRoutes = {},
  selectedRoomId,
  selectedOpeningId,
  selectedPointId,
  selectedPanelId,
  selectedBreakerId,
  onClose,
  onSwitchWorkspace,
  onModeChange,
  onActivePointCategoryChange,
  onSelectRoom,
  onSelectOpening,
  onSelectPoint,
  onSelectPanel,
  onSelectBreaker,
  onFocusCircuit,
  onFocusPoint,
  onUpdateRoom,
  onRenameBuilding,
  onAssignRoomBuilding,
  onDeleteSelectedRoom,
  onDrawAboveSelected,
  onUpdateOpening,
  onDeleteOpening,
  onUpdatePoint,
  onUpdatePointPosition,
  onDeletePoint,
  onUpdateBoardElement,
  onDeletePanel,
  onAddBreaker,
  onDeleteBreaker,
  onUpdateCableRoute,
  onPushUndoSnapshot,
}) => {
  const isConstruction = workspace === 'construction';

  const [overviewTab, setOverviewTab] = useState<OverviewTab>('rooms');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [roomCategoryTab, setRoomCategoryTab] = useState<RoomCategoryTab>('prises');
  const [roomPhaseFilter, setRoomPhaseFilter] = useState<PhaseFilter>('TOUTES');
  const [panelPhaseFilter, setPanelPhaseFilter] = useState<'TOUS' | BoardPhaseConfig>('TOUS');

  const selectedRoom = useMemo(
    () => rooms.find((r) => r.zone_id === selectedRoomId) ?? null,
    [rooms, selectedRoomId],
  );
  const selectedPanel = useMemo(
    () => panels.find((p) => p.element_id === selectedPanelId) ?? null,
    [panels, selectedPanelId],
  );
  const selectedPoint = useMemo(
    () => points.find((p) => p.point_id === selectedPointId) ?? null,
    [points, selectedPointId],
  );
  const selectedOpening = useMemo(
    () => openings.find((o) => o.opening_id === selectedOpeningId) ?? null,
    [openings, selectedOpeningId],
  );

  // Auto-sync room category tab when user picks a point directly in 3D
  useEffect(() => {
    if (selectedPoint) {
      setRoomCategoryTab(selectedPoint.categorie === 'lumiere' ? 'lumieres' : 'prises');
    }
  }, [selectedPoint]);

  const selectedPanelBreakers = useMemo(
    () => (selectedPanel ? breakers.filter((b) => b.parent_id === selectedPanel.element_id) : []),
    [breakers, selectedPanel],
  );

  const breakersById = useMemo(
    () => new Map(breakers.map((b) => [b.element_id, b])),
    [breakers],
  );
  const roomsById = useMemo(() => new Map(rooms.map((r) => [r.zone_id, r])), [rooms]);
  const panelsById = useMemo(() => new Map(panels.map((p) => [p.element_id, p])), [panels]);

  const totalHouseWatts = useMemo(
    () => points.reduce((acc, pt) => acc + (pt.puissance_est_w ?? 0), 0),
    [points],
  );

  const buildings = useMemo(() => getBuildingSummaries(rooms), [rooms]);

  // Determine strict 2-level screen:
  // Level 2B = Panel DIN Drawer
  // Level 2A = Room Summary Drawer
  // Level 1  = Exploration Overview
  const viewMode: 'panel' | 'room' | 'overview' = selectedPanel
    ? 'panel'
    : selectedRoom
      ? 'room'
      : 'overview';

  // ============================================================
  // LEVEL 1: EXPLORATION (PIÈCES & TABLEAUX)
  // ============================================================
  const renderOverview = () => {
    const q = searchQuery.trim().toLowerCase();

    const filteredRooms = rooms.filter((r) => {
      if (!q) return true;
      if (
        r.nom.toLowerCase().includes(q) ||
        r.zone_id.toLowerCase().includes(q) ||
        (r.buildingName || '').toLowerCase().includes(q)
      ) {
        return true;
      }
      return points.some(
        (pt) => pt.zone_id === r.zone_id && pt.nom.toLowerCase().includes(q),
      );
    });

    const filteredPanels = panels.filter((p) => {
      if (!q) return true;
      if (p.nom.toLowerCase().includes(q) || p.element_id.toLowerCase().includes(q)) return true;
      return breakers.some(
        (b) => b.parent_id === p.element_id && b.nom.toLowerCase().includes(q),
      );
    });

    const filteredBuildingGroups = getBuildingSummaries(filteredRooms);

    return (
      <>
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 shrink-0 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
                <Building2 className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Exploration · Niveau 1
                </div>
                <h2 className="text-sm font-bold text-slate-900 truncate">
                  {buildings.length > 1
                    ? `${buildings.length} bât. · ${rooms.length} pièce${rooms.length > 1 ? 's' : ''} · ${panels.length} tabl.`
                    : `${rooms.length} pièce${rooms.length > 1 ? 's' : ''} · ${panels.length} tableau${panels.length > 1 ? 'x' : ''}`}
                </h2>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-lg hover:bg-slate-200/70 flex items-center justify-center text-slate-400 hover:text-slate-700 shrink-0"
              title="Fermer le panneau"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Recherche rapide */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filtrer pièce, prise, disjoncteur..."
              className="w-full pl-8 pr-7 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-slate-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Onglets Pièces / Tableaux */}
          <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-slate-200/70">
            <button
              type="button"
              onClick={() => setOverviewTab('rooms')}
              className={`py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                overviewTab === 'rooms'
                  ? 'bg-white text-slate-950 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Pièces ({rooms.length})
            </button>
            <button
              type="button"
              onClick={() => setOverviewTab('panels')}
              className={`py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                overviewTab === 'panels'
                  ? 'bg-white text-slate-950 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Tableaux ({panels.length})
            </button>
          </div>
        </div>

        {/* Corps scrollable unique */}
        <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-3">
          {overviewTab === 'rooms' ? (
            filteredBuildingGroups.length > 0 ? (
              filteredBuildingGroups.map((bGroup) => {
                const bArea = bGroup.rooms.reduce(
                  (acc, r) => acc + r.largeur * r.profondeur,
                  0,
                );
                const bRoomIds = new Set(bGroup.rooms.map((r) => r.zone_id));
                const bWatts = points
                  .filter((p) => bRoomIds.has(p.zone_id))
                  .reduce((acc, p) => acc + (p.puissance_est_w ?? 0), 0);

                return (
                  <div key={bGroup.buildingId} className="flex flex-col gap-2">
                    {(buildings.length > 1 || isConstruction) && (
                      <div className="flex items-center justify-between gap-2 px-1">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <Building2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                          {isConstruction ? (
                            <input
                              type="text"
                              value={bGroup.buildingName}
                              onFocus={onPushUndoSnapshot}
                              onChange={(e) =>
                                onRenameBuilding(bGroup.buildingId, e.target.value)
                              }
                              className="min-w-0 flex-1 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-500 text-xs font-bold text-slate-800 outline-none py-0.5"
                            />
                          ) : (
                            <span className="text-xs font-bold text-slate-800 truncate">
                              {bGroup.buildingName}
                            </span>
                          )}
                        </div>
                        <span className="font-mono-num text-[10px] font-semibold text-slate-500 shrink-0">
                          {bGroup.rooms.length}p · {bArea.toFixed(0)}m² ·{' '}
                          {formatWattsCompact(bWatts)}
                        </span>
                      </div>
                    )}

                    {bGroup.rooms.map((room) => {
                      const rPoints = points.filter((p) => p.zone_id === room.zone_id);
                      const rLights = rPoints.filter((p) => p.categorie === 'lumiere');
                      const rSockets = rPoints.filter((p) => p.categorie !== 'lumiere');
                      const rPanels = panels.filter((p) => p.zone_id === room.zone_id);
                      const lightsW = rLights.reduce((s, p) => s + (p.puissance_est_w ?? 0), 0);
                      const socketsW = rSockets.reduce((s, p) => s + (p.puissance_est_w ?? 0), 0);
                      const l1W = rPoints
                        .filter((p) => p.phase_relevee === 'L1')
                        .reduce((s, p) => s + (p.puissance_est_w ?? 0), 0);
                      const l2W = rPoints
                        .filter((p) => p.phase_relevee === 'L2')
                        .reduce((s, p) => s + (p.puissance_est_w ?? 0), 0);
                      const l3W = rPoints
                        .filter((p) => p.phase_relevee === 'L3')
                        .reduce((s, p) => s + (p.puissance_est_w ?? 0), 0);
                      const area = (room.largeur * room.profondeur).toFixed(1);

                      return (
                        <button
                          key={room.zone_id}
                          type="button"
                          onClick={() => {
                            onSelectOpening(null);
                            onSelectPoint(null);
                            onSelectPanel(null);
                            onSelectRoom(room.zone_id);
                          }}
                          className="w-full text-left bg-white border border-slate-200 hover:border-slate-400 rounded-xl p-3 flex flex-col gap-2.5 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-bold text-slate-900 truncate">
                                {room.nom}
                              </div>
                              <div className="font-mono-num text-[11px] text-slate-500 mt-0.5">
                                {room.y === 0 ? 'RDC' : `Alt. ${room.y.toFixed(1)}m`} · {area} m²
                                · H {room.hauteur.toFixed(1)}m
                              </div>
                            </div>
                            <span className="text-[11px] font-semibold text-indigo-600 shrink-0">
                              Ouvrir →
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-1.5">
                            <div className="rounded-lg bg-slate-50 border border-slate-200/70 px-2 py-1.5 text-center">
                              <div className="flex items-center justify-center gap-1 text-xs font-bold text-slate-900">
                                <Lightbulb className="w-3 h-3 text-indigo-600" />
                                <span className="font-mono-num">{rLights.length}</span>
                              </div>
                              <div className="text-[10px] text-slate-500">Lumières</div>
                              <div className="font-mono-num text-[10px] font-semibold text-slate-700">
                                {formatWattsCompact(lightsW)}
                              </div>
                            </div>
                            <div className="rounded-lg bg-slate-50 border border-slate-200/70 px-2 py-1.5 text-center">
                              <div className="flex items-center justify-center gap-1 text-xs font-bold text-slate-900">
                                <PlugZap className="w-3 h-3 text-rose-600" />
                                <span className="font-mono-num">{rSockets.length}</span>
                              </div>
                              <div className="text-[10px] text-slate-500">Prises</div>
                              <div className="font-mono-num text-[10px] font-semibold text-slate-700">
                                {formatWattsCompact(socketsW)}
                              </div>
                            </div>
                            <div className="rounded-lg bg-slate-50 border border-slate-200/70 px-2 py-1.5 text-center">
                              <div className="flex items-center justify-center gap-1 text-xs font-bold text-slate-900">
                                <LayoutGrid className="w-3 h-3 text-slate-700" />
                                <span className="font-mono-num">{rPanels.length}</span>
                              </div>
                              <div className="text-[10px] text-slate-500">Tableau</div>
                              <div className="font-mono-num text-[10px] font-semibold text-slate-700 truncate">
                                {rPanels[0] ? shortBreakerCode(rPanels[0]) : '—'}
                              </div>
                            </div>
                          </div>

                          {rPoints.length > 0 && (
                            <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between font-mono-num text-[10px]">
                              <span className="text-slate-400 font-semibold uppercase">Phases</span>
                              <div className="flex items-center gap-2.5">
                                <span className={`font-semibold ${PHASE_META.L1.textClass}`}>
                                  L1 {formatWattsCompact(l1W)}
                                </span>
                                <span className={`font-semibold ${PHASE_META.L2.textClass}`}>
                                  L2 {formatWattsCompact(l2W)}
                                </span>
                                <span className={`font-semibold ${PHASE_META.L3.textClass}`}>
                                  L3 {formatWattsCompact(l3W)}
                                </span>
                              </div>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })
            ) : (
              <p className="text-xs text-slate-500 text-center py-8">
                Aucune pièce ne correspond à « {searchQuery} ».
              </p>
            )
          ) : filteredPanels.length > 0 ? (
            filteredPanels.map((panel) => {
              const room = roomsById.get(panel.zone_id);
              const wall = panelPositions[panel.element_id]?.wall;
              const pBreakers = breakers.filter((b) => b.parent_id === panel.element_id);
              const balance = computePanelBalance(panel.element_id, panels, breakers, points);
              const parentInfo = findParentPanelForId(panel.parent_id, panelsById, breakersById);
              const subCount = getDirectSubPanelsOfPanel(panel.element_id, panels, breakers).length;
              const breakerIds = new Set(pBreakers.map((b) => b.element_id));
              const fedPoints = points.filter((pt) => breakerIds.has(pt.disjoncteur_id));
              const meta = BOARD_PHASE_META[panel.phases];

              return (
                <button
                  key={panel.element_id}
                  type="button"
                  onClick={() => {
                    onSelectRoom(panel.zone_id);
                    onSelectOpening(null);
                    onSelectPoint(null);
                    onSelectBreaker(null);
                    onSelectPanel(panel.element_id);
                  }}
                  className="w-full text-left bg-white border border-slate-200 hover:border-slate-400 rounded-xl p-3 flex flex-col gap-2 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-xs shrink-0"
                          style={{ backgroundColor: meta.hex }}
                        />
                        <span className="text-sm font-bold text-slate-900 truncate">
                          {panel.nom}
                        </span>
                      </div>
                      <div className="font-mono-num text-[11px] text-slate-500 mt-0.5 truncate">
                        {panel.element_id}
                        {room
                          ? ` · ${buildings.length > 1 && room.buildingName ? `${room.buildingName} / ` : ''}${room.nom}`
                          : ''}
                        {wall ? ` · ${WALL_LABELS[wall]}` : ''}
                      </div>
                      {parentInfo && (
                        <div className="text-[10px] font-semibold text-indigo-700 mt-0.5 truncate">
                          ← Alimenté par {parentInfo.parentPanel.nom}
                          {parentInfo.feederBreaker
                            ? ` (${shortBreakerCode(parentInfo.feederBreaker)})`
                            : ''}
                        </div>
                      )}
                    </div>
                    <span
                      className={`px-1.5 py-0.5 rounded font-mono-num text-[10px] font-bold text-white shrink-0 ${meta.bgClass}`}
                    >
                      {meta.shortLabel}
                    </span>
                  </div>

                  <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between font-mono-num text-[11px] text-slate-600">
                    <span>
                      {pBreakers.length} disj. · {fedPoints.length} pt
                      {fedPoints.length > 1 ? 's' : ''}
                      {subCount > 0 ? ` · ${subCount} sous-tabl.` : ''}
                    </span>
                    <span className="font-bold text-slate-900">
                      {formatWattsCompact(balance.totalW)}
                    </span>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="text-center py-8 flex flex-col items-center gap-2.5">
              <p className="text-xs text-slate-500">Aucun tableau électrique posé pour l’instant.</p>
              {isConstruction && rooms.length > 0 && (
                <button
                  type="button"
                  onClick={() => onModeChange('panel')}
                  className="px-3 py-1.5 rounded-lg studio-btn text-xs font-semibold text-slate-800 flex items-center gap-1.5"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  Poser un tableau sur un mur
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer Level 1 */}
        <div className="px-4 py-2.5 border-t border-slate-200 bg-slate-50/70 shrink-0 flex items-center justify-between gap-2 text-xs">
          {isConstruction ? (
            <button
              type="button"
              onClick={() =>
                onModeChange(overviewTab === 'panels' && rooms.length > 0 ? 'panel' : 'draw')
              }
              className="font-semibold text-indigo-700 hover:text-indigo-900 flex items-center gap-1 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              {overviewTab === 'panels' && rooms.length > 0 ? 'Poser un tableau' : 'Tracer une pièce'}
            </button>
          ) : (
            <span className="text-[11px] text-slate-500">Lecture seule</span>
          )}
          <span className="font-mono-num text-[11px] text-slate-500">
            Total : <strong className="text-slate-900">{formatWattsCompact(totalHouseWatts)}</strong>
          </span>
        </div>
      </>
    );
  };

  // ============================================================
  // LEVEL 2A: PANNEAU PIÈCE (SANS 3e TIROIR)
  // ============================================================
  const renderRoomPanel = (room: RoomZone) => {
    const roomPoints = points.filter((p) => p.zone_id === room.zone_id);
    const roomLights = roomPoints.filter((p) => p.categorie === 'lumiere');
    const roomSockets = roomPoints.filter((p) => p.categorie !== 'lumiere');
    const roomPanels = panels.filter((p) => p.zone_id === room.zone_id);

    const phaseTotals: Record<PhaseCode, { watts: number; count: number }> = {
      L1: { watts: 0, count: 0 },
      L2: { watts: 0, count: 0 },
      L3: { watts: 0, count: 0 },
      INCONNU: { watts: 0, count: 0 },
    };
    let roomTotalW = 0;
    for (const pt of roomPoints) {
      const w = pt.puissance_est_w ?? 0;
      phaseTotals[pt.phase_relevee].count += 1;
      phaseTotals[pt.phase_relevee].watts += w;
      roomTotalW += w;
    }

    const activeRawPoints = roomCategoryTab === 'lumieres' ? roomLights : roomSockets;
    const filteredPoints =
      roomPhaseFilter === 'TOUTES'
        ? activeRawPoints
        : activeRawPoints.filter((pt) => pt.phase_relevee === roomPhaseFilter);

    const area = (room.largeur * room.profondeur).toFixed(1);

    const renderPointCard = (pt: ElectricalPoint) => {
      const isSelected = pt.point_id === selectedPointId;
      const meta = PHASE_META[pt.phase_relevee];
      const pos = pointPositions[pt.point_id];
      const br = pt.disjoncteur_id ? breakersById.get(pt.disjoncteur_id) ?? null : null;
      const parentPanel = br ? panelsById.get(br.parent_id) ?? null : null;
      const surfaceLabel = pos?.wall
        ? WALL_LABELS[pos.wall]
        : pt.categorie === 'lumiere'
          ? 'Plafond'
          : 'Mur';

      return (
        <div
          key={pt.point_id}
          className={`rounded-xl border transition-colors ${
            isSelected
              ? 'border-2 border-indigo-600 bg-indigo-50/20 shadow-xs'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          {/* Résumé cliquable */}
          <div
            onClick={() => {
              onSelectOpening(null);
              onSelectPoint(isSelected ? null : pt.point_id);
            }}
            className="p-2.5 cursor-pointer flex items-start justify-between gap-2"
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <span
                className={`px-1.5 py-0.5 rounded font-mono-num text-[10px] font-bold text-white shrink-0 mt-0.5 ${meta.bgClass}`}
              >
                {meta.shortLabel}
              </span>
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-900 truncate">{pt.nom}</div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 mt-0.5">
                  <span className="flex items-center gap-0.5">
                    <MapPin className="w-3 h-3 text-slate-400" />
                    {surfaceLabel}
                  </span>
                  <span>·</span>
                  <span
                    className={`font-mono-num text-[10px] font-semibold px-1.5 py-0.2 rounded ${
                      br
                        ? 'bg-slate-100 text-slate-700'
                        : 'bg-slate-100/70 text-slate-400'
                    }`}
                  >
                    {br
                      ? `${shortBreakerCode(br)}${br.calibre_a ? ` (${br.calibre_a}A)` : ''}`
                      : 'Non raccordé'}
                  </span>
                </div>
              </div>
            </div>

            <div className="text-right shrink-0">
              <span className="font-mono-num text-xs font-bold text-slate-900">
                {pt.puissance_est_w !== null ? `${pt.puissance_est_w} W` : '—'}
              </span>
              {isSelected && (
                <span className="block text-[9px] font-bold uppercase text-indigo-600 mt-0.5">
                  Édition
                </span>
              )}
            </div>
          </div>

          {/* Édition / consultation inline (zéro 3e tiroir !) */}
          {isSelected && (
            <div className="px-2.5 pb-2.5 pt-2 border-t border-slate-200/80 flex flex-col gap-2 bg-white/80 rounded-b-xl">
              {isConstruction ? (
                <>
                  <div className="grid grid-cols-3 gap-1.5">
                    <input
                      type="text"
                      value={pt.nom}
                      placeholder="Nom du point"
                      onFocus={onPushUndoSnapshot}
                      onChange={(e) => onUpdatePoint({ ...pt, nom: e.target.value })}
                      className="col-span-2 px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 outline-none focus:border-slate-400"
                    />
                    <select
                      value={pt.categorie === 'lumiere' ? 'lumiere' : 'prise'}
                      onChange={(e) => {
                        const cat = e.target.value as PointCategory;
                        onPushUndoSnapshot();
                        onUpdatePoint({ ...pt, categorie: cat });
                        if (cat !== 'lumiere' && pos && !pos.wall) {
                          onUpdatePointPosition(pt.point_id, {
                            x: pos.x,
                            y: 0.3,
                            z: Number((-room.profondeur / 2).toFixed(2)),
                            wall: 'north',
                          });
                        }
                      }}
                      className="px-1.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-medium text-slate-800 outline-none"
                    >
                      <option value="prise">Prise</option>
                      <option value="lumiere">Lumière</option>
                    </select>
                  </div>

                  {/* Bascule phase directe */}
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-[11px] font-medium text-slate-500 shrink-0">Phase :</span>
                    <div className="grid grid-cols-4 gap-1 flex-1">
                      {(['L1', 'L2', 'L3', 'INCONNU'] as PhaseCode[]).map((ph) => {
                        const pMeta = PHASE_META[ph];
                        const active = pt.phase_relevee === ph;
                        return (
                          <button
                            key={ph}
                            type="button"
                            onClick={() => {
                              onPushUndoSnapshot();
                              onUpdatePoint({ ...pt, phase_relevee: ph });
                            }}
                            className={`py-1 rounded-md font-mono-num text-[11px] font-bold flex items-center justify-center gap-1 border transition-colors ${
                              active
                                ? `${pMeta.bgClass} text-white border-transparent`
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            {pMeta.shortLabel}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Disjoncteur & Puissance */}
                  <div className="grid grid-cols-3 gap-1.5">
                    <select
                      value={pt.disjoncteur_id}
                      onChange={(e) => {
                        onPushUndoSnapshot();
                        const nextId = e.target.value;
                        const chosen = breakersById.get(nextId);
                        const nextPhase =
                          pt.phase_relevee === 'INCONNU' &&
                          chosen &&
                          (chosen.phases === 'L1' ||
                            chosen.phases === 'L2' ||
                            chosen.phases === 'L3')
                            ? chosen.phases
                            : pt.phase_relevee;
                        onUpdatePoint({
                          ...pt,
                          disjoncteur_id: nextId,
                          phase_relevee: nextPhase,
                        });
                      }}
                      className="col-span-2 px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-medium text-slate-800 outline-none"
                    >
                      <option value="">Non raccordé</option>
                      {panels.map((p) => {
                        const childBreakers = breakers.filter((b) => b.parent_id === p.element_id);
                        if (childBreakers.length === 0) return null;
                        return (
                          <optgroup key={p.element_id} label={p.nom}>
                            {childBreakers.map((b) => (
                              <option key={b.element_id} value={b.element_id}>
                                {b.nom} ({BOARD_PHASE_META[b.phases].shortLabel}
                                {b.calibre_a ? ` · ${b.calibre_a}A` : ''})
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        step={50}
                        value={pt.puissance_est_w ?? ''}
                        placeholder="0"
                        onFocus={onPushUndoSnapshot}
                        onChange={(e) => {
                          const val = e.target.value.trim();
                          onUpdatePoint({
                            ...pt,
                            puissance_est_w: val === '' ? null : Math.max(0, Number(val)),
                          });
                        }}
                        className="w-full pl-2 pr-6 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono-num text-slate-900 outline-none focus:border-slate-400"
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 font-mono-num text-[10px] text-slate-400 pointer-events-none">
                        W
                      </span>
                    </div>
                  </div>

                  {/* Appareil, Note & Suppression */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      type="text"
                      value={pt.type_appareil}
                      placeholder="Appareil"
                      onFocus={onPushUndoSnapshot}
                      onChange={(e) => onUpdatePoint({ ...pt, type_appareil: e.target.value })}
                      className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-800 outline-none focus:border-slate-400"
                    />
                    <input
                      type="text"
                      value={pt.note}
                      placeholder="Note libre..."
                      onFocus={onPushUndoSnapshot}
                      onChange={(e) => onUpdatePoint({ ...pt, note: e.target.value })}
                      className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-700 outline-none focus:border-slate-400"
                    />
                  </div>

                  {pt.disjoncteur_id && onUpdateCableRoute && (
                    <div className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-slate-50 border border-slate-200/80 text-[10px]">
                      {cableRoutes[`point:${pt.point_id}`]?.length ? (
                        <>
                          <span className="font-semibold text-blue-700">
                            Tracé câble personnalisé
                          </span>
                          <button
                            type="button"
                            onClick={() => onUpdateCableRoute(`point:${pt.point_id}`, null, true)}
                            className="inline-flex items-center gap-1 font-semibold text-slate-600 hover:text-slate-900"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Réinitialiser
                          </button>
                        </>
                      ) : (
                        <span className="text-slate-500">
                          Tracé câble auto — glissez segments ou coudes en 3D
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {br && parentPanel && (
                        <button
                          type="button"
                          onClick={() => {
                            onSelectPoint(null);
                            onSelectRoom(parentPanel.zone_id);
                            onSelectPanel(parentPanel.element_id);
                            onSelectBreaker(br.element_id);
                          }}
                          className="px-2 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-[11px] font-semibold text-indigo-700"
                        >
                          Coffret →
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onFocusPoint(pt.point_id)}
                        className="px-2 py-1 rounded-lg text-[11px] font-semibold text-slate-600 hover:bg-slate-100 flex items-center gap-1"
                        title="Cadrer ce point en 3D"
                      >
                        <Eye className="w-3 h-3" />
                        3D
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeletePoint(pt.point_id)}
                      className="px-2 py-1 rounded-lg text-[11px] font-semibold text-red-600 hover:bg-red-50 flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      Supprimer
                    </button>
                  </div>
                </>
              ) : (
                /* Lecture seule en Exploitation */
                <div className="flex flex-col gap-1.5 text-xs">
                  <div className="flex items-center justify-between text-[11px] text-slate-600">
                    <span>
                      Catégorie :{' '}
                      <strong className="text-slate-900">
                        {POINT_CATEGORY_LABELS[pt.categorie]}
                      </strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => onFocusPoint(pt.point_id)}
                      className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-[10px] font-semibold text-slate-700 flex items-center gap-1"
                      title="Cadrer ce point en 3D"
                    >
                      <Eye className="w-3 h-3" />
                      Cadrer 3D
                    </button>
                  </div>
                  {br && parentPanel && (
                    <button
                      type="button"
                      onClick={() => {
                        onSelectPoint(null);
                        onSelectRoom(parentPanel.zone_id);
                        onSelectPanel(parentPanel.element_id);
                        onSelectBreaker(br.element_id);
                      }}
                      className="w-full px-2 py-1.5 rounded-lg bg-slate-100/80 hover:bg-slate-200/70 text-[11px] font-medium text-slate-800 flex items-center justify-between gap-2 text-left"
                    >
                      <span className="truncate">
                        {parentPanel.nom} · {br.nom}
                      </span>
                      <span className="text-indigo-700 font-semibold shrink-0">Coffret →</span>
                    </button>
                  )}
                  {(pt.type_appareil || pt.note) && (
                    <div className="text-[11px] text-slate-600 flex flex-col gap-0.5">
                      {pt.type_appareil && (
                        <div>
                          <span className="text-slate-400">Appareil : </span>
                          <span className="font-medium text-slate-800">{pt.type_appareil}</span>
                        </div>
                      )}
                      {pt.note && (
                        <div>
                          <span className="text-slate-400">Note : </span>
                          <span>{pt.note}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      );
    };

    return (
      <>
        {/* Header Pièce */}
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 shrink-0 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                onSelectOpening(null);
                onSelectPoint(null);
                onSelectPanel(null);
                onSelectRoom(null);
              }}
              className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-950"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Toutes les pièces
            </button>
            <div className="flex items-center gap-2">
              <span className="font-mono-num text-[10px] font-semibold text-slate-400">
                {room.zone_id}
              </span>
              <button
                type="button"
                onClick={onClose}
                className="w-6 h-6 rounded-lg hover:bg-slate-200/70 flex items-center justify-center text-slate-400 hover:text-slate-700 shrink-0"
                title="Fermer le panneau"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {isConstruction ? (
            <div className="flex flex-col gap-1.5">
              <input
                type="text"
                value={room.nom}
                onFocus={onPushUndoSnapshot}
                onChange={(e) => onUpdateRoom({ ...room, nom: e.target.value })}
                className="w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-sm font-bold text-slate-900 outline-none focus:border-slate-400"
              />
              <div className="flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                <select
                  value={room.buildingId || 'BAT_1'}
                  onChange={(e) => onAssignRoomBuilding(room.zone_id, e.target.value)}
                  className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-slate-800 outline-none"
                  title="Bâtiment d'appartenance"
                >
                  {buildings.map((b) => (
                    <option key={b.buildingId} value={b.buildingId}>
                      {b.buildingName} ({b.rooms.length} p.)
                    </option>
                  ))}
                  <option value="__new__">+ Nouveau bâtiment indépendant</option>
                </select>
                <input
                  type="text"
                  value={room.buildingName || 'Bâtiment 1'}
                  onFocus={onPushUndoSnapshot}
                  onChange={(e) =>
                    onRenameBuilding(room.buildingId || 'BAT_1', e.target.value)
                  }
                  placeholder="Nom du bâtiment"
                  className="w-32 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-medium text-slate-700 outline-none focus:border-slate-400"
                  title="Renommer ce bâtiment"
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-bold text-slate-900 truncate">{room.nom}</h2>
              <span className="px-2 py-0.5 rounded bg-slate-100 text-[10px] font-semibold text-slate-600 shrink-0">
                {room.buildingName || 'Bâtiment 1'}
              </span>
            </div>
          )}

          {/* Géométrie & Steppers Sol / Hauteur */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="font-mono-num text-[11px] text-slate-500">
              {room.largeur.toFixed(1)} × {room.profondeur.toFixed(1)} m · {area} m²
            </span>
            {isConstruction ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-1.5 py-0.5">
                  <span className="text-[10px] text-slate-400 font-medium">Sol</span>
                  <button
                    type="button"
                    onClick={() => {
                      onPushUndoSnapshot();
                      const nextY = snapElevationToRooms(
                        Math.max(-3, Number((room.y - 0.1).toFixed(2))),
                        room.zone_id,
                        rooms,
                        magneticSnap,
                      );
                      onUpdateRoom({ ...room, y: nextY });
                    }}
                    className="w-4 h-4 rounded hover:bg-slate-100 flex items-center justify-center text-slate-600"
                  >
                    <Minus className="w-2.5 h-2.5" />
                  </button>
                  <span className="font-mono-num text-[11px] font-semibold text-slate-800">
                    {room.y.toFixed(2)}m
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onPushUndoSnapshot();
                      const nextY = snapElevationToRooms(
                        Math.min(6, Number((room.y + 0.1).toFixed(2))),
                        room.zone_id,
                        rooms,
                        magneticSnap,
                      );
                      onUpdateRoom({ ...room, y: nextY });
                    }}
                    className="w-4 h-4 rounded hover:bg-slate-100 flex items-center justify-center text-slate-600"
                  >
                    <Plus className="w-2.5 h-2.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-1.5 py-0.5">
                  <span className="text-[10px] text-slate-400 font-medium">H</span>
                  <button
                    type="button"
                    onClick={() => {
                      onPushUndoSnapshot();
                      onUpdateRoom({
                        ...room,
                        hauteur: Math.max(1.8, Number((room.hauteur - 0.1).toFixed(1))),
                      });
                    }}
                    className="w-4 h-4 rounded hover:bg-slate-100 flex items-center justify-center text-slate-600"
                  >
                    <Minus className="w-2.5 h-2.5" />
                  </button>
                  <span className="font-mono-num text-[11px] font-semibold text-slate-800">
                    {room.hauteur.toFixed(1)}m
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onPushUndoSnapshot();
                      onUpdateRoom({
                        ...room,
                        hauteur: Math.min(5.0, Number((room.hauteur + 0.1).toFixed(1))),
                      });
                    }}
                    className="w-4 h-4 rounded hover:bg-slate-100 flex items-center justify-center text-slate-600"
                  >
                    <Plus className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>
            ) : (
              <span className="font-mono-num text-[11px] text-slate-500">
                H {room.hauteur.toFixed(1)}m · {formatWattsCompact(roomTotalW)}
              </span>
            )}
          </div>

          {/* Bandeau synthèse phases de la pièce */}
          <div className="grid grid-cols-4 gap-1">
            {(['L1', 'L2', 'L3', 'INCONNU'] as PhaseCode[]).map((ph) => {
              const meta = PHASE_META[ph];
              const d = phaseTotals[ph];
              return (
                <div
                  key={ph}
                  className="bg-white border border-slate-200/80 rounded-lg px-1.5 py-1 flex flex-col"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="flex items-center gap-1 text-[10px] font-bold text-slate-700">
                      <span
                        className="w-1.5 h-1.5 rounded-xs shrink-0"
                        style={{ backgroundColor: meta.hex }}
                      />
                      {meta.shortLabel}
                    </span>
                    <span className="font-mono-num text-[10px] text-slate-400">{d.count}</span>
                  </div>
                  <span className="font-mono-num text-[11px] font-bold text-slate-900 mt-0.5">
                    {formatWattsCompact(d.watts)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Tuiles de catégories (zéro listes empilées) */}
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => setRoomCategoryTab('prises')}
              className={`rounded-xl p-2 text-center border transition-colors ${
                roomCategoryTab === 'prises'
                  ? 'bg-rose-50/70 border-rose-500 text-slate-950'
                  : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
              }`}
            >
              <PlugZap
                className={`w-4 h-4 mx-auto ${
                  roomCategoryTab === 'prises' ? 'text-rose-600' : 'text-slate-500'
                }`}
              />
              <div className="text-[11px] font-bold mt-1">Prises</div>
              <div className="font-mono-num text-[10px] text-slate-500">{roomSockets.length}</div>
            </button>

            <button
              type="button"
              onClick={() => setRoomCategoryTab('lumieres')}
              className={`rounded-xl p-2 text-center border transition-colors ${
                roomCategoryTab === 'lumieres'
                  ? 'bg-indigo-50/70 border-indigo-600 text-slate-950'
                  : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
              }`}
            >
              <Lightbulb
                className={`w-4 h-4 mx-auto ${
                  roomCategoryTab === 'lumieres' ? 'text-indigo-600' : 'text-slate-500'
                }`}
              />
              <div className="text-[11px] font-bold mt-1">Lumières</div>
              <div className="font-mono-num text-[10px] text-slate-500">{roomLights.length}</div>
            </button>

            <button
              type="button"
              onClick={() => setRoomCategoryTab('tableaux')}
              className={`rounded-xl p-2 text-center border transition-colors ${
                roomCategoryTab === 'tableaux'
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
              }`}
            >
              <LayoutGrid
                className={`w-4 h-4 mx-auto ${
                  roomCategoryTab === 'tableaux' ? 'text-white' : 'text-slate-500'
                }`}
              />
              <div className="text-[11px] font-bold mt-1">Tableaux</div>
              <div
                className={`font-mono-num text-[10px] ${
                  roomCategoryTab === 'tableaux' ? 'text-slate-300' : 'text-slate-500'
                }`}
              >
                {roomPanels.length}
              </div>
            </button>
          </div>
        </div>

        {/* Corps scrollable unique de la catégorie active */}
        <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-2.5">
          {isConstruction && selectedOpening && selectedOpening.zone_id === room.zone_id && (
            <div className="rounded-xl border border-sky-300 bg-sky-50/60 p-2.5 flex flex-col gap-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-900">
                  {selectedOpening.type === 'porte' ? 'Porte' : 'Fenêtre'} ·{' '}
                  {WALL_LABELS[selectedOpening.wall]}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onDeleteOpening(selectedOpening.opening_id)}
                    className="px-1.5 py-0.5 rounded text-[11px] font-semibold text-red-600 hover:bg-red-50 flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    Suppr.
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectOpening(null)}
                    className="w-5 h-5 rounded hover:bg-sky-100 flex items-center justify-center text-slate-500"
                    title="Fermer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-1.5 py-0.5">
                  <span className="text-[10px] text-slate-500">Larg.</span>
                  <button
                    type="button"
                    onClick={() => {
                      onPushUndoSnapshot();
                      onUpdateOpening({
                        ...selectedOpening,
                        width: Math.max(0.5, Number((selectedOpening.width - 0.1).toFixed(2))),
                      });
                    }}
                    className="w-4 h-4 rounded hover:bg-slate-100 flex items-center justify-center"
                  >
                    <Minus className="w-2.5 h-2.5" />
                  </button>
                  <span className="font-mono-num text-[11px] font-semibold">
                    {selectedOpening.width.toFixed(1)}m
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onPushUndoSnapshot();
                      onUpdateOpening({
                        ...selectedOpening,
                        width: Math.min(4.0, Number((selectedOpening.width + 0.1).toFixed(2))),
                      });
                    }}
                    className="w-4 h-4 rounded hover:bg-slate-100 flex items-center justify-center"
                  >
                    <Plus className="w-2.5 h-2.5" />
                  </button>
                </div>

                {selectedOpening.type === 'fenetre' && (
                  <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-1.5 py-0.5">
                    <span className="text-[10px] text-slate-500">Allège</span>
                    <button
                      type="button"
                      onClick={() => {
                        onPushUndoSnapshot();
                        onUpdateOpening({
                          ...selectedOpening,
                          sillHeight: Math.max(
                            0,
                            Number((selectedOpening.sillHeight - 0.1).toFixed(2)),
                          ),
                        });
                      }}
                      className="w-4 h-4 rounded hover:bg-slate-100 flex items-center justify-center"
                    >
                      <Minus className="w-2.5 h-2.5" />
                    </button>
                    <span className="font-mono-num text-[11px] font-semibold">
                      {selectedOpening.sillHeight.toFixed(1)}m
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onPushUndoSnapshot();
                        const maxSill = Math.max(0, room.hauteur - selectedOpening.height - 0.05);
                        onUpdateOpening({
                          ...selectedOpening,
                          sillHeight: Math.min(
                            maxSill,
                            Number((selectedOpening.sillHeight + 0.1).toFixed(2)),
                          ),
                        });
                      }}
                      className="w-4 h-4 rounded hover:bg-slate-100 flex items-center justify-center"
                    >
                      <Plus className="w-2.5 h-2.5" />
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-1.5 py-0.5">
                  <span className="text-[10px] text-slate-500">Haut.</span>
                  <button
                    type="button"
                    onClick={() => {
                      onPushUndoSnapshot();
                      onUpdateOpening({
                        ...selectedOpening,
                        height: Math.max(0.6, Number((selectedOpening.height - 0.1).toFixed(2))),
                      });
                    }}
                    className="w-4 h-4 rounded hover:bg-slate-100 flex items-center justify-center"
                  >
                    <Minus className="w-2.5 h-2.5" />
                  </button>
                  <span className="font-mono-num text-[11px] font-semibold">
                    {selectedOpening.height.toFixed(1)}m
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onPushUndoSnapshot();
                      const maxH = Math.max(0.8, room.hauteur - selectedOpening.sillHeight - 0.05);
                      onUpdateOpening({
                        ...selectedOpening,
                        height: Math.min(maxH, Number((selectedOpening.height + 0.1).toFixed(2))),
                      });
                    }}
                    className="w-4 h-4 rounded hover:bg-slate-100 flex items-center justify-center"
                  >
                    <Plus className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
          {(roomCategoryTab === 'prises' || roomCategoryTab === 'lumieres') && (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  {(['TOUTES', 'L1', 'L2', 'L3', 'INCONNU'] as PhaseFilter[]).map((f) => {
                    const active = roomPhaseFilter === f;
                    const label = f === 'TOUTES' ? 'Tout' : PHASE_META[f].shortLabel;
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setRoomPhaseFilter(f)}
                        className={`px-2 py-0.5 rounded font-mono-num text-[10px] font-bold transition-colors ${
                          active
                            ? f === 'TOUTES'
                              ? 'bg-slate-900 text-white'
                              : `${PHASE_META[f].bgClass} text-white`
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {isConstruction && (
                  <button
                    type="button"
                    onClick={() => {
                      const targetCat: PointCategory =
                        roomCategoryTab === 'lumieres' ? 'lumiere' : 'prise';
                      if (mode === 'point' && activePointCategory === targetCat) {
                        onModeChange('select');
                      } else {
                        onActivePointCategoryChange(targetCat);
                        onModeChange('point');
                      }
                    }}
                    className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 shrink-0 ${
                      mode === 'point' &&
                      ((roomCategoryTab === 'lumieres' && activePointCategory === 'lumiere') ||
                        (roomCategoryTab === 'prises' && activePointCategory === 'prise'))
                        ? roomCategoryTab === 'lumieres'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-rose-600 text-white'
                        : 'studio-btn text-slate-800'
                    }`}
                  >
                    <Plus className="w-3 h-3" />
                    {roomCategoryTab === 'lumieres' ? 'Lumière' : 'Prise'}
                  </button>
                )}
              </div>

              {filteredPoints.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {filteredPoints.map((pt) => renderPointCard(pt))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 text-center py-8">
                  {activeRawPoints.length === 0
                    ? roomCategoryTab === 'lumieres'
                      ? 'Aucune lumière dans cette pièce.'
                      : 'Aucune prise dans cette pièce.'
                    : 'Aucun point sur cette phase.'}
                </p>
              )}
            </>
          )}

          {roomCategoryTab === 'tableaux' && (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Boîtiers dans la pièce ({roomPanels.length})
                </span>
                {isConstruction && (
                  <button
                    type="button"
                    onClick={() => onModeChange(mode === 'panel' ? 'select' : 'panel')}
                    className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 shrink-0 ${
                      mode === 'panel'
                        ? 'bg-slate-900 text-white'
                        : 'studio-btn text-slate-800'
                    }`}
                  >
                    <Plus className="w-3 h-3" />
                    Tableau
                  </button>
                )}
              </div>

              {roomPanels.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {roomPanels.map((pl) => {
                    const meta = BOARD_PHASE_META[pl.phases];
                    const wall = panelPositions[pl.element_id]?.wall;
                    const pBreakers = breakers.filter((b) => b.parent_id === pl.element_id);
                    const fedW = computePanelBalance(pl.element_id, panels, breakers, points).totalW;
                    const parentInfo = findParentPanelForId(
                      pl.parent_id,
                      panelsById,
                      breakersById,
                    );
                    return (
                      <div
                        key={pl.element_id}
                        className="p-3 rounded-xl border border-slate-200 bg-white flex flex-col gap-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="w-2.5 h-2.5 rounded-xs shrink-0"
                                style={{ backgroundColor: meta.hex }}
                              />
                              <span className="text-xs font-bold text-slate-900 truncate">
                                {pl.nom}
                              </span>
                            </div>
                            <div className="font-mono-num text-[11px] text-slate-500 mt-0.5">
                              {pl.element_id}
                              {wall ? ` · ${WALL_LABELS[wall]}` : ''} · {pBreakers.length} disj. ·{' '}
                              {formatWattsCompact(fedW)}
                            </div>
                            {parentInfo && (
                              <div className="text-[10px] font-semibold text-indigo-700 mt-0.5 truncate">
                                ← {parentInfo.parentPanel.nom}
                                {parentInfo.feederBreaker
                                  ? ` (${shortBreakerCode(parentInfo.feederBreaker)})`
                                  : ''}
                              </div>
                            )}
                          </div>
                          <span
                            className={`px-1.5 py-0.5 rounded font-mono-num text-[10px] font-bold text-white shrink-0 ${meta.bgClass}`}
                          >
                            {meta.shortLabel}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => {
                              onSelectBreaker(null);
                              onSelectPanel(pl.element_id);
                            }}
                            className="text-xs font-semibold text-indigo-700 hover:text-indigo-900"
                          >
                            Ouvrir le coffret DIN →
                          </button>
                          {isConstruction && (
                            <button
                              type="button"
                              onClick={() => onDeletePanel(pl.element_id)}
                              className="text-[11px] font-semibold text-red-600 hover:text-red-800"
                            >
                              Supprimer
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-slate-500 text-center py-8">
                  Aucun tableau posé dans cette pièce.
                </p>
              )}
            </>
          )}

        </div>

        {/* Footer Pièce */}
        <div className="px-4 py-2.5 border-t border-slate-200 bg-slate-50/70 shrink-0 flex items-center justify-between gap-2">
          {isConstruction ? (
            <>
              <button
                type="button"
                onClick={onDrawAboveSelected}
                className="px-2.5 py-1 rounded-lg studio-btn text-[11px] font-semibold text-indigo-700 flex items-center gap-1 whitespace-nowrap"
              >
                <SquarePlus className="w-3.5 h-3.5" />
                Étage {(room.y + room.hauteur).toFixed(1)}m
              </button>
              <button
                type="button"
                onClick={onDeleteSelectedRoom}
                className="px-2 py-1 rounded-lg text-[11px] font-semibold text-red-600 hover:bg-red-50 flex items-center gap-1 whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Supprimer pièce
              </button>
            </>
          ) : (
            <>
              <span className="font-mono-num text-[11px] text-slate-500">
                Total pièce : <strong className="text-slate-900">{formatWattsCompact(roomTotalW)}</strong>
              </span>
              <button
                type="button"
                onClick={() => onSwitchWorkspace('construction')}
                className="text-xs font-semibold text-indigo-700 hover:text-indigo-900"
              >
                Modifier →
              </button>
            </>
          )}
        </div>
      </>
    );
  };

  // ============================================================
  // LEVEL 2B: PANNEAU TABLEAU ÉLECTRIQUE (COFFRET DIN MODULAIRE)
  // ============================================================
  const renderPanelDrawer = (panel: BoardElement) => {
    const panelRoom = roomsById.get(panel.zone_id) ?? null;
    const panelWall = panelPositions[panel.element_id]?.wall;
    const parentInfo = findParentPanelForId(panel.parent_id, panelsById, breakersById);
    const subPanelLinks = getDirectSubPanelsOfPanel(panel.element_id, panels, breakers);

    // Cumul W récursif par phase et par disjoncteur (points + sous-tableaux en cascade)
    const { totalW: totalPanelW, phaseLoadW, breakerLoadMap } = computePanelBalance(
      panel.element_id,
      panels,
      breakers,
      points,
    );

    const filteredBreakers =
      panelPhaseFilter === 'TOUS'
        ? selectedPanelBreakers
        : selectedPanelBreakers.filter((b) => b.phases === panelPhaseFilter);

    const activeBreaker = selectedBreakerId
      ? selectedPanelBreakers.find((b) => b.element_id === selectedBreakerId) ?? null
      : null;

    const sum3P = Math.max(1, phaseLoadW.L1 + phaseLoadW.L2 + phaseLoadW.L3);
    const pctL1 = (phaseLoadW.L1 / sum3P) * 100;
    const pctL2 = (phaseLoadW.L2 / sum3P) * 100;
    const pctL3 = (phaseLoadW.L3 / sum3P) * 100;

    return (
      <>
        {/* Header Tableau */}
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 shrink-0 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                onSelectBreaker(null);
                onSelectPanel(null);
              }}
              className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-950 truncate"
            >
              <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{panelRoom ? panelRoom.nom : 'Explorer'}</span>
            </button>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono-num text-[10px] font-semibold text-slate-400">
                {panel.element_id}
                {panelWall ? ` · ${WALL_LABELS[panelWall]}` : ''}
              </span>
              <button
                type="button"
                onClick={onClose}
                className="w-6 h-6 rounded-lg hover:bg-slate-200/70 flex items-center justify-center text-slate-400 hover:text-slate-700"
                title="Fermer le panneau"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {isConstruction ? (
            <input
              type="text"
              value={panel.nom}
              placeholder="Nom du tableau"
              onFocus={onPushUndoSnapshot}
              onChange={(e) => onUpdateBoardElement({ ...panel, nom: e.target.value })}
              className="w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-sm font-bold text-slate-900 outline-none focus:border-slate-400"
            />
          ) : (
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-bold text-slate-900 truncate">{panel.nom}</h2>
              <span
                className={`px-2 py-0.5 rounded font-mono-num text-[10px] font-bold text-white shrink-0 ${
                  BOARD_PHASE_META[panel.phases].bgClass
                }`}
              >
                {BOARD_PHASE_META[panel.phases].shortLabel}
              </span>
            </div>
          )}

          {parentInfo && (
            <button
              type="button"
              onClick={() => {
                onSelectRoom(parentInfo.parentPanel.zone_id);
                onSelectPanel(parentInfo.parentPanel.element_id);
                onSelectBreaker(parentInfo.feederBreaker?.element_id ?? null);
              }}
              className="w-full px-2.5 py-1.5 rounded-lg bg-indigo-50/80 hover:bg-indigo-100 border border-indigo-200/80 flex items-center justify-between gap-2 text-[11px] text-left"
            >
              <span className="font-semibold text-indigo-950 truncate">
                ← Alimenté par : {parentInfo.parentPanel.nom}
                {parentInfo.feederBreaker
                  ? ` (${shortBreakerCode(parentInfo.feederBreaker)})`
                  : ''}
              </span>
              <span className="text-indigo-700 font-bold shrink-0">Amont →</span>
            </button>
          )}

          {parentInfo && isConstruction && onUpdateCableRoute && (
            <div className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-slate-100/80 border border-slate-200 text-[10px]">
              {cableRoutes[`panel:${panel.element_id}`]?.length ? (
                <>
                  <span className="font-semibold text-blue-700">
                    Liaison amont personnalisée
                  </span>
                  <button
                    type="button"
                    onClick={() => onUpdateCableRoute(`panel:${panel.element_id}`, null, true)}
                    className="inline-flex items-center gap-1 font-semibold text-slate-600 hover:text-slate-900"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Réinitialiser tracé
                  </button>
                </>
              ) : (
                <span className="text-slate-500">
                  Liaison amont auto — glissez le câble en 3D pour ajuster
                </span>
              )}
            </div>
          )}

          {isConstruction && (
            <div className="flex flex-col gap-1.5">
              <div className="grid grid-cols-4 gap-1">
                {(['TRI', 'L1', 'L2', 'L3'] as BoardPhaseConfig[]).map((ph) => {
                  const meta = BOARD_PHASE_META[ph];
                  const active = panel.phases === ph;
                  return (
                    <button
                      key={ph}
                      type="button"
                      onClick={() => {
                        onPushUndoSnapshot();
                        onUpdateBoardElement({ ...panel, phases: ph });
                      }}
                      className={`py-1 rounded-lg font-mono-num text-[11px] font-bold flex items-center justify-center gap-1 border transition-colors ${
                        active
                          ? `${meta.bgClass} text-white border-transparent`
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-xs shrink-0"
                        style={{ backgroundColor: active ? '#ffffff' : meta.hex }}
                      />
                      {meta.shortLabel}
                    </button>
                  );
                })}
              </div>

              {panels.length > 1 && (
                <select
                  value={panel.parent_id}
                  onChange={(e) => {
                    onPushUndoSnapshot();
                    onUpdateBoardElement({ ...panel, parent_id: e.target.value });
                  }}
                  className="w-full px-2 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-medium text-slate-800 outline-none"
                  title="Alimentation amont (tableau ou disjoncteur dédié)"
                >
                  <option value="">Arrivée directe (Tableau principal / autonome)</option>
                  {panels
                    .filter(
                      (p) =>
                        p.element_id !== panel.element_id &&
                        (!wouldCreatePanelCycle(
                          panel.element_id,
                          p.element_id,
                          panelsById,
                          breakersById,
                        ) ||
                          panel.parent_id === p.element_id),
                    )
                    .map((p) => {
                      const pBreakers = breakers.filter((b) => b.parent_id === p.element_id);
                      const pRoom = roomsById.get(p.zone_id);
                      const locSuffix = pRoom ? ` · ${pRoom.nom}` : '';
                      return (
                        <optgroup key={p.element_id} label={`${p.nom}${locSuffix}`}>
                          <option value={p.element_id}>
                            Tableau : {p.nom} (direct)
                          </option>
                          {pBreakers.map((b) => (
                            <option key={b.element_id} value={b.element_id}>
                              ↳ Disj. : {b.nom} ({BOARD_PHASE_META[b.phases].shortLabel}
                              {b.calibre_a ? ` · ${b.calibre_a}A` : ''})
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                </select>
              )}
            </div>
          )}

          {/* Bilan de charge L1/L2/L3 du tableau */}
          <div className="bg-white border border-slate-200 rounded-xl p-2 flex flex-col gap-1.5">
            <div className="flex items-center justify-between font-mono-num text-[11px]">
              <span className={`font-semibold ${PHASE_META.L1.textClass}`}>
                L1 {formatWattsCompact(phaseLoadW.L1)}
              </span>
              <span className={`font-semibold ${PHASE_META.L2.textClass}`}>
                L2 {formatWattsCompact(phaseLoadW.L2)}
              </span>
              <span className={`font-semibold ${PHASE_META.L3.textClass}`}>
                L3 {formatWattsCompact(phaseLoadW.L3)}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden flex">
              {phaseLoadW.L1 + phaseLoadW.L2 + phaseLoadW.L3 > 0 ? (
                <>
                  <div className="h-full bg-[#FF6600]" style={{ width: `${pctL1}%` }} />
                  <div className="h-full bg-[#E6007E]" style={{ width: `${pctL2}%` }} />
                  <div className="h-full bg-[#00CC44]" style={{ width: `${pctL3}%` }} />
                </>
              ) : (
                <div className="h-full w-full bg-slate-200" />
              )}
            </div>
          </div>
        </div>

        {/* Corps scrollable unique : Coffret DIN + Fiche Disjoncteur sélectionné */}
        <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-3">
          {/* Filtres + bouton ajout disjoncteur */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 flex-wrap">
              {(['TOUS', 'L1', 'L2', 'L3', 'TRI'] as const).map((ph) => {
                const active = panelPhaseFilter === ph;
                const label = ph === 'TOUS' ? `Tous (${selectedPanelBreakers.length})` : ph;
                return (
                  <button
                    key={ph}
                    type="button"
                    onClick={() => setPanelPhaseFilter(ph)}
                    className={`px-2 py-0.5 rounded font-mono-num text-[10px] font-bold transition-colors ${
                      active
                        ? ph === 'TOUS'
                          ? 'bg-slate-900 text-white'
                          : `${BOARD_PHASE_META[ph].bgClass} text-white`
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {isConstruction && (
              <button
                type="button"
                onClick={() => onAddBreaker(panel.element_id)}
                className="px-2 py-1 rounded-lg studio-btn text-[11px] font-semibold text-slate-800 flex items-center gap-1 shrink-0"
              >
                <Plus className="w-3 h-3" />
                Disjoncteur
              </button>
            )}
          </div>

          {/* Grille Coffret DIN compacte (zéro scroll horizontal) */}
          <div className="p-2.5 rounded-xl bg-slate-100 border border-slate-200">
            <div className="grid grid-cols-4 gap-1.5">
              {filteredBreakers.map((br) => {
                const isSelected = activeBreaker?.element_id === br.element_id;
                const pMeta = BOARD_PHASE_META[br.phases];
                const load = breakerLoadMap.get(br.element_id) ?? {
                  watts: 0,
                  pts: [],
                  subPanels: [],
                };
                const isTri = br.phases === 'TRI';
                const countLabel =
                  load.subPanels.length > 0
                    ? load.pts.length > 0
                      ? `${load.pts.length}p+${load.subPanels.length}t`
                      : `${load.subPanels.length} tabl.`
                    : `${load.pts.length}p`;

                return (
                  <button
                    key={br.element_id}
                    type="button"
                    onClick={() => onSelectBreaker(isSelected ? null : br.element_id)}
                    className={`h-[92px] rounded-lg border p-1.5 flex flex-col justify-between text-left transition-all ${
                      isSelected
                        ? 'bg-indigo-50/70 border-2 border-indigo-600 ring-2 ring-indigo-200 shadow-xs'
                        : 'bg-white border-slate-300 hover:border-slate-400'
                    }`}
                    title={`${br.nom} · ${pMeta.label}`}
                  >
                    <div className="flex items-center justify-between gap-1 w-full">
                      <span className="font-mono-num text-[10px] font-extrabold text-slate-800 truncate">
                        {shortBreakerCode(br)}
                      </span>
                      {isTri ? (
                        <span className="flex gap-0.5 shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#FF6600]" />
                          <span className="w-1.5 h-1.5 rounded-full bg-[#E6007E]" />
                          <span className="w-1.5 h-1.5 rounded-full bg-[#00CC44]" />
                        </span>
                      ) : (
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: pMeta.hex }}
                        />
                      )}
                    </div>

                    <div className="text-center w-full">
                      <div className="font-mono-num text-xs font-extrabold text-slate-900">
                        {br.calibre_a ? `${br.calibre_a}A` : '—'}
                      </div>
                      <div
                        className="h-1.5 w-6 mx-auto mt-1 rounded-xs"
                        style={{ backgroundColor: pMeta.hex }}
                      />
                    </div>

                    <div className="w-full">
                      <div className="text-[9px] font-semibold text-slate-700 truncate text-center bg-slate-100 rounded px-1 py-0.2">
                        {br.nom.replace(/^[A-Za-z]+\d+\s*[—-]\s*/, '') || br.nom}
                      </div>
                      <div className="font-mono-num text-[9px] text-slate-500 text-center mt-0.5">
                        {countLabel} · {formatWattsCompact(load.watts)}
                      </div>
                    </div>
                  </button>
                );
              })}

              {isConstruction && (
                <button
                  type="button"
                  onClick={() => onAddBreaker(panel.element_id)}
                  className="h-[92px] rounded-lg border-2 border-dashed border-slate-300 hover:border-indigo-500 hover:bg-indigo-50/40 flex flex-col items-center justify-center gap-1 text-slate-500 hover:text-indigo-700 transition-colors"
                  title="Ajouter un disjoncteur"
                >
                  <Plus className="w-4 h-4" />
                  <span className="font-mono-num text-[9px] font-bold uppercase">Disj.</span>
                </button>
              )}
            </div>
          </div>

          {/* Fiche directe du disjoncteur sélectionné (zéro 3e tiroir !) */}
          {activeBreaker ? (
            (() => {
              const bMeta = BOARD_PHASE_META[activeBreaker.phases];
              const load = breakerLoadMap.get(activeBreaker.element_id) ?? {
                watts: 0,
                pts: [],
                subPanels: [],
              };
              const totalFedCount = load.pts.length + load.subPanels.length;
              return (
                <div className="rounded-xl border-2 border-indigo-600 bg-white p-3 flex flex-col gap-2.5 shadow-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="px-1.5 py-0.5 rounded bg-slate-900 text-white font-mono-num text-[10px] font-bold shrink-0">
                        {shortBreakerCode(activeBreaker)}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded font-mono-num text-[10px] font-bold text-white shrink-0 ${bMeta.bgClass}`}
                      >
                        {bMeta.shortLabel}
                      </span>
                      <span className="font-mono-num text-xs font-bold text-slate-900 ml-1">
                        {formatWattsCompact(load.watts)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onSelectBreaker(null)}
                      className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold text-slate-500 hover:text-slate-900 hover:bg-slate-100 shrink-0"
                      title="Afficher tous les circuits dans la 3D"
                    >
                      Tout afficher
                    </button>
                  </div>

                  {isConstruction ? (
                    <>
                      <input
                        type="text"
                        value={activeBreaker.nom}
                        onFocus={onPushUndoSnapshot}
                        onChange={(e) =>
                          onUpdateBoardElement({ ...activeBreaker, nom: e.target.value })
                        }
                        className="w-full px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs font-bold text-slate-900 outline-none focus:border-slate-400"
                      />

                      <div className="grid grid-cols-2 gap-1.5">
                        <select
                          value={activeBreaker.phases}
                          onChange={(e) => {
                            onPushUndoSnapshot();
                            onUpdateBoardElement({
                              ...activeBreaker,
                              phases: e.target.value as BoardPhaseConfig,
                            });
                          }}
                          className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-semibold text-slate-800 outline-none"
                        >
                          <option value="L1">Phase L1</option>
                          <option value="L2">Phase L2</option>
                          <option value="L3">Phase L3</option>
                          <option value="TRI">Triphasé</option>
                          <option value="L1+L2">L1+L2</option>
                          <option value="L2+L3">L2+L3</option>
                          <option value="L1+L3">L1+L3</option>
                          <option value="INCONNU">Inconnue</option>
                        </select>

                        <select
                          value={activeBreaker.calibre_a ?? 16}
                          onChange={(e) => {
                            onPushUndoSnapshot();
                            onUpdateBoardElement({
                              ...activeBreaker,
                              calibre_a: Number(e.target.value),
                            });
                          }}
                          className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 font-mono-num text-[11px] font-semibold text-slate-800 outline-none"
                        >
                          {[10, 16, 20, 25, 32, 40, 63].map((amp) => (
                            <option key={amp} value={amp}>
                              {amp} A
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  ) : (
                    <div className="text-sm font-bold text-slate-900">{activeBreaker.nom}</div>
                  )}

                  {/* Points & sous-tableaux alimentés par ce disjoncteur */}
                  <div className="pt-2 border-t border-slate-100 flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span className="font-semibold text-slate-700">
                        Départs alimentés ({totalFedCount})
                      </span>
                      {activeBreaker.calibre_a && (
                        <span className="font-mono-num">
                          Calibre {activeBreaker.calibre_a}A
                        </span>
                      )}
                    </div>
                    {totalFedCount > 0 ? (
                      <div className="flex flex-col gap-1.5">
                        <button
                          type="button"
                          onClick={() => onFocusCircuit(panel.element_id, activeBreaker.element_id)}
                          className="w-full py-1.5 px-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Cadrer dans la 3D ({totalFedCount} départ{totalFedCount > 1 ? 's' : ''})
                        </button>

                        {load.subPanels.map((sp) => {
                          const spRoom = roomsById.get(sp.zone_id);
                          const spW = computePanelBalance(
                            sp.element_id,
                            panels,
                            breakers,
                            points,
                          ).totalW;
                          return (
                            <button
                              key={sp.element_id}
                              type="button"
                              onClick={() => {
                                onSelectBreaker(null);
                                onSelectRoom(sp.zone_id);
                                onSelectPanel(sp.element_id);
                              }}
                              className="w-full px-2 py-1.5 rounded-lg bg-indigo-50/70 hover:bg-indigo-100 border border-indigo-200 text-[11px] flex items-center justify-between gap-2 text-left"
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <Zap className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                <span className="font-bold text-indigo-950 truncate">
                                  {sp.nom}
                                </span>
                                {spRoom && (
                                  <span className="text-[10px] text-indigo-700/80 truncate">
                                    · {spRoom.nom}
                                  </span>
                                )}
                              </div>
                              <span className="font-mono-num font-semibold text-indigo-800 shrink-0">
                                {formatWattsCompact(spW)} →
                              </span>
                            </button>
                          );
                        })}

                        {load.pts.map((pt) => {
                          const pRoom = roomsById.get(pt.zone_id);
                          const ptMeta = PHASE_META[pt.phase_relevee];
                          return (
                            <button
                              key={pt.point_id}
                              type="button"
                              onClick={() => {
                                onSelectBreaker(null);
                                onSelectPanel(null);
                                onSelectRoom(pt.zone_id);
                                onSelectOpening(null);
                                onSelectPoint(pt.point_id);
                                onFocusPoint(pt.point_id);
                              }}
                              className="w-full px-2 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200/70 text-[11px] flex items-center justify-between gap-2 text-left"
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span
                                  className="w-2 h-2 rounded-xs shrink-0"
                                  style={{ backgroundColor: ptMeta.hex }}
                                />
                                <span className="font-medium text-slate-900 truncate">
                                  {pt.nom}
                                </span>
                                {pRoom && (
                                  <span className="text-[10px] text-slate-400 truncate">
                                    · {pRoom.nom}
                                  </span>
                                )}
                              </div>
                              <span className="font-mono-num font-semibold text-slate-700 shrink-0">
                                {pt.puissance_est_w !== null ? `${pt.puissance_est_w} W` : '—'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-400">
                        Aucun point ni sous-tableau raccordé à ce circuit.
                      </p>
                    )}
                  </div>

                  {isConstruction && (
                    <div className="flex justify-end pt-1 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => onDeleteBreaker(activeBreaker.element_id)}
                        className="px-2 py-1 rounded-lg text-[11px] font-semibold text-red-600 hover:bg-red-50 flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" />
                        Supprimer ce disjoncteur
                      </button>
                    </div>
                  )}
                </div>
              );
            })()
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-center text-xs text-slate-500">
              {selectedPanelBreakers.length > 0
                ? 'Cliquez un module ci-dessus pour inspecter le circuit et le surligner en 3D.'
                : 'Aucun disjoncteur dans ce tableau.'}
            </div>
          )}

          {/* Sous-tableaux alimentés */}
          {subPanelLinks.length > 0 && (
            <div className="pt-2 border-t border-slate-200 flex flex-col gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Sous-tableaux alimentés ({subPanelLinks.length})
              </span>
              {subPanelLinks.map(({ panel: sp, feederBreaker }) => {
                const spRoom = roomsById.get(sp.zone_id);
                const spW = computePanelBalance(sp.element_id, panels, breakers, points).totalW;
                return (
                  <button
                    key={sp.element_id}
                    type="button"
                    onClick={() => {
                      onSelectBreaker(null);
                      onSelectRoom(sp.zone_id);
                      onSelectPanel(sp.element_id);
                    }}
                    className="w-full px-2.5 py-2 rounded-xl bg-white border border-slate-200 hover:border-slate-400 flex items-center justify-between gap-2 text-xs text-left"
                  >
                    <div className="min-w-0 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 truncate">{sp.nom}</div>
                        <div className="font-mono-num text-[10px] text-slate-500 truncate">
                          {feederBreaker ? `Via ${shortBreakerCode(feederBreaker)}` : 'Direct'}
                          {spRoom ? ` · ${spRoom.nom}` : ''}
                          {spRoom && buildings.length > 1 && spRoom.buildingName
                            ? ` (${spRoom.buildingName})`
                            : ''}
                        </div>
                      </div>
                    </div>
                    <span className="font-mono-num text-[10px] font-bold text-indigo-700 shrink-0">
                      {formatWattsCompact(spW)} · {BOARD_PHASE_META[sp.phases].shortLabel} →
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Tableau */}
        <div className="px-4 py-2.5 border-t border-slate-200 bg-slate-50/70 shrink-0 flex items-center justify-between gap-2">
          <span className="font-mono-num text-[11px] text-slate-500">
            Cumul tableau : <strong className="text-slate-900">{formatWattsCompact(totalPanelW)}</strong>
          </span>
          {isConstruction ? (
            <button
              type="button"
              onClick={() => onDeletePanel(panel.element_id)}
              className="px-2 py-1 rounded-lg text-[11px] font-semibold text-red-600 hover:bg-red-50 flex items-center gap-1 whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Supprimer tableau
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onSwitchWorkspace('construction')}
              className="text-xs font-semibold text-indigo-700 hover:text-indigo-900"
            >
              Modifier →
            </button>
          )}
        </div>
      </>
    );
  };

  return (
    <aside className="w-[380px] max-w-[92vw] h-full bg-white border-l border-slate-200 flex flex-col shrink-0 z-20">
      {viewMode === 'panel' && selectedPanel
        ? renderPanelDrawer(selectedPanel)
        : viewMode === 'room' && selectedRoom
          ? renderRoomPanel(selectedRoom)
          : renderOverview()}
    </aside>
  );
};
