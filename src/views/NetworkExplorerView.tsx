import React, { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import {
  ArrowRight,
  Briefcase,
  Expand,
  GitFork,
  Layers,
  RotateCcw,
  Route,
  Search,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  AccountProfile,
  NetworkCluster,
  NetworkEdge,
  NetworkNode,
  TransactionRecord,
  TwoAccountPathResult,
} from '../shared/types';
import {
  api,
  formatDateTime,
  formatINR,
  formatShortINR,
  roleDisplayLabel,
} from '../lib/api';
import {
  InfoTooltip,
  RiskIndicator,
  computeRiskTier,
  riskTierHex,
} from '../components/UiPrimitives';

interface NetworkExplorerViewProps {
  datasetId: string;
  clusters: NetworkCluster[];
  selectedClusterId: string | null;
  onSelectCluster: (clusterId: string) => void;
  onOpenAccountProfile: (upiId: string) => void;
  onCreateCaseFromCluster: (cluster: NetworkCluster) => void;
  onAskAiAboutCluster: (cluster: NetworkCluster) => void;
}

interface PositionedNode extends NetworkNode {
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
}

interface PositionedLink {
  id: string;
  source: string | PositionedNode;
  target: string | PositionedNode;
  amount: number;
  timestamp: string;
  utr: string;
  status: string;
  hop: number;
  complaint_ids: string[];
  is_circular: boolean;
  relationship_type: NetworkEdge['relationship_type'];
}

export const NetworkExplorerView: React.FC<NetworkExplorerViewProps> = ({
  datasetId,
  clusters,
  selectedClusterId,
  onSelectCluster,
  onOpenAccountProfile,
  onCreateCaseFromCluster,
  onAskAiAboutCluster,
}) => {
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 960, height: 600 });

  // Easy-to-read layout mode (Structured Left-to-Right Flow is default!)
  const [layoutMode, setLayoutMode] = useState<'FLOW' | 'ORGANIC'>('FLOW');
  const [highlightSuspicious, setHighlightSuspicious] = useState(false);
  const [minAmount, setMinAmount] = useState<number>(0);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [maxHops, setMaxHops] = useState<number>(5);
  const [accountSearch, setAccountSearch] = useState('');

  // Two-account path tracer
  const [pathOpen, setPathOpen] = useState(false);
  const [pathSource, setPathSource] = useState('');
  const [pathTarget, setPathTarget] = useState('');
  const [pathResult, setPathResult] = useState<TwoAccountPathResult | null>(null);
  const [tracingPath, setTracingPath] = useState(false);

  // Selected node / edge & contextual account panel details
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<NetworkEdge | null>(null);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());
  const [accountDetail, setAccountDetail] = useState<{
    account: AccountProfile;
    transactions: TransactionRecord[];
    neighbor_accounts: AccountProfile[];
  } | null>(null);

  const activeCluster = useMemo(() => {
    if (clusters.length === 0) return null;
    return clusters.find((c) => c.cluster_id === selectedClusterId) ?? clusters[0];
  }, [clusters, selectedClusterId]);

  useEffect(() => {
    setSelectedNodeId(null);
    setSelectedEdge(null);
    setPathResult(null);
    setAccountDetail(null);
    setExpandedNodeIds(new Set());
    if (activeCluster && activeCluster.nodes.length >= 2) {
      const firstVictim = activeCluster.nodes.find((n) => n.role === 'VICTIM') ?? activeCluster.nodes[0];
      const firstDownstream =
        activeCluster.nodes.find((n) => n.role === 'DOWNSTREAM') ??
        activeCluster.nodes[activeCluster.nodes.length - 1];
      setPathSource(firstVictim.id);
      setPathTarget(firstDownstream.id);
    }
  }, [activeCluster?.cluster_id]);

  // Fetch rich contextual details whenever an investigator selects a node
  useEffect(() => {
    if (!selectedNodeId) {
      setAccountDetail(null);
      return;
    }
    let active = true;
    api
      .getAccountDetail(selectedNodeId, datasetId)
      .then((res) => {
        if (active) {
          setAccountDetail({
            account: res.account,
            transactions: res.transactions,
            neighbor_accounts: res.neighbor_accounts,
          });
        }
      })
      .catch(() => {
        if (active) setAccountDetail(null);
      });
    return () => {
      active = false;
    };
  }, [selectedNodeId, datasetId]);

  // Resize observer
  useEffect(() => {
    const update = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width > 240) {
        setDimensions({ width: Math.floor(rect.width), height: 600 });
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Build readable graph with deterministic Left-to-Right Flow coordinates
  const { graphData, maxEdgeAmount, connectedToSelected } = useMemo(() => {
    if (!activeCluster) {
      return {
        graphData: { nodes: [] as PositionedNode[], links: [] as PositionedLink[] },
        maxEdgeAmount: 1,
        connectedToSelected: { nodes: new Set<string>(), edges: new Set<string>() },
      };
    }

    const fromMs = dateFrom ? Date.parse(dateFrom) : null;
    const toMs = dateTo ? Date.parse(dateTo) + 86_400_000 : null;

    const filteredEdges = activeCluster.edges.filter((edge) => {
      if (edge.hop > maxHops) return false;
      if (minAmount > 0 && edge.amount < minAmount) return false;
      const tMs = Date.parse(edge.timestamp);
      if (fromMs && !Number.isNaN(fromMs) && tMs < fromMs) return false;
      if (toMs && !Number.isNaN(toMs) && tMs > toMs) return false;
      return true;
    });

    // Aggregate parallel transactions between identical (source, target) pairs for crisp visual clarity
    // while preserving the highest-amount / latest transaction reference on click
    const touchedIds = new Set<string>();
    for (const e of filteredEdges) {
      touchedIds.add(e.source);
      touchedIds.add(e.target);
    }

    const visibleNodesRaw = activeCluster.nodes.filter((n) => touchedIds.has(n.id));

    // Assign clean left-to-right column lanes by role so money flow reads left → right
    const laneX: Record<NetworkNode['role'], number> = {
      VICTIM: -340,
      INITIAL_RECIPIENT: -110,
      INTERMEDIARY: 120,
      DOWNSTREAM: 340,
      CONTROL: 340,
    };

    const byRole = new Map<string, NetworkNode[]>();
    for (const n of visibleNodesRaw) {
      const list = byRole.get(n.role) ?? [];
      list.push(n);
      byRole.set(n.role, list);
    }

    const positionedNodes: PositionedNode[] = [];
    for (const [role, list] of byRole.entries()) {
      // Sort highest risk or highest inflow toward center-top
      const sorted = [...list].sort((a, b) => b.risk_score - a.risk_score || a.id.localeCompare(b.id));
      const spacing = role === 'VICTIM' ? Math.max(36, 460 / Math.max(1, sorted.length)) : 74;
      const startY = -((sorted.length - 1) * spacing) / 2;
      sorted.forEach((n, idx) => {
        const x = laneX[n.role] ?? 0;
        const y = startY + idx * spacing;
        if (layoutMode === 'FLOW') {
          positionedNodes.push({ ...n, x, y, fx: x, fy: y });
        } else {
          positionedNodes.push({ ...n, x, y });
        }
      });
    }

    // Track nodes/edges directly connected to selected node (and expanded neighbors)
    const focusNodes = new Set<string>();
    const focusEdges = new Set<string>();
    const activeFocusSeeds = new Set<string>();
    if (selectedNodeId) activeFocusSeeds.add(selectedNodeId);
    for (const exp of expandedNodeIds) activeFocusSeeds.add(exp);

    if (activeFocusSeeds.size > 0) {
      for (const s of activeFocusSeeds) focusNodes.add(s);
      for (const e of filteredEdges) {
        if (activeFocusSeeds.has(e.source) || activeFocusSeeds.has(e.target)) {
          focusEdges.add(e.id);
          focusNodes.add(e.source);
          focusNodes.add(e.target);
        }
      }
    }

    const maxAmt = filteredEdges.reduce((m, e) => Math.max(m, e.amount), 1);

    return {
      graphData: {
        nodes: positionedNodes,
        links: filteredEdges.map((e) => ({ ...e })),
      },
      maxEdgeAmount: maxAmt,
      connectedToSelected: { nodes: focusNodes, edges: focusEdges },
    };
  }, [activeCluster, maxHops, minAmount, dateFrom, dateTo, layoutMode, selectedNodeId, expandedNodeIds]);

  // Fit graph nicely whenever cluster or layout mode changes
  useEffect(() => {
    const t = setTimeout(() => {
      fgRef.current?.zoomToFit(350, 55);
    }, 180);
    return () => clearTimeout(t);
  }, [activeCluster?.cluster_id, layoutMode, graphData.nodes.length]);

  const handleSearchNode = (e: React.FormEvent) => {
    e.preventDefault();
    const q = accountSearch.trim().toLowerCase();
    if (!q || !fgRef.current) return;
    const hit = graphData.nodes.find((n) => n.id.toLowerCase().includes(q));
    if (hit && typeof hit.x === 'number' && typeof hit.y === 'number') {
      fgRef.current.centerAt(hit.x, hit.y, 400);
      fgRef.current.zoom(2.2, 400);
      setSelectedNodeId(hit.id);
      setSelectedEdge(null);
    }
  };

  const handleTraceTwoAccounts = async () => {
    if (!activeCluster || !pathSource || !pathTarget) return;
    setTracingPath(true);
    try {
      const res = await api.traceNetworkPath(activeCluster.cluster_id, {
        source: pathSource,
        target: pathTarget,
        datasetId,
      });
      setPathResult(res);
      setSelectedNodeId(null);
      setSelectedEdge(null);
    } finally {
      setTracingPath(false);
    }
  };

  const pathNodeSet = useMemo(
    () => new Set(pathResult?.found ? pathResult.path_nodes : []),
    [pathResult],
  );
  const pathEdgeSet = useMemo(
    () => new Set(pathResult?.found ? pathResult.path_edge_ids : []),
    [pathResult],
  );

  if (!activeCluster) {
    return (
      <div className="bg-[#151F30] border border-[#263449] rounded-md p-10 text-center">
        <h2 className="text-base font-semibold text-[#F1F5F9]">No Connected Networks Available</h2>
        <p className="text-xs text-[#94A3B8] mt-1.5">
          Upload a transaction dataset or reload the demo workspace to explore money-flow networks.
        </p>
      </div>
    );
  }

  const selectedNodeObj = selectedNodeId
    ? activeCluster.nodes.find((n) => n.id === selectedNodeId) ?? null
    : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#263449]">
        <div>
          <h1 className="text-xl font-semibold text-[#F1F5F9] tracking-tight flex items-center">
            <span>Network Explorer</span>
            <InfoTooltip text="Visualizes how money moves from original sources (left) through initial recipients and intermediaries to final destination accounts (right). Click any node to highlight its exact incoming and outgoing connections." />
          </h1>
          <p className="text-xs text-[#94A3B8] mt-0.5">
            Interactive transaction relationship map — drag nodes, trace paths between any two accounts, and inspect supporting evidence.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPathOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium border transition-colors ${
              pathOpen || pathResult?.found
                ? 'bg-[#3B82F6]/15 text-[#3B82F6] border-[#3B82F6]/50'
                : 'bg-[#151F30] hover:bg-[#1E2B42] text-[#F1F5F9] border-[#263449]'
            }`}
          >
            <Route className="w-3.5 h-3.5" />
            <span>Trace Between 2 Accounts</span>
          </button>
          <button
            type="button"
            onClick={() => onAskAiAboutCluster(activeCluster)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-[#151F30] hover:bg-[#1E2B42] text-[#F1F5F9] border border-[#263449]"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#3B82F6]" />
            <span>Explain Network</span>
          </button>
          <button
            type="button"
            onClick={() => onCreateCaseFromCluster(activeCluster)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold bg-[#3B82F6] hover:bg-blue-500 text-white"
          >
            <Briefcase className="w-3.5 h-3.5" />
            <span>Create Investigation</span>
          </button>
        </div>
      </div>

      {/* Cluster Switcher Bar */}
      <div className="flex flex-wrap items-center gap-2.5">
        {clusters.map((cl) => {
          const isCurrent = cl.cluster_id === activeCluster.cluster_id;
          return (
            <button
              key={cl.cluster_id}
              type="button"
              onClick={() => onSelectCluster(cl.cluster_id)}
              className={`px-3.5 py-2 rounded-md text-left border transition-colors ${
                isCurrent
                  ? 'bg-[#151F30] border-[#3B82F6] text-[#F1F5F9]'
                  : 'bg-[#101827] border-[#263449] text-[#94A3B8] hover:text-[#F1F5F9]'
              }`}
            >
              <div className="flex items-center gap-2 text-xs font-semibold">
                <span className="font-mono text-[#3B82F6]">{cl.cluster_id}</span>
                <span>{cl.name}</span>
              </div>
              <div className="text-[11px] font-mono text-[#94A3B8] mt-0.5 tabular-nums">
                {cl.complaint_ids.length} complaints · {cl.account_ids.length} accounts ·{' '}
                {formatShortINR(cl.total_reported_amount)}
                {cl.has_circular_pattern && (
                  <span className="text-[#EF4444] ml-2 font-sans font-medium">Circular Loop</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Trace Money Movement Between Two Accounts Bar */}
      {pathOpen && (
        <div className="bg-[#151F30] border border-[#3B82F6]/40 rounded-md p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-[11px] font-medium text-[#94A3B8] mb-1">
                From Account (Source)
              </label>
              <select
                value={pathSource}
                onChange={(e) => setPathSource(e.target.value)}
                className="w-full bg-[#0B1120] border border-[#263449] rounded px-2.5 py-1.5 text-xs font-mono text-[#F1F5F9]"
              >
                {activeCluster.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.id} ({roleDisplayLabel(n.role)})
                  </option>
                ))}
              </select>
            </div>
            <ArrowRight className="w-4 h-4 text-[#64748B] mb-2 hidden sm:block" />
            <div className="flex-1 min-w-[200px]">
              <label className="block text-[11px] font-medium text-[#94A3B8] mb-1">
                To Account (Destination)
              </label>
              <select
                value={pathTarget}
                onChange={(e) => setPathTarget(e.target.value)}
                className="w-full bg-[#0B1120] border border-[#263449] rounded px-2.5 py-1.5 text-xs font-mono text-[#F1F5F9]"
              >
                {activeCluster.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.id} ({roleDisplayLabel(n.role)})
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              disabled={tracingPath}
              onClick={handleTraceTwoAccounts}
              className="px-4 py-1.5 rounded-md text-xs font-semibold bg-[#3B82F6] hover:bg-blue-500 text-white"
            >
              {tracingPath ? 'Tracing...' : 'Highlight Path'}
            </button>
            {pathResult && (
              <button
                type="button"
                onClick={() => setPathResult(null)}
                className="px-3 py-1.5 rounded-md text-xs text-[#94A3B8] hover:text-white border border-[#263449]"
              >
                Clear Path
              </button>
            )}
          </div>

          {pathResult && (
            <div
              className={`p-3 rounded text-xs border ${
                pathResult.found
                  ? 'bg-[#3B82F6]/10 border-[#3B82F6]/30 text-[#F1F5F9]'
                  : 'bg-[#101827] border-[#263449] text-[#94A3B8]'
              }`}
            >
              <div className="font-medium">{pathResult.message}</div>
              {pathResult.found && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-[#93C5FD]">
                  {pathResult.path_nodes.map((node, i) => (
                    <React.Fragment key={node}>
                      <span>{node}</span>
                      {i < pathResult.path_nodes.length - 1 && <span>→</span>}
                    </React.Fragment>
                  ))}
                  <span className="text-[#94A3B8] ml-2">
                    ({formatINR(pathResult.total_path_amount)} across path)
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main Split: Interactive Canvas (Left 3 cols) + Contextual Panel (Right 1 col) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-8 2xl:col-span-9 bg-[#151F30] border border-[#263449] rounded-md overflow-hidden flex flex-col">
          {/* Graph Controls Bar */}
          <div className="px-4 py-2.5 bg-[#101827] border-b border-[#263449] flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              {/* Layout Mode Toggle */}
              <div className="flex items-center bg-[#0B1120] p-0.5 rounded border border-[#263449]">
                <button
                  type="button"
                  onClick={() => setLayoutMode('FLOW')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                    layoutMode === 'FLOW'
                      ? 'bg-[#3B82F6] text-white'
                      : 'text-[#94A3B8] hover:text-white'
                  }`}
                >
                  <Layers className="w-3 h-3" />
                  <span>Clear Flow</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLayoutMode('ORGANIC')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                    layoutMode === 'ORGANIC'
                      ? 'bg-[#3B82F6] text-white'
                      : 'text-[#94A3B8] hover:text-white'
                  }`}
                >
                  <GitFork className="w-3 h-3" />
                  <span>Force Graph</span>
                </button>
              </div>

              {/* Highlight Suspicious Paths Toggle */}
              <button
                type="button"
                onClick={() => setHighlightSuspicious((v) => !v)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
                  highlightSuspicious
                    ? 'bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/40'
                    : 'bg-[#0B1120] text-[#94A3B8] border-[#263449] hover:text-[#F1F5F9]'
                }`}
              >
                Highlight Suspicious Paths
              </button>

              {/* Locate Account */}
              <form onSubmit={handleSearchNode} className="relative">
                <Search className="w-3 h-3 text-[#64748B] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={accountSearch}
                  onChange={(e) => setAccountSearch(e.target.value)}
                  placeholder="Find account..."
                  className="bg-[#0B1120] border border-[#263449] focus:border-[#3B82F6] rounded pl-7 pr-2 py-1 text-[11px] text-[#F1F5F9] placeholder:text-[#64748B] w-36 focus:outline-none"
                />
              </form>

              {/* Min Amount Filter */}
              <input
                type="number"
                min={0}
                step={5000}
                value={minAmount || ''}
                onChange={(e) => setMinAmount(Math.max(0, Number(e.target.value)))}
                placeholder="Min ₹"
                aria-label="Minimum transaction amount"
                className="bg-[#0B1120] border border-[#263449] rounded px-2 py-1 text-[11px] font-mono text-[#F1F5F9] placeholder:text-[#64748B] w-24 focus:outline-none"
              />

              {/* Date Range */}
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                aria-label="From date"
                className="bg-[#0B1120] border border-[#263449] rounded px-2 py-1 text-[11px] font-mono text-[#94A3B8]"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                aria-label="To date"
                className="bg-[#0B1120] border border-[#263449] rounded px-2 py-1 text-[11px] font-mono text-[#94A3B8]"
              />

              {/* Max Hops */}
              <select
                aria-label="Maximum hops"
                value={maxHops}
                onChange={(e) => setMaxHops(Number(e.target.value))}
                className="bg-[#0B1120] border border-[#263449] rounded px-2 py-1 text-[11px] font-mono text-[#F1F5F9]"
              >
                {[1, 2, 3, 4, 5].map((h) => (
                  <option key={h} value={h}>
                    Up to {h} hop{h > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Zoom & Reset */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fgRef.current?.zoom((fgRef.current?.zoom() ?? 1) * 1.3, 250)}
                className="p-1.5 rounded bg-[#151F30] hover:bg-[#1E2B42] text-[#94A3B8] hover:text-white border border-[#263449]"
                title="Zoom In"
                aria-label="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => fgRef.current?.zoom((fgRef.current?.zoom() ?? 1) * 0.75, 250)}
                className="p-1.5 rounded bg-[#151F30] hover:bg-[#1E2B42] text-[#94A3B8] hover:text-white border border-[#263449]"
                title="Zoom Out"
                aria-label="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedNodeId(null);
                  setSelectedEdge(null);
                  setExpandedNodeIds(new Set());
                  setPathResult(null);
                  fgRef.current?.zoomToFit(350, 55);
                }}
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded bg-[#151F30] hover:bg-[#1E2B42] text-[11px] text-[#94A3B8] hover:text-white border border-[#263449]"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            </div>
          </div>

          {/* Stage Header Labels for Clear Flow Mode */}
          {layoutMode === 'FLOW' && (
            <div className="grid grid-cols-4 px-6 py-2 bg-[#0D1526] border-b border-[#263449] text-[11px] font-medium text-[#94A3B8] text-center">
              <div>1. Source / Victim Accounts</div>
              <div>2. Initial Recipients</div>
              <div>3. Intermediary Mule Layer</div>
              <div>4. Final Destinations</div>
            </div>
          )}

          {/* Graph Canvas */}
          <div ref={containerRef} className="relative bg-[#0B1120] h-[600px] w-full">
            <ForceGraph2D
              ref={fgRef}
              width={dimensions.width}
              height={dimensions.height}
              graphData={graphData}
              backgroundColor="#0B1120"
              enableNodeDrag={true}
              cooldownTicks={layoutMode === 'FLOW' ? 20 : 120}
              onNodeDragEnd={(nodeObj) => {
                const n = nodeObj as PositionedNode;
                n.fx = n.x;
                n.fy = n.y;
              }}
              nodeLabel={(nodeObj) => {
                const n = nodeObj as PositionedNode;
                return `${n.id}\n${roleDisplayLabel(n.role)} · Risk ${n.risk_score}/100 (${computeRiskTier(n.risk_score)})\nIn: ${formatINR(n.total_incoming)} | Out: ${formatINR(n.total_outgoing)}`;
              }}
              nodeCanvasObject={(nodeObj, ctx, globalScale) => {
                const n = nodeObj as PositionedNode;
                const x = n.x ?? 0;
                const y = n.y ?? 0;

                const hasFocus =
                  connectedToSelected.nodes.size > 0 || pathNodeSet.size > 0;
                const inFocus =
                  !hasFocus ||
                  connectedToSelected.nodes.has(n.id) ||
                  pathNodeSet.has(n.id);
                const isSelected = selectedNodeId === n.id;

                const suspiciousHighlight =
                  highlightSuspicious && n.risk_score >= 70;

                const tier = computeRiskTier(n.risk_score);
                const ringColor =
                  n.role === 'VICTIM' ? '#3B82F6' : riskTierHex(tier);

                const radius =
                  n.role === 'VICTIM' ? 5.5 : n.role === 'INTERMEDIARY' ? 9 : 8;

                ctx.save();
                ctx.globalAlpha = inFocus ? 1 : 0.22;

                // Subtle halo on selected or path-traced node
                if (isSelected || pathNodeSet.has(n.id) || suspiciousHighlight) {
                  ctx.beginPath();
                  ctx.arc(x, y, radius + 4.5, 0, 2 * Math.PI);
                  ctx.fillStyle = isSelected
                    ? 'rgba(59, 130, 246, 0.28)'
                    : suspiciousHighlight
                    ? 'rgba(239, 68, 68, 0.22)'
                    : 'rgba(59, 130, 246, 0.22)';
                  ctx.fill();
                }

                // Node body
                ctx.beginPath();
                if (n.role === 'VICTIM') {
                  ctx.moveTo(x, y - radius);
                  ctx.lineTo(x + radius, y);
                  ctx.lineTo(x, y + radius);
                  ctx.lineTo(x - radius, y);
                  ctx.closePath();
                } else if (n.role === 'INITIAL_RECIPIENT') {
                  ctx.rect(x - radius * 0.85, y - radius * 0.85, radius * 1.7, radius * 1.7);
                } else {
                  ctx.arc(x, y, radius, 0, 2 * Math.PI);
                }

                ctx.fillStyle = '#151F30';
                ctx.fill();
                ctx.lineWidth = isSelected ? 2.8 / globalScale : 2 / globalScale;
                ctx.strokeStyle = isSelected ? '#FFFFFF' : ringColor;
                ctx.stroke();

                // Clean readable label pill on canvas for non-victim or focused/zoomed nodes
                if (n.role !== 'VICTIM' || isSelected || pathNodeSet.has(n.id) || globalScale > 1.35) {
                  const text = n.id.replace('@demo', '');
                  const fontSize = Math.max(9, 10.5 / Math.sqrt(globalScale));
                  ctx.font = `500 ${fontSize}px "IBM Plex Mono", monospace`;
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'top';
                  ctx.fillStyle = isSelected ? '#FFFFFF' : '#E2E8F0';
                  ctx.fillText(text, x, y + radius + 3 / globalScale);
                }

                ctx.restore();
              }}
              linkDirectionalArrowLength={5.5}
              linkDirectionalArrowRelPos={0.9}
              linkWidth={(linkObj) => {
                const l = linkObj as PositionedLink;
                if (selectedEdge?.id === l.id || pathEdgeSet.has(l.id)) return 3;
                if (connectedToSelected.edges.has(l.id)) return 2.4;
                const norm = Math.max(0.2, l.amount / maxEdgeAmount);
                return 0.9 + norm * 1.6;
              }}
              linkColor={(linkObj) => {
                const l = linkObj as PositionedLink;
                const hasFocus =
                  connectedToSelected.edges.size > 0 || pathEdgeSet.size > 0;
                const isPath = pathEdgeSet.has(l.id);
                const isConnected = connectedToSelected.edges.has(l.id);

                if (selectedEdge?.id === l.id) return '#FFFFFF';
                if (isPath) return '#3B82F6';
                if (hasFocus && !isConnected) return 'rgba(71, 85, 105, 0.14)';

                if (l.is_circular) return '#EF4444';
                if (highlightSuspicious) {
                  return l.hop >= 2 ? '#F97316' : 'rgba(100, 116, 139, 0.2)';
                }
                if (isConnected && selectedNodeId) {
                  const srcId = typeof l.source === 'string' ? l.source : l.source.id;
                  return srcId === selectedNodeId ? '#F97316' : '#3B82F6';
                }
                return 'rgba(148, 163, 184, 0.35)';
              }}
              linkCanvasObjectMode={() => 'after'}
              linkCanvasObject={(linkObj, ctx, globalScale) => {
                const l = linkObj as PositionedLink;
                const showLabel =
                  selectedEdge?.id === l.id ||
                  pathEdgeSet.has(l.id) ||
                  connectedToSelected.edges.has(l.id) ||
                  globalScale > 1.5;
                if (!showLabel) return;
                const s = l.source as PositionedNode;
                const t = l.target as PositionedNode;
                if (typeof s.x !== 'number' || typeof t.x !== 'number') return;
                const midX = (s.x + t.x) / 2;
                const midY = (s.y! + t.y!) / 2;
                const fontSize = Math.max(8, 9.5 / globalScale);
                ctx.font = `600 ${fontSize}px "IBM Plex Mono", monospace`;
                ctx.fillStyle = pathEdgeSet.has(l.id)
                  ? '#93C5FD'
                  : l.is_circular
                  ? '#FCA5A5'
                  : '#CBD5E1';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(formatShortINR(l.amount), midX, midY - 4 / globalScale);
              }}
              onNodeClick={(nodeObj) => {
                const n = nodeObj as PositionedNode;
                setSelectedNodeId(n.id);
                setSelectedEdge(null);
              }}
              onLinkClick={(linkObj) => {
                const l = linkObj as PositionedLink;
                const orig = activeCluster.edges.find((e) => e.id === l.id) ?? null;
                setSelectedEdge(orig);
                setSelectedNodeId(null);
              }}
            />

            {/* Crisp Legend */}
            <div className="absolute bottom-3 left-3 bg-[#101827]/95 border border-[#263449] rounded-md px-3 py-2 text-[11px] text-[#94A3B8] flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rotate-45 border-2 border-[#3B82F6] bg-[#151F30] inline-block" />
                Source / Victim
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 border-2 border-[#F97316] bg-[#151F30] inline-block" />
                Initial Recipient
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full border-2 border-[#EF4444] bg-[#151F30] inline-block" />
                Critical / High Risk
              </span>
              <span className="text-[#475569]">|</span>
              <span>Selected: Blue = Incoming · Orange = Outgoing</span>
            </div>
          </div>
        </div>

        {/* Right-Side Contextual Investigation Panel */}
        <aside className="xl:col-span-4 2xl:col-span-3 bg-[#151F30] border border-[#263449] rounded-md flex flex-col max-h-[678px] overflow-hidden">
          {selectedNodeObj ? (
            <>
              <div className="px-4 py-3.5 bg-[#101827] border-b border-[#263449] flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] text-[#94A3B8]">Account Investigation Panel</div>
                  <div className="font-mono text-sm font-semibold text-[#F1F5F9] truncate mt-0.5">
                    {selectedNodeObj.id}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs">
                    <span className="text-[#94A3B8]">
                      {roleDisplayLabel(selectedNodeObj.role)}
                    </span>
                    <span className="text-[#475569]">·</span>
                    <RiskIndicator score={selectedNodeObj.risk_score} />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedNodeId(null)}
                  className="text-[#64748B] hover:text-white p-1"
                  aria-label="Close panel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 overflow-y-auto space-y-4 text-xs flex-1">
                {/* Incoming & Outgoing Summary */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="bg-[#101827] border border-[#263449] rounded p-2.5">
                    <div className="text-[11px] text-[#94A3B8]">Total Incoming</div>
                    <div className="font-mono tabular-nums font-semibold text-[#F1F5F9] mt-0.5">
                      {formatINR(accountDetail?.account.total_incoming_amount ?? selectedNodeObj.total_incoming)}
                    </div>
                  </div>
                  <div className="bg-[#101827] border border-[#263449] rounded p-2.5">
                    <div className="text-[11px] text-[#94A3B8]">Total Outgoing</div>
                    <div className="font-mono tabular-nums font-semibold text-[#F1F5F9] mt-0.5">
                      {formatINR(accountDetail?.account.total_outgoing_amount ?? selectedNodeObj.total_outgoing)}
                    </div>
                  </div>
                </div>

                {/* Key Account Metadata */}
                <div className="space-y-1.5 bg-[#101827] border border-[#263449] rounded p-3">
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">Connected Accounts</span>
                    <span className="font-mono tabular-nums text-[#F1F5F9]">
                      {accountDetail?.account.connected_accounts.length ?? '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">Transaction Count</span>
                    <span className="font-mono tabular-nums text-[#F1F5F9]">
                      {accountDetail
                        ? accountDetail.account.incoming_count + accountDetail.account.outgoing_count
                        : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">First Transaction</span>
                    <span className="font-mono text-[11px] text-[#E2E8F0]">
                      {accountDetail?.account.first_transaction_at
                        ? formatDateTime(accountDetail.account.first_transaction_at)
                        : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">Last Transaction</span>
                    <span className="font-mono text-[11px] text-[#E2E8F0]">
                      {accountDetail?.account.last_transaction_at
                        ? formatDateTime(accountDetail.account.last_transaction_at)
                        : '—'}
                    </span>
                  </div>
                </div>

                {/* Expand Connected Accounts Button */}
                <button
                  type="button"
                  onClick={() => {
                    setExpandedNodeIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(selectedNodeObj.id)) next.delete(selectedNodeObj.id);
                      else next.add(selectedNodeObj.id);
                      return next;
                    });
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-xs font-medium bg-[#101827] hover:bg-[#1E2B42] text-[#F1F5F9] border border-[#263449]"
                >
                  <Expand className="w-3.5 h-3.5 text-[#3B82F6]" />
                  <span>
                    {expandedNodeIds.has(selectedNodeObj.id)
                      ? 'Collapse Highlighted Neighbors'
                      : 'Pin & Expand Connected Accounts'}
                  </span>
                </button>

                {/* Risk Indicators */}
                {accountDetail && (
                  <div>
                    <div className="text-[11px] font-semibold text-[#94A3B8] mb-2">
                      Risk Indicators
                    </div>
                    <div className="space-y-2">
                      {accountDetail.account.signals
                        .filter((s) => s.score > 0)
                        .map((sig) => (
                          <div
                            key={sig.key}
                            className="flex items-center justify-between text-[11px] bg-[#101827] border border-[#263449] rounded px-2.5 py-1.5"
                          >
                            <span className="text-[#E2E8F0]">{sig.label}</span>
                            <span className="font-mono text-[#94A3B8]">
                              {sig.metricValue} ({sig.score}/{sig.maxScore})
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Connected Accounts List */}
                {accountDetail && accountDetail.neighbor_accounts.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold text-[#94A3B8] mb-1.5">
                      Connected Accounts ({accountDetail.neighbor_accounts.length})
                    </div>
                    <div className="max-h-28 overflow-y-auto divide-y divide-[#263449] bg-[#101827] border border-[#263449] rounded">
                      {accountDetail.neighbor_accounts.slice(0, 12).map((nb) => (
                        <button
                          key={nb.upi_id}
                          type="button"
                          onClick={() => setSelectedNodeId(nb.upi_id)}
                          className="w-full px-2.5 py-1.5 flex items-center justify-between hover:bg-[#19253A] text-left"
                        >
                          <span className="font-mono text-[11px] text-[#3B82F6] truncate">
                            {nb.upi_id}
                          </span>
                          <RiskIndicator score={nb.risk_score} showScore={false} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Related Transaction History */}
                {accountDetail && accountDetail.transactions.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold text-[#94A3B8] mb-1.5">
                      Recent Related Transactions ({accountDetail.transactions.length})
                    </div>
                    <div className="max-h-36 overflow-y-auto divide-y divide-[#263449] bg-[#101827] border border-[#263449] rounded">
                      {accountDetail.transactions.slice(-10).reverse().map((tx) => {
                        const isIn = tx.receiver_upi === selectedNodeObj.id;
                        return (
                          <div key={tx.transaction_id} className="px-2.5 py-2 text-[11px]">
                            <div className="flex justify-between font-mono">
                              <span className={isIn ? 'text-[#3B82F6]' : 'text-[#F97316]'}>
                                {isIn ? 'IN' : 'OUT'} · {formatINR(tx.amount)}
                              </span>
                              <span className="text-[#64748B]">{tx.transaction_id}</span>
                            </div>
                            <div className="font-mono text-[#94A3B8] truncate mt-0.5">
                              {isIn ? `From ${tx.sender_upi}` : `To ${tx.receiver_upi}`}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="p-3 bg-[#101827] border-t border-[#263449]">
                <button
                  type="button"
                  onClick={() => onOpenAccountProfile(selectedNodeObj.id)}
                  className="w-full py-2 rounded-md text-xs font-semibold bg-[#3B82F6] hover:bg-blue-500 text-white transition-colors"
                >
                  Open Full Account Profile
                </button>
              </div>
            </>
          ) : selectedEdge ? (
            <>
              <div className="px-4 py-3.5 bg-[#101827] border-b border-[#263449] flex items-start justify-between">
                <div>
                  <div className="text-[11px] text-[#94A3B8]">Selected Transaction</div>
                  <div className="font-mono text-sm font-semibold text-[#F1F5F9] mt-0.5">
                    {selectedEdge.id}
                  </div>
                  <div className="font-mono text-[11px] text-[#64748B] mt-0.5">
                    Ref / UTR: {selectedEdge.utr}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedEdge(null)}
                  className="text-[#64748B] hover:text-white p-1"
                  aria-label="Close panel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 space-y-4 text-xs flex-1 overflow-y-auto">
                <div className="bg-[#101827] border border-[#263449] rounded p-3 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">Amount</span>
                    <span className="font-mono font-semibold text-[#F1F5F9]">
                      {formatINR(selectedEdge.amount)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">Timestamp</span>
                    <span className="font-mono text-[#E2E8F0]">
                      {formatDateTime(selectedEdge.timestamp)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">Transfer Hop</span>
                    <span className="font-mono text-[#E2E8F0]">Hop {selectedEdge.hop}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">Status</span>
                    <span className="font-mono text-[#22C55E]">{selectedEdge.status}</span>
                  </div>
                </div>

                <div className="bg-[#101827] border border-[#263449] rounded p-3 space-y-1.5 font-mono text-[11px]">
                  <div className="text-[#94A3B8] font-sans">Sender Account</div>
                  <button
                    type="button"
                    onClick={() => setSelectedNodeId(selectedEdge.source)}
                    className="text-[#3B82F6] hover:underline break-all text-left"
                  >
                    {selectedEdge.source}
                  </button>
                  <div className="text-[#94A3B8] font-sans pt-1">Receiver Account</div>
                  <button
                    type="button"
                    onClick={() => setSelectedNodeId(selectedEdge.target)}
                    className="text-[#F97316] hover:underline break-all text-left"
                  >
                    {selectedEdge.target}
                  </button>
                </div>

                <div>
                  <div className="text-[11px] font-semibold text-[#94A3B8] mb-1">
                    Linked Complaints ({selectedEdge.complaint_ids.length})
                  </div>
                  <div className="font-mono text-[11px] text-[#E2E8F0] leading-relaxed">
                    {selectedEdge.complaint_ids.join(', ')}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="p-5 space-y-4 text-xs flex-1 overflow-y-auto">
              <div className="pb-3 border-b border-[#263449]">
                <div className="text-[11px] font-medium text-[#3B82F6]">{activeCluster.cluster_id}</div>
                <div className="text-sm font-semibold text-[#F1F5F9] mt-0.5">{activeCluster.name}</div>
                <p className="text-xs text-[#94A3B8] mt-1">
                  Click any account node on the left to highlight its incoming &amp; outgoing flows and inspect its transaction history.
                </p>
              </div>

              <div className="space-y-2 bg-[#101827] border border-[#263449] rounded p-3">
                <div className="flex justify-between">
                  <span className="text-[#94A3B8]">Connected Complaints</span>
                  <span className="font-mono font-semibold text-[#F1F5F9]">
                    {activeCluster.complaint_ids.length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#94A3B8]">Reported Exposure</span>
                  <span className="font-mono font-semibold text-[#F1F5F9]">
                    {formatINR(activeCluster.total_reported_amount)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#94A3B8]">Shared Mule-Like Accounts</span>
                  <span className="font-mono font-semibold text-[#F97316]">
                    {activeCluster.shared_recipient_accounts.length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#94A3B8]">Final Destination Accounts</span>
                  <span className="font-mono text-[#F1F5F9]">
                    {activeCluster.downstream_accounts.length}
                  </span>
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold text-[#94A3B8] mb-2">
                  Key Shared Accounts (Click to Inspect)
                </div>
                <div className="space-y-1">
                  {activeCluster.shared_recipient_accounts.slice(0, 8).map((id) => {
                    const node = activeCluster.nodes.find((n) => n.id === id);
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setSelectedNodeId(id)}
                        className="w-full px-2.5 py-2 rounded bg-[#101827] hover:bg-[#19253A] border border-[#263449] flex items-center justify-between text-left"
                      >
                        <span className="font-mono text-[11px] text-[#F1F5F9] truncate">{id}</span>
                        {node && <RiskIndicator score={node.risk_score} showScore={false} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
