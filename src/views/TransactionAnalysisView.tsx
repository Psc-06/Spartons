import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Download,
  Filter,
  GitBranch,
  Info,
  Loader2,
  Play,
  RotateCcw,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react';
import type {
  MatchedComplaint,
  TraceResult,
  TransactionStatus,
  TransactionsQueryResponse,
} from '../shared/types';
import {
  api,
  downloadCsvFile,
  formatDateTime,
  formatINR,
  formatShortINR,
} from '../lib/api';
import { InfoTooltip, RiskIndicator } from '../components/UiPrimitives';

export type TransactionSubTab = 'ledger' | 'tracer';

interface TransactionAnalysisViewProps {
  datasetId: string;
  complaints: MatchedComplaint[];
  initialSubTab: TransactionSubTab;
  initialComplaintId: string | null;
  onSubTabChange?: (tab: TransactionSubTab) => void;
  onSelectAccount: (upiId: string) => void;
  onSelectCluster: (clusterId: string) => void;
  onOpenUpload: () => void;
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

function getTraceLatencyStyle(
  hop: number,
  minutesSincePrev: number,
  status: TransactionStatus,
  isCircular: boolean,
): { color: string; markerId: string; textColor: string; tierLabel: string } {
  if (status !== 'SUCCESS') {
    return { color: '#64748B', markerId: 'trace-arrow-muted', textColor: '#94A3B8', tierLabel: 'Non-settled' };
  }
  if (isCircular) {
    return { color: '#EF4444', markerId: 'trace-arrow-red', textColor: '#FCA5A5', tierLabel: 'Circular' };
  }
  if (hop === 1) {
    return { color: '#38BDF8', markerId: 'trace-arrow-sky', textColor: '#7DD3FC', tierLabel: 'Origin' };
  }
  if (minutesSincePrev < 15) {
    return { color: '#EF4444', markerId: 'trace-arrow-red', textColor: '#FCA5A5', tierLabel: 'Critical <15m' };
  }
  if (minutesSincePrev <= 60) {
    return { color: '#F59E0B', markerId: 'trace-arrow-amber', textColor: '#FCD34D', tierLabel: 'Rapid 15-60m' };
  }
  if (minutesSincePrev <= 120) {
    return { color: '#38BDF8', markerId: 'trace-arrow-sky', textColor: '#7DD3FC', tierLabel: 'Layering <=2h' };
  }
  return { color: '#14B8A6', markerId: 'trace-arrow-teal', textColor: '#5EEAD4', tierLabel: 'Delayed >2h' };
}

export const TransactionAnalysisView: React.FC<TransactionAnalysisViewProps> = ({
  datasetId,
  complaints,
  initialSubTab,
  initialComplaintId,
  onSubTabChange,
  onSelectAccount,
  onSelectCluster,
  onOpenUpload,
  onAskAiAboutComplaint,
  onAccountUpdated,
}) => {
  const [subTab, setSubTab] = useState<TransactionSubTab>(initialSubTab);

  // Sync sub-tab when navigated programmatically from Overview/Alerts/Search
  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  const switchSubTab = (tab: TransactionSubTab) => {
    setSubTab(tab);
    onSubTabChange?.(tab);
  };

  // ---------------------------------------------------------------------------
  // Tab 1: All Transactions Ledger State
  // ---------------------------------------------------------------------------
  const [txData, setTxData] = useState<TransactionsQueryResponse | null>(null);
  const [txLoading, setTxLoading] = useState(true);
  const [txError, setTxError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minAmount, setMinAmount] = useState<string>('');
  const [maxAmount, setMaxAmount] = useState<string>('');
  const [senderFilter, setSenderFilter] = useState('');
  const [receiverFilter, setReceiverFilter] = useState('');
  const [riskLevel, setRiskLevel] = useState<string>('ALL');
  const [channelFilter, setChannelFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [onlySuspicious, setOnlySuspicious] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(100);

  const fetchTransactions = useCallback(async () => {
    if (!datasetId) return;
    setTxLoading(true);
    setTxError(null);
    try {
      const res = await api.getTransactions({
        datasetId,
        search: search.trim() || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        minAmount: minAmount ? Number(minAmount) : undefined,
        maxAmount: maxAmount ? Number(maxAmount) : undefined,
        sender: senderFilter.trim() || undefined,
        receiver: receiverFilter.trim() || undefined,
        riskLevel,
        channel: channelFilter,
        status: statusFilter,
        onlySuspicious,
      });
      setTxData(res);
    } catch (err) {
      setTxError(err instanceof Error ? err.message : 'Failed to load transactions.');
    } finally {
      setTxLoading(false);
    }
  }, [
    datasetId,
    search,
    dateFrom,
    dateTo,
    minAmount,
    maxAmount,
    senderFilter,
    receiverFilter,
    riskLevel,
    channelFilter,
    statusFilter,
    onlySuspicious,
  ]);

  useEffect(() => {
    const t = setTimeout(() => {
      fetchTransactions();
    }, 180);
    return () => clearTimeout(t);
  }, [fetchTransactions]);

  const resetLedgerFilters = () => {
    setSearch('');
    setDateFrom('');
    setDateTo('');
    setMinAmount('');
    setMaxAmount('');
    setSenderFilter('');
    setReceiverFilter('');
    setRiskLevel('ALL');
    setChannelFilter('ALL');
    setStatusFilter('ALL');
    setOnlySuspicious(false);
    setVisibleLimit(100);
  };

  const handleExportLedgerCsv = () => {
    if (!txData) return;
    downloadCsvFile(
      'muleshield_filtered_transactions.csv',
      [
        'transaction_id',
        'utr',
        'timestamp',
        'sender_upi',
        'receiver_upi',
        'amount_inr',
        'channel',
        'status',
        'risk_tier',
        'risk_score',
        'is_suspicious',
        'suspicious_reason',
        'linked_complaint_id',
        'cluster_id',
      ],
      txData.transactions.map((tx) => [
        tx.transaction_id,
        tx.utr,
        tx.timestamp,
        tx.sender_upi,
        tx.receiver_upi,
        tx.amount,
        tx.channel,
        tx.status,
        tx.risk_tier,
        tx.risk_score,
        tx.is_suspicious,
        tx.suspicious_reason,
        tx.linked_complaint_id ?? '',
        tx.cluster_id ?? '',
      ]),
    );
  };

  // ---------------------------------------------------------------------------
  // Tab 2: Multi-Hop FIFO Fund Tracer State
  // ---------------------------------------------------------------------------
  const [complaintId, setComplaintId] = useState<string>(
    initialComplaintId || complaints[0]?.complaint_id || '',
  );
  const [maxHops, setMaxHops] = useState<number>(5);
  const [windowHours, setWindowHours] = useState<number>(72);
  const [traceMinAmount, setTraceMinAmount] = useState<number>(0);
  const [statuses, setStatuses] = useState<TransactionStatus[]>(['SUCCESS']);
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [applyingAccountId, setApplyingAccountId] = useState<string | null>(null);
  const [appliedAccountIds, setAppliedAccountIds] = useState<Record<string, string>>({});

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
      setTraceError(err instanceof Error ? err.message : 'Failed to execute precision lien.');
    } finally {
      setApplyingAccountId(null);
    }
  };

