import { BoardElement, ElectricalPoint } from '../types/room3d';

export interface PanelParentInfo {
  parentPanel: BoardElement;
  feederBreaker: BoardElement | null;
}

export interface SubPanelLink {
  panel: BoardElement;
  feederBreaker: BoardElement | null;
}

export interface PanelBalanceSummary {
  totalW: number;
  phaseLoadW: { L1: number; L2: number; L3: number };
  breakerLoadMap: Map<string, { watts: number; pts: ElectricalPoint[]; subPanels: BoardElement[] }>;
}

export function findParentPanelForId(
  parentId: string,
  panelsById: Map<string, BoardElement>,
  breakersById: Map<string, BoardElement>,
): PanelParentInfo | null {
  if (!parentId) return null;
  const directPanel = panelsById.get(parentId);
  if (directPanel) {
    return { parentPanel: directPanel, feederBreaker: null };
  }
  const br = breakersById.get(parentId);
  if (br) {
    const parentPanel = panelsById.get(br.parent_id);
    if (parentPanel) {
      return { parentPanel, feederBreaker: br };
    }
  }
  return null;
}

export function wouldCreatePanelCycle(
  panelId: string,
  candidateParentId: string,
  panelsById: Map<string, BoardElement>,
  breakersById: Map<string, BoardElement>,
): boolean {
  if (!candidateParentId) return false;
  let curParentId: string = candidateParentId;
  const visited = new Set<string>([panelId]);

  while (curParentId) {
    const info = findParentPanelForId(curParentId, panelsById, breakersById);
    if (!info) return false;
    if (visited.has(info.parentPanel.element_id)) return true;
    visited.add(info.parentPanel.element_id);
    curParentId = info.parentPanel.parent_id;
  }

  return false;
}

export function getDirectSubPanelsOfPanel(
  panelId: string,
  panels: BoardElement[],
  breakers: BoardElement[],
): SubPanelLink[] {
  const breakerById = new Map<string, BoardElement>();
  for (const b of breakers) {
    if (b.parent_id === panelId) {
      breakerById.set(b.element_id, b);
    }
  }

  const out: SubPanelLink[] = [];
  for (const p of panels) {
    if (p.element_id === panelId) continue;
    if (p.parent_id === panelId) {
      out.push({ panel: p, feederBreaker: null });
    } else if (breakerById.has(p.parent_id)) {
      out.push({ panel: p, feederBreaker: breakerById.get(p.parent_id)! });
    }
  }
  return out;
}

export function computePanelBalance(
  panelId: string,
  panels: BoardElement[],
  breakers: BoardElement[],
  points: ElectricalPoint[],
  visited = new Set<string>(),
): PanelBalanceSummary {
  const breakerLoadMap = new Map<
    string,
    { watts: number; pts: ElectricalPoint[]; subPanels: BoardElement[] }
  >();
  const phaseLoadW = { L1: 0, L2: 0, L3: 0 };
  let totalW = 0;

  if (visited.has(panelId)) {
    return { totalW, phaseLoadW, breakerLoadMap };
  }
  const nextVisited = new Set(visited);
  nextVisited.add(panelId);

  const panelBreakers = breakers.filter((b) => b.parent_id === panelId);

  for (const br of panelBreakers) {
    const fedPts = points.filter((pt) => pt.disjoncteur_id === br.element_id);
    const fedSubPanels = panels.filter((sp) => sp.parent_id === br.element_id);

    let brWatts = 0;
    const brPhases = { L1: 0, L2: 0, L3: 0 };

    for (const pt of fedPts) {
      const pw = pt.puissance_est_w ?? 0;
      brWatts += pw;
      if (br.phases === 'L1' || br.phases === 'L2' || br.phases === 'L3') {
        brPhases[br.phases] += pw;
      } else if (
        pt.phase_relevee === 'L1' ||
        pt.phase_relevee === 'L2' ||
        pt.phase_relevee === 'L3'
      ) {
        brPhases[pt.phase_relevee] += pw;
      }
    }

    for (const sp of fedSubPanels) {
      const subSummary = computePanelBalance(sp.element_id, panels, breakers, points, nextVisited);
      brWatts += subSummary.totalW;
      if (br.phases === 'L1' || br.phases === 'L2' || br.phases === 'L3') {
        brPhases[br.phases] += subSummary.totalW;
      } else {
        brPhases.L1 += subSummary.phaseLoadW.L1;
        brPhases.L2 += subSummary.phaseLoadW.L2;
        brPhases.L3 += subSummary.phaseLoadW.L3;
      }
    }

    breakerLoadMap.set(br.element_id, { watts: brWatts, pts: fedPts, subPanels: fedSubPanels });
    totalW += brWatts;
    phaseLoadW.L1 += brPhases.L1;
    phaseLoadW.L2 += brPhases.L2;
    phaseLoadW.L3 += brPhases.L3;
  }

  // Sous-tableaux raccordés directement au tableau (sans disjoncteur dédié)
  const directSubPanels = panels.filter((sp) => sp.parent_id === panelId);
  for (const sp of directSubPanels) {
    const subSummary = computePanelBalance(sp.element_id, panels, breakers, points, nextVisited);
    totalW += subSummary.totalW;
    if (sp.phases === 'L1' || sp.phases === 'L2' || sp.phases === 'L3') {
      phaseLoadW[sp.phases] += subSummary.totalW;
    } else {
      phaseLoadW.L1 += subSummary.phaseLoadW.L1;
      phaseLoadW.L2 += subSummary.phaseLoadW.L2;
      phaseLoadW.L3 += subSummary.phaseLoadW.L3;
    }
  }

  return { totalW, phaseLoadW, breakerLoadMap };
}
