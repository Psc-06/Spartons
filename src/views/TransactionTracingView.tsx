import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Download,
  GitBranch,
  Info,
  Loader2,
  Play,
  Scale,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { MatchedComplaint, TraceResult, TransactionStatus } from '../shared/types';
import { api, downloadCsvFile, formatDateTime, formatINR, formatShortINR } from '../lib/api';

interface TransactionTracingViewProps {
  datasetId: string;
  complaints: MatchedComplaint[];
  initialComplaintId: string | null;
  onSelectAccount: (upiId: string) => void;
  onAskAiAboutComplaint: (complaintId: string) => void;
  onAccountUpdated?: (message?: string) => void;
}

const WINDOW_OPTIONS = [
  { label: '1 Hour', hours: 1 },
  { label: '6 Hours', hours: 6 },
  { label: '24 Hours', hours: 24 },
  { label: '3 Days', hours: 72 },
  { label: '7 Days', hours: 168 },
];

function getEdgeLatencyStyle(
  hop: number,
  minutesSincePrev: number,
  status: TransactionStatus,
  isCircular: boolean,
): { color: string; markerId: string; textColor: string; tierLabel: string } {
  if (status !== 'SUCCESS') {
    return { color: '#64748B', markerId: 'arrow-muted', textColor: '#94A3B8', tierLabel: 'Non-settled' };
  }
  if (isCircular) {
    return { color: '#EF4444', markerId: 'arrow-crit', textColor: '#FCA5A5', tierLabel: 'Circular' };
  }
  if (hop === 1) {
    return { color: '#38BDF8', markerId: 'arrow-sky', textColor: '#7DD3FC', tierLabel: 'Origin' };
  }
  if (minutesSincePrev < 15) {
    return { color: '#EF4444', markerId: 'arrow-crit', textColor: '#FCA5A5', tierLabel: 'Critical <15m' };
  }
  if (minutesSincePrev <= 60) {
    return { color: '#F59E0B', markerId: 'arrow-amber', textColor: '#FCD34D', tierLabel: 'Rapid 15-60m' };
  }
  if (minutesSincePrev <= 120) {
    return { color: '#38BDF8', markerId: 'arrow-sky', textColor: '#7DD3FC', tierLabel: 'Layering <=2h' };
  }
  return { color: '#14B8A6', markerId: 'arrow-teal', textColor: '#5EEAD4', tierLabel: 'Delayed >2h' };
}