  useEffect(() => {
    if (initialComplaintId) {
      setComplaintId(initialComplaintId);
    } else if (!complaintId && complaints.length > 0) {
      setComplaintId(complaints[0].complaint_id);
    }
  }, [initialComplaintId, complaints, complaintId]);

  const executeTrace = useCallback(
    async (targetId = complaintId) => {
      if (!targetId || !datasetId) return;
      setTraceLoading(true);
      setTraceError(null);
      try {
        const res = await api.runTrace({
          datasetId,
          complaintId: targetId,
          maxHops,
          windowHours,
          minAmount: traceMinAmount,
          statuses: statuses.length > 0 ? statuses : ['SUCCESS'],
        });
        setTrace(res);
      } catch (err) {
        setTraceError(err instanceof Error ? err.message : 'Failed to run transaction trace.');
      } finally {
        setTraceLoading(false);
      }
    },
    [complaintId, datasetId, maxHops, windowHours, traceMinAmount, statuses],
  );

  useEffect(() => {
    if (subTab === 'tracer' && complaintId) {
      executeTrace(complaintId);
    }
  }, [subTab, complaintId, executeTrace]);

  const toggleStatus = (st: TransactionStatus) => {
    if (st === 'SUCCESS') return;
    setStatuses((prev) =>
      prev.includes(st) ? prev.filter((item) => item !== st) : [...prev, st],
    );
  };

  // Build crisp left-to-right branching flow SVG for traced funds
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