export const TransactionTracingView: React.FC<TransactionTracingViewProps> = ({
  datasetId,
  complaints,
  initialComplaintId,
  onSelectAccount,
  onAskAiAboutComplaint,
  onAccountUpdated,
}) => {
  const [complaintId, setComplaintId] = useState<string>(
    initialComplaintId || complaints[0]?.complaint_id || '',
  );
  const [maxHops, setMaxHops] = useState<number>(5);
  const [windowHours, setWindowHours] = useState<number>(72);
  const [minAmount, setMinAmount] = useState<number>(0);
  const [statuses, setStatuses] = useState<TransactionStatus[]>(['SUCCESS']);
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyingAccountId, setApplyingAccountId] = useState<string | null>(null);
  const [appliedAccountIds, setAppliedAccountIds] = useState<Record<string, string>>({});

  useEffect(() => {
    if (initialComplaintId) {
      setComplaintId(initialComplaintId);
    } else if (!complaintId && complaints.length > 0) {
      setComplaintId(complaints[0].complaint_id);
    }
  }, [initialComplaintId, complaints, complaintId]);

  const executeTrace = async (targetId = complaintId) => {
    if (!targetId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.runTrace({
        datasetId,
        complaintId: targetId,
        maxHops,
        windowHours,
        minAmount,
        statuses: statuses.length > 0 ? statuses : ['SUCCESS'],
      });
      setTrace(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run transaction trace.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (complaintId) {
      executeTrace(complaintId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complaintId, maxHops, windowHours, minAmount, statuses.join(','), datasetId]);

  const toggleStatus = (st: TransactionStatus) => {
    if (st === 'SUCCESS') return; // SUCCESS is always required for tracing
    setStatuses((prev) =>
      prev.includes(st) ? prev.filter((item) => item !== st) : [...prev, st],
    );
  };

  const handleQuickExecuteLien = async (targetAccountId: string, targetComplaintId: string) => {
    setApplyingAccountId(targetAccountId);
    try {
      const res = await api.applyPrecisionLien(targetAccountId, {
        complaintId: targetComplaintId,
        datasetId,
        mode: 'PRECISION_LIEN',
      });
      setAppliedAccountIds((prev) => ({
        ...prev,
        [targetAccountId]: res.account.lienDetails?.cbsReferenceId || 'APPLIED',
      }));
      onAccountUpdated?.(
        `Executed Precision Lien of ${formatINR(res.account.precisionLienHold)} on ${targetAccountId} (${formatINR(res.account.usableCleanBalance)} clean balance protected).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute precision lien.');
    } finally {
      setApplyingAccountId(null);
    }
  };

  // Group nodes by hop layer for clean branching flow SVG diagram
  const layeredDiagram = useMemo(() => {
    if (!trace) return null;
    const nodeHop = new Map<string, number>();
    nodeHop.set(trace.complaint.sender_upi, 0);
    nodeHop.set(trace.complaint.receiver_upi, 1);
    for (const e of trace.edges) {
      if (!nodeHop.has(e.receiver_upi)) {
        nodeHop.set(e.receiver_upi, e.hop);
      }
    }

    const columns = new Map<number, string[]>();
    for (const [acct, hop] of nodeHop.entries()) {
      const list = columns.get(hop) ?? [];
      list.push(acct);
      columns.set(hop, list);
    }

    const sortedHops = [...columns.keys()].sort((a, b) => a - b);
    const colWidth = 248;
    const rowHeight = 76;
    const maxRows = Math.max(1, ...[...columns.values()].map((arr) => arr.length));
    const svgWidth = Math.max(820, sortedHops.length * colWidth + 60);
    const svgHeight = Math.max(240, maxRows * rowHeight + 70);

    const pos = new Map<string, { x: number; y: number; hop: number }>();
    sortedHops.forEach((hop, colIdx) => {
      const items = columns.get(hop) ?? [];
      const totalH = items.length * rowHeight;
      const startY = (svgHeight - totalH) / 2 + rowHeight / 2 + 8;
      items.forEach((acct, rowIdx) => {
        pos.set(acct, {
          x: 40 + colIdx * colWidth,
          y: startY + rowIdx * rowHeight,
          hop,
        });
      });
    });

    return { pos, svgWidth, svgHeight, sortedHops };
  }, [trace]);

  const handleExportTraceCsv = () => {
    if (!trace) return;
    downloadCsvFile(
      `muleshield_trace_${trace.complaint.complaint_id}.csv`,
      [
        'hop',
        'transaction_id',
        'utr',
        'timestamp',
        'sender_upi',
        'receiver_upi',
        'amount_inr',
        'potentially_attributed_inr',
        'attribution_status',
        'status',
        'minutes_since_origin',
        'is_circular',
      ],
      trace.timeline.map((e) => [
        e.hop,
        e.transaction_id,
        e.utr,
        e.timestamp,
        e.sender_upi,
        e.receiver_upi,
        e.amount,
        e.potentially_attributed_amount,
        e.attribution_status,
        e.status,
        e.minutes_since_origin,
        e.is_circular,
      ]),
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-4 border-b border-[#1E2D45]">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            Multi-Hop Transaction Tracing Engine
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Forward-only chronological tracing with conservative FIFO fund attribution and mixed-fund separation.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {trace && (
            <>
              <button
                type="button"
                onClick={() => onAskAiAboutComplaint(trace.complaint.complaint_id)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-[#132038] hover:bg-[#1B2C4A] text-teal-300 border border-teal-500/30"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Explain Trace with AI</span>
              </button>
              <button
                type="button"
                onClick={handleExportTraceCsv}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-[#131F33] hover:bg-[#1B2B45] text-slate-200 border border-[#243652]"
              >
                <Download className="w-3.5 h-3.5 text-sky-400" />
                <span>Export Trail CSV</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Configurable Tracing Parameters */}
      <div className="bg-[#0F172A] border border-[#1E2D45] rounded-md p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 items-end">
        <div className="xl:col-span-2">
          <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">
            Select Fraud Complaint
          </label>
          <select
            value={complaintId}
            onChange={(e) => setComplaintId(e.target.value)}
            className="w-full bg-[#080E1A] border border-[#1E2D45] rounded-md px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-sky-500"
          >
            {complaints.map((c) => (
              <option key={c.complaint_id} value={c.complaint_id}>
                {c.complaint_id} · {formatINR(c.amount)} → {c.receiver_upi} ({c.match_status})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">
            Maximum Hops (1–5)
          </label>
          <div className="flex items-center gap-1 bg-[#080E1A] p-1 rounded-md border border-[#1E2D45]">
            {[1, 2, 3, 4, 5].map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setMaxHops(h)}
                className={`flex-1 py-1 text-xs font-mono rounded transition-colors ${
                  maxHops === h
                    ? 'bg-sky-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {h}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">
            Tracing Window
          </label>
          <select
            value={windowHours}
            onChange={(e) => setWindowHours(Number(e.target.value))}
            className="w-full bg-[#080E1A] border border-[#1E2D45] rounded-md px-3 py-2 text-xs text-slate-100 focus:outline-none"
          >
            {WINDOW_OPTIONS.map((w) => (
              <option key={w.hours} value={w.hours}>
                {w.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">
            Min Amount (₹)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              step={1000}
              value={minAmount}
              onChange={(e) => setMinAmount(Math.max(0, Number(e.target.value)))}
              className="w-full bg-[#080E1A] border border-[#1E2D45] rounded-md px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => executeTrace(complaintId)}
              className="p-2 rounded-md bg-sky-500 hover:bg-sky-400 text-slate-950 shrink-0"
              title="Run Trace"
              aria-label="Run Trace"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Status Audit Visibility Row */}
        <div className="md:col-span-2 xl:col-span-5 pt-2 border-t border-[#1E2D45] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-slate-400 font-medium">Status Visibility:</span>
            {(['SUCCESS', 'FAILED', 'REVERSED', 'PENDING'] as TransactionStatus[]).map((st) => (
              <label key={st} className="inline-flex items-center gap-1.5 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={statuses.includes(st)}
                  disabled={st === 'SUCCESS'}
                  onChange={() => toggleStatus(st)}
                  className="accent-sky-500"
                />
                <span className="font-mono text-[11px]">{st}</span>
              </label>
            ))}
          </div>
          <span className="text-[11px] text-slate-500">
            Non-settled payments are never traced forward as completed transfers.
          </span>
        </div>
      </div>

      {loading && (
        <div className="p-6 bg-[#0F172A] border border-[#1E2D45] rounded-md flex items-center gap-3 text-xs text-sky-300">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Executing forward multi-hop FIFO fund trace...</span>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-950/40 border border-red-500/40 rounded-md text-xs text-red-200">
          {error}
        </div>
      )}

      {trace && !loading && (
        <>
          {/* Warnings */}
          {trace.warnings.length > 0 && (
            <div className="p-4 bg-amber-950/25 border border-amber-500/35 rounded-md space-y-1">
              {trace.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-amber-200">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* Money Attribution Summary KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[#0F172A] border border-[#1E2D45] rounded-md p-4">
              <div className="text-xs text-slate-400">Original Fraud Amount</div>
              <div className="text-xl font-bold font-mono tabular-nums text-white mt-1">
                {formatINR(trace.original_amount)}
              </div>
              <div className="text-[11px] text-slate-500 font-mono mt-1">
                {trace.complaint.reported_transaction_id} · {trace.complaint.utr}
              </div>
            </div>

            <div className="bg-[#0F172A] border border-[#1E2D45] rounded-md p-4">
              <div className="text-xs text-slate-400">Observed Onward Transfers</div>
              <div className="text-xl font-bold font-mono tabular-nums text-sky-300 mt-1">
                {formatINR(trace.total_outgoing_observed)}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Across {Math.max(0, trace.edges.filter((e) => e.status === 'SUCCESS').length - 1)} downstream transfer(s)
              </div>
            </div>

            <div className="bg-[#0F172A] border border-[#1E2D45] rounded-md p-4">
              <div className="text-xs text-slate-400">Potentially Attributed (FIFO)</div>
              <div className="text-xl font-bold font-mono tabular-nums text-teal-300 mt-1">
                {formatINR(trace.total_potentially_attributed)}
              </div>
              <div className="text-[11px] mt-1 font-medium text-amber-300">
                {trace.mixed_funds_detected
                  ? 'Estimated · Mixed funds detected'
                  : 'Conservative FIFO allocation'}
              </div>
            </div>

            <div className="bg-[#0F172A] border border-[#1E2D45] rounded-md p-4">
              <div className="text-xs text-slate-400">Untraced Remainder</div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-200 mt-1">
                {formatINR(trace.untraced_amount)}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Retained, cash-withdrawn, or outside window
              </div>
            </div>
          </div>

          {/* Detected Flow Patterns */}
          {trace.patterns.length > 0 && (
            <div className="bg-[#0F172A] border border-[#1E2D45] rounded-md p-4">
              <div className="text-xs font-semibold text-white mb-2.5 flex items-center gap-2">
                <GitBranch className="w-3.5 h-3.5 text-teal-400" />
                <span>Detected Behavioural Patterns in Traced Path</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {trace.patterns.map((pat) => (
                  <div
                    key={pat.code}
                    className="bg-[#0A1120] border border-[#1E2D45] rounded p-3 text-xs"
                  >
                    <div
                      className={`font-semibold ${
                        pat.code === 'CIRCULAR_FLOW' ? 'text-red-400' : 'text-sky-300'
                      }`}
                    >
                      {pat.label}
                    </div>
                    <p className="text-slate-400 text-[11px] mt-1">{pat.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Branching Multi-Hop Flow Diagram (SVG) */}
          {layeredDiagram && trace.edges.length > 0 && (
            <div className="bg-[#0F172A] border border-[#1E2D45] rounded-md overflow-hidden">
              <div className="px-5 py-3 border-b border-[#1E2D45] flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    Branching Multi-Hop Fund Flow Diagram (Color-Coded Edge Latencies)
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Visualizes multi-hop branching DAG with inter-hop traversal latency and hop badges. Click any node to open its profile.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono">
                  <span className="inline-flex items-center gap-1.5 text-red-400">
                    <span className="w-2.5 h-0.5 bg-red-500 inline-block" /> &lt;15m Critical
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-amber-300">
                    <span className="w-2.5 h-0.5 bg-amber-400 inline-block" /> 15–60m Rapid
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-sky-300">
                    <span className="w-2.5 h-0.5 bg-sky-400 inline-block" /> 61–120m NCRP 2h
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-teal-300">
                    <span className="w-2.5 h-0.5 bg-teal-400 inline-block" /> &gt;120m Delayed
                  </span>
                </div>
              </div>
              <div className="overflow-x-auto bg-[#070C17] p-4">
                <svg
                  width={layeredDiagram.svgWidth}
                  height={layeredDiagram.svgHeight}
                  className="block"
                >
                  <defs>
                    <marker id="arrow-crit" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                      <path d="M 0 1 L 10 5 L 0 9 z" fill="#EF4444" />
                    </marker>
                    <marker id="arrow-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                      <path d="M 0 1 L 10 5 L 0 9 z" fill="#F59E0B" />
                    </marker>
                    <marker id="arrow-sky" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                      <path d="M 0 1 L 10 5 L 0 9 z" fill="#38BDF8" />
                    </marker>
                    <marker id="arrow-teal" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                      <path d="M 0 1 L 10 5 L 0 9 z" fill="#14B8A6" />
                    </marker>
                    <marker id="arrow-muted" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                      <path d="M 0 1 L 10 5 L 0 9 z" fill="#64748B" />
                    </marker>
                  </defs>

                  {/* Column Headers */}
                  {layeredDiagram.sortedHops.map((hop, idx) => (
                    <text
                      key={hop}
                      x={40 + idx * 248 + 80}
                      y={18}
                      textAnchor="middle"
                      fill="#94A3B8"
                      fontSize={11}
                      fontWeight={600}
                      fontFamily="IBM Plex Mono, monospace"
                    >
                      {hop === 0 ? 'VICTIM SOURCE' : hop === 1 ? 'HOP 1 · INITIAL' : `HOP ${hop}`}
                    </text>
                  ))}

                  {/* Directed Edges with Color-Coded Latency */}
                  {trace.edges.map((edge) => {
                    const from = layeredDiagram.pos.get(edge.sender_upi);
                    const to = layeredDiagram.pos.get(edge.receiver_upi);
                    if (!from || !to) return null;
                    const x1 = from.x + 160;
                    const y1 = from.y;
                    const x2 = to.x;
                    const y2 = to.y;
                    const isBack = to.hop <= from.hop;
                    const style = getEdgeLatencyStyle(
                      edge.hop,
                      edge.minutes_since_prev_inflow,
                      edge.status,
                      edge.is_circular,
                    );

                    const pathD = isBack
                      ? `M ${from.x + 80} ${from.y + 22} C ${from.x + 80} ${from.y + 64}, ${to.x + 80} ${to.y + 64}, ${to.x + 80} ${to.y + 22}`
                      : `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`;

                    const latencyTag =
                      edge.hop === 1 ? 'Origin' : `+${edge.minutes_since_prev_inflow}m`;

                    return (
                      <g key={edge.transaction_id}>
                        <path
                          d={pathD}
                          fill="none"
                          stroke={style.color}
                          strokeWidth={edge.minutes_since_prev_inflow < 15 && edge.hop >= 2 ? 2.4 : 1.9}
                          strokeDasharray={edge.status !== 'SUCCESS' || edge.is_circular ? '5 3' : undefined}
                          markerEnd={`url(#${style.markerId})`}
                        />
                        <text
                          x={isBack ? (from.x + to.x) / 2 + 80 : (x1 + x2) / 2}
                          y={isBack ? Math.max(from.y, to.y) + 56 : (y1 + y2) / 2 - 7}
                          textAnchor="middle"
                          fill={style.textColor}
                          fontSize={10}
                          fontWeight={600}
                          fontFamily="IBM Plex Mono, monospace"
                        >
                          {formatShortINR(edge.amount)} · {latencyTag}
                          {edge.attribution_status === 'ESTIMATED_MIXED_FUNDS' ? ' (est)' : ''}
                        </text>
                      </g>
                    );
                  })}

                  {/* Account Nodes with Crisp Hop Badges */}
                  {[...layeredDiagram.pos.entries()].map(([acct, coord]) => {
                    const isVictim = coord.hop === 0;
                    const isInit = coord.hop === 1;
                    const borderColor = isVictim
                      ? '#38BDF8'
                      : isInit
                      ? '#F59E0B'
                      : coord.hop === 2
                      ? '#EF4444'
                      : '#14B8A6';
                    const hopBadgeLabel = isVictim ? 'VICTIM' : `HOP ${coord.hop}`;
                    return (
                      <g
                        key={acct}
                        onClick={() => onSelectAccount(acct)}
                        className="cursor-pointer"
                      >
                        <rect
                          x={coord.x}
                          y={coord.y - 22}
                          width={160}
                          height={44}
                          rx={5}
                          fill="#0F172A"
                          stroke={borderColor}
                          strokeWidth={1.5}
                        />
                        <text
                          x={coord.x + 8}
                          y={coord.y - 8}
                          textAnchor="start"
                          fill={borderColor}
                          fontSize={9}
                          fontWeight={700}
                          fontFamily="IBM Plex Mono, monospace"
                        >
                          {hopBadgeLabel}
                        </text>
                        <text
                          x={coord.x + 80}
                          y={coord.y + 11}
                          textAnchor="middle"
                          fill="#F1F5F9"
                          fontSize={10.5}
                          fontFamily="IBM Plex Mono, monospace"
                        >
                          {acct.length > 21 ? `${acct.slice(0, 19)}…` : acct}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          )}

          {/* Multi-Hop Precision Lien Attribution Breakdown */}
          {trace.account_lien_allocations && trace.account_lien_allocations.length > 0 && (
            <div className="bg-[#0F172A] border border-[#1E2D45] rounded-md overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#1E2D45] flex flex-wrap items-center justify-between gap-2 bg-[#0B1222]">
                <div className="flex items-center gap-2">
                  <Scale className="w-4 h-4 text-teal-400" />
                  <div>
                    <h2 className="text-sm font-semibold text-white">
                      Multi-Hop Precision Lien Attribution ({trace.account_lien_allocations.length} recipient accounts)
                    </h2>
                    <p className="text-[11px] text-slate-400">
                      Deterministic RBI SOP earmarks across traced hops: Held = min(Tainted Inbound, Balance, Victim Deficit)
                    </p>
                  </div>
                </div>
                <span className="font-mono text-[11px] text-emerald-400">
                  Zero Blanket Freezes · Clean Merchant Funds Preserved
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#080E1A] text-slate-400 border-b border-[#1E2D45]">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Account UPI ID</th>
                      <th className="px-4 py-2.5 font-medium">Hop</th>
                      <th className="px-4 py-2.5 font-medium text-right">Total Balance</th>
                      <th className="px-4 py-2.5 font-medium text-right">Tainted Inbound</th>
                      <th className="px-4 py-2.5 font-medium text-right">Precision Lien [HELD]</th>
                      <th className="px-4 py-2.5 font-medium text-right">Protected [USABLE]</th>
                      <th className="px-4 py-2.5 font-medium text-right">RBI SOP Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#172338]">
                    {trace.account_lien_allocations.map((alloc) => {
                      const cbsRef = appliedAccountIds[alloc.accountId];
                      return (
                        <tr key={alloc.accountId} className="hover:bg-[#142036]">
                          <td className="px-4 py-2.5 font-mono">
                            <button
                              type="button"
                              onClick={() => onSelectAccount(alloc.accountId)}
                              className="text-sky-300 hover:underline font-medium"
                            >
                              {alloc.accountId}
                            </button>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-slate-300">
                            H{alloc.hopDepth}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-200">
                            {formatINR(alloc.totalBalance)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-sky-300">
                            {formatINR(alloc.taintedReceived)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-amber-400 font-semibold">
                            {formatINR(alloc.heldAmount)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-emerald-400 font-semibold">
                            {formatINR(alloc.usableCleanBalance)}
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-2.5">
                              {cbsRef ? (
                                <span className="font-mono text-[11px] text-emerald-400">
                                  Lien Active ({cbsRef})
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  disabled={applyingAccountId !== null || alloc.heldAmount <= 0}
                                  onClick={() =>
                                    handleQuickExecuteLien(alloc.accountId, alloc.complaintId)
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-teal-500 hover:bg-teal-400 disabled:opacity-45 text-slate-950"
                                >
                                  {applyingAccountId === alloc.accountId ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <ShieldCheck className="w-3 h-3" />
                                  )}
                                  <span>Execute Lien</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => onSelectAccount(alloc.accountId)}
                                className="text-[11px] text-sky-400 hover:underline"
                              >
                                Inspect SOP
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Chronological Transaction Path Table */}
          <div className="bg-[#0F172A] border border-[#1E2D45] rounded-md overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#1E2D45]">
              <h2 className="text-sm font-semibold text-white">
                Traced Multi-Hop Transaction Sequence ({trace.timeline.length})
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#0B1222] text-slate-400 border-b border-[#1E2D45]">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Hop Badge</th>
                    <th className="px-4 py-2.5 font-medium">Timestamp &amp; Hop Latency</th>
                    <th className="px-4 py-2.5 font-medium">Txn ID / UTR</th>
                    <th className="px-4 py-2.5 font-medium">Sender → Receiver</th>
                    <th className="px-4 py-2.5 font-medium text-right">Transfer Amt</th>
                    <th className="px-4 py-2.5 font-medium text-right">Potentially Attributed</th>
                    <th className="px-4 py-2.5 font-medium">Attribution Basis</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#172338]">
                  {trace.timeline.map((edge) => {
                    const latStyle = getEdgeLatencyStyle(
                      edge.hop,
                      edge.minutes_since_prev_inflow,
                      edge.status,
                      edge.is_circular,
                    );
                    return (
                    <tr key={edge.transaction_id} className="hover:bg-[#142036]">
                      <td className="px-4 py-2.5 font-mono whitespace-nowrap">
                        <span
                          className={`font-bold text-[11px] ${
                            edge.hop === 1
                              ? 'text-amber-300'
                              : edge.hop === 2
                              ? 'text-red-400'
                              : 'text-teal-300'
                          }`}
                        >
                          HOP {edge.hop}
                        </span>
                        {edge.is_circular && (
                          <span className="ml-1.5 text-red-400 font-sans font-semibold">
                            (Loop)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-mono tabular-nums text-[11px] text-slate-400 whitespace-nowrap">
                        <div>{formatDateTime(edge.timestamp)}</div>
                        <div style={{ color: latStyle.textColor }}>
                          {edge.hop === 1
                            ? 'Origin T+0m'
                            : `+${edge.minutes_since_prev_inflow}m hop (${latStyle.tierLabel})`}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-slate-300 whitespace-nowrap">
                        <div>{edge.transaction_id}</div>
                        <div className="text-slate-500">{edge.utr}</div>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px]">
                        <button
                          type="button"
                          onClick={() => onSelectAccount(edge.sender_upi)}
                          className="text-sky-300 hover:underline"
                        >
                          {edge.sender_upi}
                        </button>
                        <span className="text-slate-500 mx-1.5">→</span>
                        <button
                          type="button"
                          onClick={() => onSelectAccount(edge.receiver_upi)}
                          className="text-teal-300 hover:underline"
                        >
                          {edge.receiver_upi}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-white font-medium">
                        {formatINR(edge.amount)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-teal-300 font-medium">
                        {edge.status === 'SUCCESS'
                          ? formatINR(edge.potentially_attributed_amount)
                          : '₹0'}
                      </td>
                      <td className="px-4 py-2.5 text-[11px]">
                        {edge.attribution_status === 'DIRECT_FIFO' ? (
                          <span className="text-emerald-400">Direct FIFO</span>
                        ) : edge.attribution_status === 'ESTIMATED_MIXED_FUNDS' ? (
                          <span className="text-amber-400">Estimated (Mixed Funds)</span>
                        ) : (
                          <span className="text-slate-500">Excluded (Non-Settled)</span>
                        )}
                      </td>
                      <td
                        className={`px-4 py-2.5 font-mono text-[11px] ${
                          edge.status === 'SUCCESS' ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {edge.status}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Money Attribution Assumptions Box */}
          <div className="bg-[#0F172A] border border-[#1E2D45] rounded-md p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200 mb-2">
              <Info className="w-3.5 h-3.5 text-sky-400" />
              <span>Conservative Money Attribution Assumptions &amp; Evidentiary Limits</span>
            </div>
            <ul className="list-disc pl-5 space-y-1 text-xs text-slate-400">
              {trace.attribution_assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
};