  const summary = txData?.summary;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-[#263449]">
        <div>
          <h1 className="text-xl font-semibold text-[#F1F5F9] tracking-tight">
            Transaction Analysis
          </h1>
          <p className="text-xs text-[#94A3B8] mt-1">
            Inspect every uploaded transfer, filter by risk or account, and trace suspicious funds step-by-step across hops.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onOpenUpload}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold bg-[#3B82F6] hover:bg-blue-500 text-white transition-colors whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload CSV / XLSX</span>
          </button>
        </div>
      </div>

      {/* Top 5 Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          {
            label: 'Total Transactions Analyzed',
            value: summary ? summary.total_transactions.toLocaleString('en-IN') : '—',
            sub: `${complaints.length} reported complaints`,
          },
          {
            label: 'Total Money Transferred',
            value: summary ? formatShortINR(summary.total_volume) : '—',
            sub: 'Settled ledger volume',
          },
          {
            label: 'Unique Accounts',
            value: summary ? summary.unique_accounts.toLocaleString('en-IN') : '—',
            sub: 'Distinct UPI identifiers',
          },
          {
            label: 'Suspicious Transactions',
            value: summary ? summary.suspicious_transactions.toLocaleString('en-IN') : '—',
            sub: 'Flagged for analyst review',
            highlight: 'text-[#F97316]',
            tooltip:
              'Transactions linked to high-risk accounts, rapid pass-through relays, or active fraud clusters. Flags guide review and do not establish guilt.',
          },
          {
            label: 'Identified Transaction Chains',
            value: summary ? String(summary.identified_chains) : '—',
            sub: 'Multi-hop connected clusters',
          },
        ].map((m) => (
          <div key={m.label} className="bg-[#151F30] border border-[#263449] rounded-md p-4">
            <div className="text-xs text-[#94A3B8] font-medium flex items-center">
              <span>{m.label}</span>
              {m.tooltip && <InfoTooltip text={m.tooltip} />}
            </div>
            <div
              className={`text-2xl font-semibold font-mono tabular-nums mt-2 ${
                m.highlight || 'text-[#F1F5F9]'
              }`}
            >
              {m.value}
            </div>
            <div className="text-[11px] text-[#64748B] font-mono tabular-nums mt-1 truncate">
              {m.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#263449]">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => switchSubTab('ledger')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              subTab === 'ledger'
                ? 'border-[#3B82F6] text-[#F1F5F9]'
                : 'border-transparent text-[#94A3B8] hover:text-[#F1F5F9]'
            }`}
          >
            All Transactions
            {txData && (
              <span className="ml-2 font-mono text-[11px] text-[#64748B]">
                ({txData.total.toLocaleString('en-IN')})
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => switchSubTab('tracer')}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              subTab === 'tracer'
                ? 'border-[#3B82F6] text-[#F1F5F9]'
                : 'border-transparent text-[#94A3B8] hover:text-[#F1F5F9]'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>Trace Fund Movement (Hop-by-Hop)</span>
          </button>
        </div>

        <div className="pb-2 flex items-center gap-2">
          {subTab === 'ledger' && txData && (
            <button
              type="button"
              onClick={handleExportLedgerCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#151F30] hover:bg-[#1E2B42] text-[#F1F5F9] border border-[#263449]"
            >
              <Download className="w-3.5 h-3.5 text-[#3B82F6]" />
              <span>Export Filtered CSV</span>
            </button>
          )}
          {subTab === 'tracer' && trace && (
            <>
              <button
                type="button"
                onClick={() => onAskAiAboutComplaint(trace.complaint.complaint_id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#151F30] hover:bg-[#1E2B42] text-[#F1F5F9] border border-[#263449]"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#3B82F6]" />
                <span>Explain Trace with AI</span>
              </button>
              <button
                type="button"
                onClick={handleExportTraceCsv}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#151F30] hover:bg-[#1E2B42] text-[#F1F5F9] border border-[#263449]"
              >
                <Download className="w-3.5 h-3.5 text-[#3B82F6]" />
                <span>Export Trail CSV</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* =====================================================================
          TAB 1: ALL TRANSACTIONS LEDGER
         ===================================================================== */}
      {subTab === 'ledger' && (
        <div className="space-y-4">
          {/* Primary Filter Bar */}
          <div className="bg-[#151F30] border border-[#263449] rounded-md p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-3.5 h-3.5 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search transaction ID, reference (UTR), sender, receiver, or complaint ID..."
                  className="w-full bg-[#0B1120] border border-[#263449] focus:border-[#3B82F6] rounded-md pl-9 pr-3 py-1.5 text-xs text-[#F1F5F9] placeholder:text-[#64748B] focus:outline-none"
                />
              </div>

              {/* Risk Level Filter */}
              <select
                aria-label="Filter by risk level"
                value={riskLevel}
                onChange={(e) => setRiskLevel(e.target.value)}
                className="bg-[#0B1120] border border-[#263449] rounded-md px-3 py-1.5 text-xs text-[#F1F5F9]"
              >
                <option value="ALL">All Risk Levels</option>
                <option value="CRITICAL">Critical Risk</option>
                <option value="HIGH">High Risk</option>
                <option value="MEDIUM">Medium Risk</option>
                <option value="LOW">Low Risk</option>
              </select>

              {/* Channel Filter */}
              <select
                aria-label="Filter by transaction type"
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
                className="bg-[#0B1120] border border-[#263449] rounded-md px-3 py-1.5 text-xs text-[#F1F5F9]"
              >
                <option value="ALL">All Types</option>
                <option value="UPI_P2P">UPI P2P</option>
                <option value="UPI_INTENT">UPI Intent</option>
                <option value="UPI_QR">UPI QR</option>
                <option value="UPI_COLLECT">UPI Collect</option>
              </select>

              {/* Status Filter */}
              <select
                aria-label="Filter by transaction status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-[#0B1120] border border-[#263449] rounded-md px-3 py-1.5 text-xs text-[#F1F5F9]"
              >
                <option value="ALL">All Statuses</option>
                <option value="SUCCESS">Settled (SUCCESS)</option>
                <option value="FAILED">FAILED</option>
                <option value="REVERSED">REVERSED</option>
                <option value="PENDING">PENDING</option>
              </select>

              {/* Suspicious Only Toggle */}
              <label className="inline-flex items-center gap-2 text-xs text-[#F1F5F9] cursor-pointer px-2.5 py-1.5 rounded-md bg-[#0B1120] border border-[#263449]">
                <input
                  type="checkbox"
                  checked={onlySuspicious}
                  onChange={(e) => setOnlySuspicious(e.target.checked)}
                  className="accent-[#3B82F6]"
                />
                <span>Flagged Only</span>
              </label>

              <button
                type="button"
                onClick={() => setShowAdvancedFilters((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                  showAdvancedFilters
                    ? 'bg-[#3B82F6]/15 border-[#3B82F6]/40 text-[#93C5FD]'
                    : 'bg-[#0B1120] border-[#263449] text-[#94A3B8] hover:text-[#F1F5F9]'
                }`}
              >
                <Filter className="w-3.5 h-3.5" />
                <span>More Filters</span>
              </button>

              <button
                type="button"
                onClick={resetLedgerFilters}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-[#94A3B8] hover:text-[#F1F5F9]"
                title="Reset filters"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            </div>

            {/* Advanced Filter Row: Date Range, Amount Range, Sender, Receiver */}
            {showAdvancedFilters && (
              <div className="pt-3 border-t border-[#263449] grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
                <div>
                  <label className="block text-[11px] text-[#94A3B8] mb-1">Date From</label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full bg-[#0B1120] border border-[#263449] rounded px-2.5 py-1.5 font-mono text-[#F1F5F9]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#94A3B8] mb-1">Date To</label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full bg-[#0B1120] border border-[#263449] rounded px-2.5 py-1.5 font-mono text-[#F1F5F9]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#94A3B8] mb-1">Min Amount (₹)</label>
                  <input
                    type="number"
                    min={0}
                    value={minAmount}
                    onChange={(e) => setMinAmount(e.target.value)}
                    placeholder="0"
                    className="w-full bg-[#0B1120] border border-[#263449] rounded px-2.5 py-1.5 font-mono text-[#F1F5F9]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#94A3B8] mb-1">Max Amount (₹)</label>
                  <input
                    type="number"
                    min={0}
                    value={maxAmount}
                    onChange={(e) => setMaxAmount(e.target.value)}
                    placeholder="Any"
                    className="w-full bg-[#0B1120] border border-[#263449] rounded px-2.5 py-1.5 font-mono text-[#F1F5F9]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#94A3B8] mb-1">Sender Account</label>
                  <input
                    type="text"
                    value={senderFilter}
                    onChange={(e) => setSenderFilter(e.target.value)}
                    placeholder="e.g. victim"
                    className="w-full bg-[#0B1120] border border-[#263449] rounded px-2.5 py-1.5 font-mono text-[#F1F5F9]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#94A3B8] mb-1">Receiver Account</label>
                  <input
                    type="text"
                    value={receiverFilter}
                    onChange={(e) => setReceiverFilter(e.target.value)}
                    placeholder="e.g. hub"
                    className="w-full bg-[#0B1120] border border-[#263449] rounded px-2.5 py-1.5 font-mono text-[#F1F5F9]"
                  />
                </div>
              </div>
            )}
          </div>

          {txError && (
            <div className="p-4 bg-[#EF4444]/10 border border-[#EF4444]/40 rounded-md text-xs text-red-200">
              {txError}
            </div>
          )}

          {/* Transactions Table */}
          <div className="bg-[#151F30] border border-[#263449] rounded-md overflow-hidden">
            {txLoading && !txData ? (
              <div className="p-8 text-xs text-[#94A3B8] flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-[#3B82F6]" />
                <span>Loading analyzed transactions...</span>
              </div>
            ) : !txData || txData.transactions.length === 0 ? (
              <div className="p-10 text-center text-xs text-[#94A3B8]">
                No transactions match the current filter criteria.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#101827] text-[#94A3B8] border-b border-[#263449]">
                      <tr>
                        <th className="px-4 py-3 font-medium">Transaction ID / Ref</th>
                        <th className="px-4 py-3 font-medium">Timestamp</th>
                        <th className="px-4 py-3 font-medium">Sender Account</th>
                        <th className="px-4 py-3 font-medium">Receiver Account</th>
                        <th className="px-4 py-3 font-medium text-right">Amount</th>
                        <th className="px-4 py-3 font-medium">Type / Status</th>
                        <th className="px-4 py-3 font-medium">Risk Signal</th>
                        <th className="px-4 py-3 font-medium text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#263449]">
                      {txData.transactions.slice(0, visibleLimit).map((tx) => (
                        <tr
                          key={tx.transaction_id}
                          className={`hover:bg-[#19253A] transition-colors ${
                            tx.is_suspicious ? 'bg-[#EF4444]/[0.03]' : ''
                          }`}
                        >
                          <td className="px-4 py-2.5 font-mono whitespace-nowrap">
                            <div className="text-[#F1F5F9] font-medium">{tx.transaction_id}</div>
                            <div className="text-[11px] text-[#64748B]">{tx.utr}</div>
                          </td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-[11px] text-[#94A3B8] whitespace-nowrap">
                            {formatDateTime(tx.timestamp)}
                          </td>
                          <td className="px-4 py-2.5 font-mono">
                            <button
                              type="button"
                              onClick={() => onSelectAccount(tx.sender_upi)}
                              className="text-[#93C5FD] hover:underline text-left"
                            >
                              {tx.sender_upi}
                            </button>
                          </td>
                          <td className="px-4 py-2.5 font-mono">
                            <button
                              type="button"
                              onClick={() => onSelectAccount(tx.receiver_upi)}
                              className="text-[#F1F5F9] hover:text-[#3B82F6] hover:underline text-left"
                            >
                              {tx.receiver_upi}
                            </button>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums font-medium text-[#F1F5F9] whitespace-nowrap">
                            {formatINR(tx.amount)}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[11px] whitespace-nowrap">
                            <div className="text-[#94A3B8]">{tx.channel}</div>
                            <div
                              className={
                                tx.status === 'SUCCESS' ? 'text-[#22C55E]' : 'text-[#EF4444]'
                              }
                            >
                              {tx.status}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 max-w-[230px]">
                            <RiskIndicator score={tx.risk_score} />
                            {tx.suspicious_reason && (
                              <div className="text-[11px] text-[#94A3B8] truncate mt-0.5">
                                {tx.suspicious_reason}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap space-x-2">
                            {tx.linked_complaint_id && (
                              <button
                                type="button"
                                onClick={() => {
                                  setComplaintId(tx.linked_complaint_id!);
                                  switchSubTab('tracer');
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium bg-[#3B82F6]/15 hover:bg-[#3B82F6] text-[#93C5FD] hover:text-white border border-[#3B82F6]/30 transition-colors"
                              >
                                <GitBranch className="w-3 h-3" />
                                <span>Trace</span>
                              </button>
                            )}
                            {tx.cluster_id && !tx.linked_complaint_id && (
                              <button
                                type="button"
                                onClick={() => onSelectCluster(tx.cluster_id!)}
                                className="text-[11px] font-mono text-[#3B82F6] hover:underline"
                              >
                                {tx.cluster_id}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {txData.transactions.length > visibleLimit && (
                  <div className="px-5 py-3 bg-[#101827] border-t border-[#263449] flex items-center justify-between text-xs">
                    <span className="text-[#94A3B8] font-mono">
                      Showing {visibleLimit} of {txData.transactions.length.toLocaleString('en-IN')} matching transactions
                    </span>
                    <button
                      type="button"
                      onClick={() => setVisibleLimit((n) => n + 150)}
                      className="px-3 py-1.5 rounded-md bg-[#151F30] hover:bg-[#1E2B42] text-[#F1F5F9] border border-[#263449] font-medium"
                    >
                      Load More Rows
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 2: TRACE FUND MOVEMENT (MULTI-HOP FIFO TRACER)
         ===================================================================== */}
      {subTab === 'tracer' && (
        <div className="space-y-5">
          {/* Trace Parameters Card */}
          <div className="bg-[#151F30] border border-[#263449] rounded-md p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 items-end">
            <div className="xl:col-span-2">
              <label className="block text-[11px] font-medium text-[#94A3B8] mb-1.5">
                Reported Fraud Transaction (Starting Point)
              </label>
              <select
                value={complaintId}
                onChange={(e) => setComplaintId(e.target.value)}
                className="w-full bg-[#0B1120] border border-[#263449] focus:border-[#3B82F6] rounded-md px-3 py-2 text-xs text-[#F1F5F9] font-mono focus:outline-none"
              >
                {complaints.map((c) => (
                  <option key={c.complaint_id} value={c.complaint_id}>
                    {c.complaint_id} · {formatINR(c.amount)} → {c.receiver_upi}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#94A3B8] mb-1.5 flex items-center">
                <span>Maximum Hops (1–5)</span>
                <InfoTooltip text="Number of sequential account-to-account transfers to trace forward from the original payment." />
              </label>
              <div className="flex items-center gap-1 bg-[#0B1120] p-1 rounded-md border border-[#263449]">
                {[1, 2, 3, 4, 5].map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setMaxHops(h)}
                    className={`flex-1 py-1 text-xs font-mono rounded transition-colors ${
                      maxHops === h
                        ? 'bg-[#3B82F6] text-white font-semibold'
                        : 'text-[#94A3B8] hover:text-[#F1F5F9]'
                    }`}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#94A3B8] mb-1.5">
                Time Window After Payment
              </label>
              <select
                value={windowHours}
                onChange={(e) => setWindowHours(Number(e.target.value))}
                className="w-full bg-[#0B1120] border border-[#263449] rounded-md px-3 py-2 text-xs text-[#F1F5F9]"
              >
                {WINDOW_OPTIONS.map((w) => (
                  <option key={w.hours} value={w.hours}>
                    {w.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#94A3B8] mb-1.5">
                Min Transfer Amount (₹)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={traceMinAmount}
                  onChange={(e) => setTraceMinAmount(Math.max(0, Number(e.target.value)))}
                  className="w-full bg-[#0B1120] border border-[#263449] rounded-md px-3 py-2 text-xs font-mono text-[#F1F5F9]"
                />
                <button
                  type="button"
                  onClick={() => executeTrace(complaintId)}
                  className="p-2 rounded-md bg-[#3B82F6] hover:bg-blue-500 text-white shrink-0"
                  title="Run Trace"
                  aria-label="Run Trace"
                >
                  <Play className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Audit Visibility Row */}
            <div className="md:col-span-2 xl:col-span-5 pt-3 border-t border-[#263449] flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-4">
                <span className="text-[#94A3B8] font-medium">Audit Status Visibility:</span>
                {(['SUCCESS', 'FAILED', 'REVERSED', 'PENDING'] as TransactionStatus[]).map((st) => (
                  <label key={st} className="inline-flex items-center gap-1.5 text-[#F1F5F9] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={statuses.includes(st)}
                      disabled={st === 'SUCCESS'}
                      onChange={() => toggleStatus(st)}
                      className="accent-[#3B82F6]"
                    />
                    <span className="font-mono text-[11px]">{st}</span>
                  </label>
                ))}
              </div>
              <span className="text-[11px] text-[#64748B]">
                Only settled (SUCCESS) transfers are traced forward; failed/reversed attempts are shown for audit clarity only.
              </span>
            </div>
          </div>

          {traceLoading && (
            <div className="p-6 bg-[#151F30] border border-[#263449] rounded-md flex items-center gap-3 text-xs text-[#93C5FD]">
              <Loader2 className="w-4 h-4 animate-spin text-[#3B82F6]" />
              <span>Tracing forward money flow with conservative FIFO attribution...</span>
            </div>
          )}

          {traceError && (
            <div className="p-4 bg-[#EF4444]/10 border border-[#EF4444]/40 rounded-md text-xs text-red-200">
              {traceError}
            </div>
          )}

          {trace && !traceLoading && (
            <>
              {trace.warnings.length > 0 && (
                <div className="p-4 bg-[#EAB308]/10 border border-[#EAB308]/35 rounded-md space-y-1">
                  {trace.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-amber-200">
                      <AlertTriangle className="w-4 h-4 text-[#EAB308] shrink-0 mt-0.5" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* FIFO Attribution Summary Strip */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-[#151F30] border border-[#263449] rounded-md p-4">
                  <div className="text-xs text-[#94A3B8]">Original Reported Amount</div>
                  <div className="text-xl font-semibold font-mono tabular-nums text-[#F1F5F9] mt-1">
                    {formatINR(trace.original_amount)}
                  </div>
                  <div className="text-[11px] text-[#64748B] font-mono mt-1">
                    {trace.complaint.reported_transaction_id} · {trace.complaint.utr}
                  </div>
                </div>

                <div className="bg-[#151F30] border border-[#263449] rounded-md p-4">
                  <div className="text-xs text-[#94A3B8]">Observed Onward Transfers</div>
                  <div className="text-xl font-semibold font-mono tabular-nums text-[#3B82F6] mt-1">
                    {formatINR(trace.total_outgoing_observed)}
                  </div>
                  <div className="text-[11px] text-[#64748B] mt-1">
                    Across {Math.max(0, trace.edges.filter((e) => e.status === 'SUCCESS').length - 1)} downstream transfer(s)
                  </div>
                </div>

                <div className="bg-[#151F30] border border-[#263449] rounded-md p-4">
                  <div className="text-xs text-[#94A3B8] flex items-center">
                    <span>Potentially Attributed (FIFO)</span>
                    <InfoTooltip text="Conservative First-In, First-Out estimate capping attributed outflows to the incoming complaint amount. When other unrelated inflows exist, attribution is marked as estimated mixed funds." />
                  </div>
                  <div className="text-xl font-semibold font-mono tabular-nums text-[#22C55E] mt-1">
                    {formatINR(trace.total_potentially_attributed)}
                  </div>
                  <div className="text-[11px] mt-1 text-[#EAB308]">
                    {trace.mixed_funds_detected
                      ? 'Estimated · Mixed funds present'
                      : 'Direct FIFO chronological match'}
                  </div>
                </div>

                <div className="bg-[#151F30] border border-[#263449] rounded-md p-4">
                  <div className="text-xs text-[#94A3B8]">Untraced Remainder</div>
                  <div className="text-xl font-semibold font-mono tabular-nums text-[#F1F5F9] mt-1">
                    {formatINR(trace.untraced_amount)}
                  </div>
                  <div className="text-[11px] text-[#64748B] mt-1">
                    Retained, withdrawn, or outside window
                  </div>
                </div>
              </div>

              {/* Detected Patterns */}
              {trace.patterns.length > 0 && (
                <div className="bg-[#151F30] border border-[#263449] rounded-md p-4">
                  <div className="text-xs font-semibold text-[#F1F5F9] mb-2.5 flex items-center gap-2">
                    <GitBranch className="w-3.5 h-3.5 text-[#3B82F6]" />
                    <span>Detected Money-Movement Patterns</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {trace.patterns.map((pat) => (
                      <div
                        key={pat.code}
                        className="bg-[#101827] border border-[#263449] rounded p-3 text-xs"
                      >
                        <div
                          className={`font-semibold ${
                            pat.code === 'CIRCULAR_FLOW' ? 'text-[#EF4444]' : 'text-[#3B82F6]'
                          }`}
                        >
                          {pat.label}
                        </div>
                        <p className="text-[#94A3B8] text-[11px] mt-1 leading-relaxed">{pat.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Branching Left-to-Right SVG Flow Diagram */}
              {layeredDiagram && trace.edges.length > 0 && (
                <div className="bg-[#151F30] border border-[#263449] rounded-md overflow-hidden">
                  <div className="px-5 py-3.5 bg-[#101827] border-b border-[#263449] flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-[#F1F5F9]">
                        Step-by-Step Multi-Hop Branching Diagram (Color-Coded Edge Latencies)
                      </h2>
                      <p className="text-xs text-[#94A3B8] mt-0.5">
                        Reads left to right across hops with inter-hop latency badges. Click any account box to inspect its profile &amp; RBI SOP timeline.
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
                  <div className="overflow-x-auto bg-[#0B1120] p-4">
                    <svg
                      width={layeredDiagram.svgWidth}
                      height={layeredDiagram.svgHeight}
                      className="block"
                    >
                      <defs>
                        <marker id="trace-arrow-red" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                          <path d="M 0 1 L 10 5 L 0 9 z" fill="#EF4444" />
                        </marker>
                        <marker id="trace-arrow-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                          <path d="M 0 1 L 10 5 L 0 9 z" fill="#F59E0B" />
                        </marker>
                        <marker id="trace-arrow-sky" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                          <path d="M 0 1 L 10 5 L 0 9 z" fill="#38BDF8" />
                        </marker>
                        <marker id="trace-arrow-teal" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                          <path d="M 0 1 L 10 5 L 0 9 z" fill="#14B8A6" />
                        </marker>
                        <marker id="trace-arrow-muted" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                          <path d="M 0 1 L 10 5 L 0 9 z" fill="#64748B" />
                        </marker>
                      </defs>

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

                      {trace.edges.map((edge) => {
                        const from = layeredDiagram.pos.get(edge.sender_upi);
                        const to = layeredDiagram.pos.get(edge.receiver_upi);
                        if (!from || !to) return null;
                        const x1 = from.x + 160;
                        const y1 = from.y;
                        const x2 = to.x;
                        const y2 = to.y;
                        const isBack = to.hop <= from.hop;
                        const style = getTraceLatencyStyle(
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
                              strokeDasharray={
                                edge.status !== 'SUCCESS' || edge.is_circular ? '5 3' : undefined
                              }
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

                      {[...layeredDiagram.pos.entries()].map(([acct, coord]) => {
                        const isVictim = coord.hop === 0;
                        const borderColor = isVictim
                          ? '#38BDF8'
                          : coord.hop === 1
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
                              fill="#151F30"
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
                <div className="bg-[#151F30] border border-[#263449] rounded-md overflow-hidden">
                  <div className="px-5 py-3.5 bg-[#101827] border-b border-[#263449] flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Scale className="w-4 h-4 text-teal-400" />
                      <div>
                        <h2 className="text-sm font-semibold text-[#F1F5F9]">
                          Multi-Hop Precision Lien Attribution ({trace.account_lien_allocations.length} recipient accounts)
                        </h2>
                        <p className="text-[11px] text-[#94A3B8]">
                          Deterministic RBI SOP earmarks: Held = min(Tainted Inbound, Account Balance, Victim Deficit)
                        </p>
                      </div>
                    </div>
                    <span className="font-mono text-[11px] text-emerald-400">
                      Zero Blanket Freezes · Clean Funds Protected
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#0B1120] text-[#94A3B8] border-b border-[#263449]">
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
                      <tbody className="divide-y divide-[#263449]">
                        {trace.account_lien_allocations.map((alloc) => {
                          const cbsRef = appliedAccountIds[alloc.accountId];
                          return (
                            <tr key={alloc.accountId} className="hover:bg-[#19253A]">
                              <td className="px-4 py-2.5 font-mono">
                                <button
                                  type="button"
                                  onClick={() => onSelectAccount(alloc.accountId)}
                                  className="text-[#93C5FD] hover:underline font-medium"
                                >
                                  {alloc.accountId}
                                </button>
                              </td>
                              <td className="px-4 py-2.5 font-mono text-[#CBD5E1]">
                                H{alloc.hopDepth}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[#E2E8F0]">
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
                                    className="text-[11px] text-[#93C5FD] hover:underline"
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

              {/* Traced Sequence Table */}
              <div className="bg-[#151F30] border border-[#263449] rounded-md overflow-hidden">
                <div className="px-5 py-3.5 bg-[#101827] border-b border-[#263449]">
                  <h2 className="text-sm font-semibold text-[#F1F5F9]">
                    Chronological Transfer Sequence ({trace.timeline.length})
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#101827] text-[#94A3B8] border-b border-[#263449]">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Hop Badge</th>
                        <th className="px-4 py-2.5 font-medium">Timestamp &amp; Hop Latency</th>
                        <th className="px-4 py-2.5 font-medium">Transaction ID / Ref</th>
                        <th className="px-4 py-2.5 font-medium">Sender → Receiver</th>
                        <th className="px-4 py-2.5 font-medium text-right">Amount</th>
                        <th className="px-4 py-2.5 font-medium text-right">FIFO Estimate</th>
                        <th className="px-4 py-2.5 font-medium">Attribution Basis</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#263449]">
                      {trace.timeline.map((edge) => {
                        const latStyle = getTraceLatencyStyle(
                          edge.hop,
                          edge.minutes_since_prev_inflow,
                          edge.status,
                          edge.is_circular,
                        );
                        return (
                        <tr key={edge.transaction_id} className="hover:bg-[#19253A]">
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
                              <span className="ml-1.5 text-[#EF4444] font-sans font-semibold">
                                (Loop)
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-[11px] text-[#94A3B8] whitespace-nowrap">
                            <div>{formatDateTime(edge.timestamp)}</div>
                            <div style={{ color: latStyle.textColor }}>
                              {edge.hop === 1
                                ? 'Origin T+0m'
                                : `+${edge.minutes_since_prev_inflow}m hop (${latStyle.tierLabel})`}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[11px] whitespace-nowrap">
                            <div className="text-[#F1F5F9]">{edge.transaction_id}</div>
                            <div className="text-[#64748B]">{edge.utr}</div>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[11px]">
                            <button
                              type="button"
                              onClick={() => onSelectAccount(edge.sender_upi)}
                              className="text-[#93C5FD] hover:underline"
                            >
                              {edge.sender_upi}
                            </button>
                            <span className="text-[#64748B] mx-1.5">→</span>
                            <button
                              type="button"
                              onClick={() => onSelectAccount(edge.receiver_upi)}
                              className="text-[#F1F5F9] hover:text-[#3B82F6] hover:underline"
                            >
                              {edge.receiver_upi}
                            </button>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[#F1F5F9] font-medium">
                            {formatINR(edge.amount)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[#22C55E] font-medium">
                            {edge.status === 'SUCCESS'
                              ? formatINR(edge.potentially_attributed_amount)
                              : '₹0'}
                          </td>
                          <td className="px-4 py-2.5 text-[11px]">
                            {edge.attribution_status === 'DIRECT_FIFO' ? (
                              <span className="text-[#22C55E]">Direct FIFO</span>
                            ) : edge.attribution_status === 'ESTIMATED_MIXED_FUNDS' ? (
                              <span className="text-[#EAB308]">Estimated (Mixed Funds)</span>
                            ) : (
                              <span className="text-[#64748B]">Excluded (Non-Settled)</span>
                            )}
                          </td>
                          <td
                            className={`px-4 py-2.5 font-mono text-[11px] ${
                              edge.status === 'SUCCESS' ? 'text-[#22C55E]' : 'text-[#EF4444]'
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

              {/* Assumptions Note */}
              <div className="bg-[#151F30] border border-[#263449] rounded-md p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#F1F5F9] mb-2">
                  <Info className="w-3.5 h-3.5 text-[#3B82F6]" />
                  <span>Money Attribution Methodology &amp; Evidentiary Limits</span>
                </div>
                <ul className="list-disc pl-5 space-y-1 text-xs text-[#94A3B8]">
                  {trace.attribution_assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
