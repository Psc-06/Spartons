import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  ArrowLeft,
  Briefcase,
  CheckCircle2,
  Clock,
  FileCheck2,
  FileText,
  GitBranch,
  Loader2,
  Lock,
  Network,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Unlock,
  UserCheck,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  AccountProfile,
  DisputeDocumentType,
  LienResolutionReport,
  MatchedComplaint,
  NetworkCluster,
  PrecisionLienCalculation,
  RbiSopStepNumber,
  TransactionRecord,
} from '../shared/types';
import {
  accountStatusTextColor,
  api,
  formatDate,
  formatDateTime,
  formatINR,
  riskTextColor,
  roleDisplayLabel,
} from '../lib/api';

interface AccountDetailViewProps {
  datasetId: string;
  upiId: string;
  onBack: () => void;
  onSelectAccount: (upiId: string) => void;
  onTraceComplaint: (complaintId: string) => void;
  onSelectCluster: (clusterId: string) => void;
  onCreateCaseFromAccount: (account: AccountProfile) => void;
  onAskAiAboutAccount: (upiId: string) => void;
  onAccountUpdated?: (message?: string) => void;
}

const RBI_DRAFT_PDF_URL =
  '/assets/aistudio/DRAFT11092026FD8132390DB514C7487703CBF7A704007_9b571436.pdf';

const RBI_OFFICIAL_SOP_STEPS: {
  step: RbiSopStepNumber;
  title: string;
  windowLabel: string;
  legalNote: string;
}[] = [
  {
    step: 1,
    title: 'Temporary Debit Hold',
    windowLabel: 'Immediate · ≥ ₹1,000',
    legalNote: 'Precision lien on suspected amount; full freeze strictly last resort.',
  },
  {
    step: 2,
    title: 'Notify Account Holder',
    windowLabel: 'Day 0 – EOD Next Day',
    legalNote: 'Digital/physical notice with hold reasons & Nodal Officer details.',
  },
  {
    step: 3,
    title: 'Customer Explanation',
    windowLabel: 'Days 1–20 Statutory',
    legalNote: '20-day window for customer documentary justification.',
  },
  {
    step: 4,
    title: 'Bank Review / NCRP',
    windowLabel: 'Days 21–30 (10d Review)',
    legalNote: 'Remove hold OR refer to Jurisdictional Police via NCRP-CFCFRMS.',
  },
  {
    step: 5,
    title: 'LEA Review Window',
    windowLabel: 'Days 31–60 (30d LEA)',
    legalNote: 'Wait up to 30 days from LEA reference for formal seizure order.',
  },
  {
    step: 6,
    title: 'Auto-Release Breaker',
    windowLabel: 'Day 61 Mandatory',
    legalNote: 'Automatic hold removal if no statutory LEA order is received.',
  },
];

function resolveActiveSopStep(account: AccountProfile): RbiSopStepNumber {
  if (account.rbiSopStep) return account.rbiSopStep;
  const stage = account.rbiSopClock?.stage;
  switch (stage) {
    case 'Day 0: Notice Sent':
      return 2;
    case 'Days 1-20: Customer Dispute Window':
      return 3;
    case 'Days 21-30: Nodal Review':
      return 4;
    case 'Days 31-60: LEA Escalation':
      return 5;
    case 'Resolved / Released':
      return 6;
    default:
      return 1;
  }
}

export const AccountDetailView: React.FC<AccountDetailViewProps> = ({
  datasetId,
  upiId,
  onBack,
  onSelectAccount,
  onTraceComplaint,
  onSelectCluster,
  onCreateCaseFromAccount,
  onAskAiAboutAccount,
  onAccountUpdated,
}) => {
  const [data, setData] = useState<{
    account: AccountProfile;
    transactions: TransactionRecord[];
    linked_complaints: MatchedComplaint[];
    neighbor_accounts: AccountProfile[];
    cluster: NetworkCluster | null;
    precision_lien_preview: PrecisionLienCalculation | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Precision Lien Calculator & Action state
  const [selectedComplaintId, setSelectedComplaintId] = useState<string>('');
  const [lienCalc, setLienCalc] = useState<PrecisionLienCalculation | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<'PRECISION_LIEN' | 'FULL_FREEZE' | 'DISPUTE' | 'RELEASE' | 'CONFIRM_FREEZE' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resolutionReport, setResolutionReport] = useState<LienResolutionReport | null>(null);

  // Customer Dispute Proof simulation form
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [gstin, setGstin] = useState('');
  const [counterpartyName, setCounterpartyName] = useState('');
  const [documentType, setDocumentType] = useState<DisputeDocumentType>('GST Tax Invoice');
  const [claimedAmount, setClaimedAmount] = useState<number>(0);
  const [referencedUtr, setReferencedUtr] = useState('');

  // Nodal Officer Resolution inputs
  const [officerName, setOfficerName] = useState('Nodal Officer Insp. R. Deshmukh');
  const [officerRemarks, setOfficerRemarks] = useState('');
  const [showRbiPdfModal, setShowRbiPdfModal] = useState(false);

  const loadAccount = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAccountDetail(upiId, datasetId);
      setData(res);
      const defaultCid =
        res.account.lienDetails?.complaintId ??
        res.linked_complaints[0]?.complaint_id ??
        '';
      setSelectedComplaintId(defaultCid);
      setLienCalc(res.precision_lien_preview);
      setResolutionReport(null);
      setActionError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load account.');
    } finally {
      setLoading(false);
    }
  }, [upiId, datasetId]);

  useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  const incomingSuccessTxs = useMemo(() => {
    if (!data) return [];
    return data.transactions.filter(
      (t) => t.receiver_upi === data.account.upi_id && t.status === 'SUCCESS',
    );
  }, [data]);

  const handleComplaintChange = async (newComplaintId: string) => {
    setSelectedComplaintId(newComplaintId);
    if (!newComplaintId) {
      setLienCalc(null);
      return;
    }
    setCalcLoading(true);
    setActionError(null);
    try {
      const calc = await api.calculatePrecisionLien(upiId, {
        complaintId: newComplaintId,
        datasetId,
      });
      setLienCalc(calc);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to calculate precision lien.');
    } finally {
      setCalcLoading(false);
    }
  };

  const handleApplyLien = async (mode: 'PRECISION_LIEN' | 'FULL_FREEZE') => {
    const cid = selectedComplaintId || data?.linked_complaints[0]?.complaint_id;
    if (!cid) {
      setActionError('Select a linked fraud complaint before executing a hold.');
      return;
    }
    setActionBusy(mode);
    setActionError(null);
    try {
      const res = await api.applyPrecisionLien(upiId, {
        complaintId: cid,
        datasetId,
        mode,
      });
      setData((prev) => (prev ? { ...prev, account: res.account } : prev));
      setLienCalc(res.calculation);
      setResolutionReport(null);
      onAccountUpdated?.(
        mode === 'PRECISION_LIEN'
          ? `Executed Precision Lien of ${formatINR(res.account.precisionLienHold)} on ${upiId}; ${formatINR(res.account.usableCleanBalance)} remains usable.`
          : `Applied legacy Full Account Freeze on ${upiId}.`,
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to execute lien action.');
    } finally {
      setActionBusy(null);
    }
  };

  const applyDisputePreset = (variant: 'LEGITIMATE' | 'SUSPICIOUS') => {
    if (!data) return;
    const heldAmt = data.account.precisionLienHold || lienCalc?.heldAmount || 15000;
    const matchedUtr =
      lienCalc?.matchedUtrs?.[0] ||
      incomingSuccessTxs[0]?.utr ||
      'UTR202611100001';

    if (variant === 'LEGITIMATE') {
      setInvoiceNumber('INV-GST/26-27/8842');
      setGstin('27AABCM6412F1Z8');
      setCounterpartyName('Shree Balaji Wholesale & Logistics Pvt Ltd');
      setDocumentType('GST Tax Invoice');
      setClaimedAmount(heldAmt);
      setReferencedUtr(matchedUtr);
    } else {
      setInvoiceNumber('CASH-SLIP-004');
      setGstin('99FAKE000000Z0');
      setCounterpartyName('Unregistered Cash Broker');
      setDocumentType('Delivery Challan');
      setClaimedAmount(Math.round(heldAmt * 1.45));
      setReferencedUtr('UTR999999999999');
    }
    setActionError(null);
  };

  const handleSubmitDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceNumber.trim() || !gstin.trim() || !counterpartyName.trim() || !referencedUtr.trim()) {
      setActionError('Complete all documentary proof fields before submitting to AI verification.');
      return;
    }
    setActionBusy('DISPUTE');
    setActionError(null);
    try {
      const res = await api.submitDisputeProof(upiId, {
        datasetId,
        invoiceNumber: invoiceNumber.trim(),
        gstin: gstin.trim(),
        counterpartyName: counterpartyName.trim(),
        documentType,
        claimedAmount: Number(claimedAmount) || 0,
        referencedUtr: referencedUtr.trim(),
      });
      setData((prev) => (prev ? { ...prev, account: res.account } : prev));
      onAccountUpdated?.(
        `Dispute proof scored ${res.disputeSubmission.aiVerificationScore}/100 (${res.disputeSubmission.aiRecommendation}).`,
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to verify dispute proof.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleResolveLien = async (decision: 'RELEASE' | 'CONFIRM_FREEZE') => {
    setActionBusy(decision);
    setActionError(null);
    try {
      const defaultRemark =
        decision === 'RELEASE'
          ? 'Documentary commercial proof verified under RBI 60-Day Money Mule SOP; approving immediate CBS lien release.'
          : 'Documentary proof unverified / mule indicators confirmed; maintaining freeze and escalating dossier to LEA.';
      const res = await api.resolveLien(upiId, {
        datasetId,
        decision,
        officerName: officerName.trim() || 'Nodal Officer Insp. R. Deshmukh',
        remarks: officerRemarks.trim() || defaultRemark,
      });
      setData((prev) => (prev ? { ...prev, account: res.account } : prev));
      setResolutionReport(res.complianceReport);
      onAccountUpdated?.(
        decision === 'RELEASE'
          ? `Released precision lien on ${upiId}; full balance ${formatINR(res.account.usableCleanBalance)} restored.`
          : `Confirmed freeze and escalated ${upiId} to LEA.`,
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to resolve lien.');
    } finally {
      setActionBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="p-8 bg-[#0F172A] border border-[#1E2D45] rounded-md text-xs text-slate-400">
        Loading account investigation profile for {upiId}...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Accounts
        </button>
        <div className="p-6 bg-red-950/30 border border-red-500/40 rounded-md text-xs text-red-200">
          {error || 'Account record not found.'}
        </div>
      </div>
    );
  }

  const { account, transactions, linked_complaints, neighbor_accounts, cluster } = data;

  // Determine numbers to display in Precision Lien Action Card
  const isLienActive = account.accountStatus === 'Precision Lien Active';
  const isFullFreeze = account.accountStatus === 'Full Freeze';
  const displayedTainted =
    isLienActive && account.lienDetails
      ? account.lienDetails.taintedReceived
      : lienCalc?.taintedReceived ?? 0;
  const displayedHeld = isLienActive || isFullFreeze
    ? account.precisionLienHold
    : lienCalc?.heldAmount ?? 0;
  const displayedUsable = isLienActive || isFullFreeze
    ? account.usableCleanBalance
    : lienCalc?.usableCleanBalance ?? account.totalBalance;
  const heldPct =
    account.totalBalance > 0
      ? Math.min(100, Math.round((displayedHeld / account.totalBalance) * 100))
      : 0;
  const usablePct = Math.max(0, 100 - heldPct);

  const sopClock = account.rbiSopClock;
  const activeSopStep = resolveActiveSopStep(account);
  const dispute = sopClock?.disputeSubmission;
  const isResolved = sopClock?.stage === 'Resolved / Released';

  const baselineChartData = [
    ...(account.monthlyHistoricalTurnover ?? []).map((item) => ({
      label: item.month.replace(' 2026', ''),
      volume: item.volume,
      isSpike: false,
    })),
    {
      label: 'Peak 24h',
      volume: account.current24hCreditVolume ?? 0,
      isSpike: true,
    },
  ];
  const sixMonthAvg = account.sixMonthAvgMonthlyVolume ?? 0;
  const current24hVol = account.current24hCreditVolume ?? 0;
  const spikeRatio =
    sixMonthAvg > 0 ? Number((current24hVol / sixMonthAvg).toFixed(1)) : null;
  const baselineThreshold =
    account.occupation === 'Student'
      ? 100_000
      : sixMonthAvg < 5_000
      ? 50_000
      : Math.round(sixMonthAvg * 3.5);
  const hasVelocityRule = account.triggeredRules.some(
    (r) =>
      r.code === 'RULE_6M_HISTORICAL_VOL_SPIKE' ||
      r.code === 'RULE_STUDENT_TIER_OVERFLOW',
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-[#1E2D45]">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-sky-300 mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Suspicious Accounts</span>
          </button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold font-mono text-white">{account.upi_id}</h1>
            <span
              className={`font-mono text-sm font-bold tabular-nums ${riskTextColor(account.risk_category)}`}
            >
              Risk {account.risk_score}/100 ({account.risk_category})
            </span>
            <span className="text-slate-600" aria-hidden="true">|</span>
            <span className={`text-xs font-semibold ${accountStatusTextColor(account.accountStatus)}`}>
              Status: {account.accountStatus}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-1">
            <span>Role: {roleDisplayLabel(account.role)}</span>
            <span aria-hidden="true">·</span>
            <span>
              UPI Syntax: {account.upi_syntax_valid ? 'Valid format' : 'Non-standard syntax'} (independent of risk)
            </span>
            {cluster && (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => onSelectCluster(cluster.cluster_id)}
                  className="text-teal-400 hover:underline font-mono"
                >
                  Cluster {cluster.cluster_id} ({cluster.name})
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onAskAiAboutAccount(account.upi_id)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium bg-[#132038] hover:bg-[#1B2C4A] text-teal-300 border border-teal-500/30 whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Ask AI Why Flagged</span>
          </button>
          <button
            type="button"
            onClick={() => onCreateCaseFromAccount(account)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-slate-950 whitespace-nowrap"
          >
            <Briefcase className="w-3.5 h-3.5" />
            <span>CREATE INVESTIGATION CASE</span>
          </button>
        </div>
      </div>

      {/* Advisory Banner */}
      <div className="p-4 bg-[#0F172A] border border-[#1E2D45] rounded-md flex items-start gap-3 text-xs">
        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <div className="text-slate-100 font-medium">{account.explanation}</div>
          <div className="text-slate-400 mt-1">{account.investigative_advisory}</div>
        </div>
      </div>

      {/* DETERMINISTIC DETECTION RULES & 6-MONTH BASELINE ANOMALY PANEL */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Triggered Deterministic Detection Rules + KYC Profile */}
        <section className="xl:col-span-7 bg-[#0F172A] border border-[#1E2D45] rounded-md overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-[#1E2D45] bg-[#0B1222] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertOctagon className="w-4 h-4 text-red-400" />
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Triggered Deterministic Detection Rules ({account.triggeredRules.length})
                </h2>
                <p className="text-[11px] text-slate-400">
                  100% deterministic rule evaluation (zero LLM scoring) across KYC tier, 6-month baseline, multi-hop DAG, and lookalike VPA checks.
                </p>
              </div>
            </div>
            <span className="font-mono text-[11px] text-slate-400">
              {account.triggeredRules.length > 0
                ? `+${account.triggeredRules.reduce((s, r) => s + r.points, 0)} rule pts`
                : '0 rule triggers'}
            </span>
          </div>

          <div className="p-5 space-y-4 flex-1">
            {/* KYC Metadata Strip */}
            {(account.accountHolderName ||
              account.occupation ||
              account.age !== undefined ||
              account.accountAgeMonths !== undefined) && (
              <div className="bg-[#080E1A] border border-[#1E2D45] rounded p-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                <div className="inline-flex items-center gap-1.5 text-slate-300 font-medium">
                  <UserCheck className="w-3.5 h-3.5 text-sky-400" />
                  <span>{account.accountHolderName ?? 'KYC Record Attached'}</span>
                </div>
                {account.occupation && (
                  <div className="font-mono text-[11px] text-slate-400">
                    Occupation:{' '}
                    <span
                      className={
                        account.occupation === 'Student'
                          ? 'text-amber-300 font-semibold'
                          : 'text-slate-200'
                      }
                    >
                      {account.occupation}
                    </span>
                  </div>
                )}
                {account.age !== undefined && (
                  <div className="font-mono text-[11px] text-slate-400">
                    Age: <span className="text-slate-200">{account.age} yrs</span>
                  </div>
                )}
                {account.accountAgeMonths !== undefined && (
                  <div className="font-mono text-[11px] text-slate-400">
                    Tenure:{' '}
                    <span className="text-slate-200">{account.accountAgeMonths} months</span>
                  </div>
                )}
                {account.isNewlyRegisteredVpa && (
                  <div className="font-mono text-[11px] text-red-400 font-semibold">
                    Newly Registered VPA
                  </div>
                )}
              </div>
            )}

            {account.triggeredRules.length === 0 ? (
              <div className="bg-[#080E1A] border border-[#1E2D45] rounded p-4 text-xs text-slate-400">
                No advanced deterministic outlier rules triggered on this account (Student ₹1L Outlier, 6-Month Baseline Velocity Spike, 30m Multi-Hop Branching DAG, or Lookalike VPA Brand Impersonation). Standard 6-signal behavioural scoring applies.
              </div>
            ) : (
              <div className="space-y-3">
                {account.triggeredRules.map((rule) => (
                  <div
                    key={rule.code}
                    className={`bg-[#080E1A] border rounded p-3.5 space-y-1.5 ${
                      rule.severity === 'CRITICAL'
                        ? 'border-red-500/45'
                        : 'border-amber-500/40'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-white">
                          {rule.code}
                        </span>
                        <span className="text-slate-600" aria-hidden="true">|</span>
                        <span className="text-xs font-medium text-slate-200">
                          {rule.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums">
                        <span
                          className={
                            rule.severity === 'CRITICAL'
                              ? 'text-red-400 font-bold'
                              : 'text-amber-400 font-bold'
                          }
                        >
                          {rule.severity}
                        </span>
                        <span className="text-slate-600">·</span>
                        <span className="text-sky-300 font-semibold">+{rule.points} pts</span>
                      </div>
                    </div>
                    <div className="text-xs text-slate-200">{rule.reason}</div>
                    <div className="text-[11px] font-mono text-slate-400 pt-1 border-t border-[#172338]">
                      Evidence: {rule.metricSummary}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Recharts 6-Month Historical Baseline vs Current 24-Hour Spike Chart */}
        <section className="xl:col-span-5 bg-[#0F172A] border border-[#1E2D45] rounded-md overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-[#1E2D45] bg-[#0B1222] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-sky-400" />
              <div>
                <h2 className="text-sm font-semibold text-white">
                  6-Month Baseline vs. 24-Hour Spike
                </h2>
                <p className="text-[11px] text-slate-400">
                  Monthly historical turnover compared against peak 24h credit inflow
                </p>
              </div>
            </div>
            {spikeRatio !== null && (
              <span
                className={`font-mono text-xs font-bold tabular-nums ${
                  hasVelocityRule ? 'text-red-400' : 'text-teal-300'
                }`}
              >
                {spikeRatio}× baseline
              </span>
            )}
          </div>

          <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
            <div className="grid grid-cols-3 gap-2.5 text-xs">
              <div className="bg-[#080E1A] border border-[#1E2D45] rounded p-2.5">
                <div className="text-[10px] text-slate-400">6m Avg / Month</div>
                <div className="font-mono font-semibold tabular-nums text-slate-100 mt-0.5">
                  {formatINR(sixMonthAvg)}
                </div>
              </div>
              <div className="bg-[#080E1A] border border-[#1E2D45] rounded p-2.5">
                <div className="text-[10px] text-slate-400">Peak 24h Credits</div>
                <div
                  className={`font-mono font-semibold tabular-nums mt-0.5 ${
                    hasVelocityRule ? 'text-red-400' : 'text-sky-300'
                  }`}
                >
                  {formatINR(current24hVol)}
                </div>
              </div>
              <div className="bg-[#080E1A] border border-[#1E2D45] rounded p-2.5">
                <div className="text-[10px] text-slate-400">24h Credit Txns</div>
                <div className="font-mono font-semibold tabular-nums text-slate-100 mt-0.5">
                  {account.current24hCreditCount ?? 0} txns
                </div>
              </div>
            </div>

            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={baselineChartData}
                  margin={{ top: 10, right: 12, left: 4, bottom: 2 }}
                >
                  <CartesianGrid stroke="#172338" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#94A3B8', fontSize: 10, fontFamily: 'IBM Plex Mono' }}
                    axisLine={{ stroke: '#1E2D45' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'IBM Plex Mono' }}
                    axisLine={false}
                    tickLine={false}
                    width={54}
                    tickFormatter={(v: number) =>
                      v >= 100000
                        ? `₹${(v / 100000).toFixed(1)}L`
                        : v >= 1000
                        ? `₹${Math.round(v / 1000)}k`
                        : `₹${v}`
                    }
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(56, 189, 248, 0.08)' }}
                    contentStyle={{
                      backgroundColor: '#080E1A',
                      border: '1px solid #1E2D45',
                      borderRadius: 6,
                      fontSize: 11,
                      fontFamily: 'IBM Plex Mono, monospace',
                      color: '#F1F5F9',
                    }}
                    formatter={(value: unknown) => [formatINR(Number(value ?? 0)), 'Volume']}
                  />
                  {baselineThreshold > 0 && (
                    <ReferenceLine
                      y={baselineThreshold}
                      stroke="#F59E0B"
                      strokeDasharray="4 4"
                      label={{
                        value:
                          account.occupation === 'Student'
                            ? '₹1L Student Cap'
                            : sixMonthAvg < 5000
                            ? '₹50k Dormant Cap'
                            : '3.5× Avg Trigger',
                        position: 'insideTopRight',
                        fill: '#F59E0B',
                        fontSize: 10,
                        fontFamily: 'IBM Plex Mono',
                      }}
                    />
                  )}
                  <Bar dataKey="volume" radius={[3, 3, 0, 0]} maxBarSize={34}>
                    {baselineChartData.map((entry, idx) => (
                      <Cell
                        key={`cell-${idx}`}
                        fill={
                          entry.isSpike
                            ? hasVelocityRule
                              ? '#EF4444'
                              : '#38BDF8'
                            : '#334155'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      </div>

      {/* AUTOMATED PRECISION LIEN PROTOCOL ACTION CARD */}
      <section className="bg-[#0F172A] border border-[#1E2D45] rounded-md overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#1E2D45] flex flex-wrap items-center justify-between gap-3 bg-[#0B1222]">
          <div className="flex items-center gap-2">
            <Scale className="w-4 h-4 text-teal-400" />
            <div>
              <h2 className="text-sm font-semibold text-white">
                Automated Precision Lien Protocol (Deterministic FIFO Attribution)
              </h2>
              <p className="text-[11px] text-slate-400">
                Replaces blanket freezes with exact tainted-fund earmarking: Held = min(Tainted Inbound, Account Balance, Victim Deficit)
              </p>
            </div>
          </div>

          {linked_complaints.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-slate-400">Attribution Complaint:</label>
              <select
                value={selectedComplaintId}
                onChange={(e) => handleComplaintChange(e.target.value)}
                disabled={calcLoading}
                className="bg-[#080E1A] border border-[#1E2D45] rounded px-2.5 py-1 text-xs font-mono text-slate-100 focus:outline-none focus:border-sky-500"
              >
                {linked_complaints.map((c) => (
                  <option key={c.complaint_id} value={c.complaint_id}>
                    {c.complaint_id} ({formatINR(c.amount)})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="p-5 space-y-5">
          {actionError && (
            <div className="p-3 bg-red-950/35 border border-red-500/40 rounded text-xs text-red-200">
              {actionError}
            </div>
          )}

          {/* 4-Column Deterministic Balance Breakdown */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[#080E1A] border border-[#1E2D45] rounded p-3.5">
              <div className="text-[11px] text-slate-400">Total Account Balance</div>
              <div className="text-lg font-bold font-mono tabular-nums text-white mt-1">
                {formatINR(account.totalBalance)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                CBS Ledger Balance
              </div>
            </div>

            <div className="bg-[#080E1A] border border-[#1E2D45] rounded p-3.5">
              <div className="text-[11px] text-slate-400">Tainted Trail Inbound</div>
              <div className="text-lg font-bold font-mono tabular-nums text-sky-300 mt-1">
                {calcLoading ? 'Calculating...' : formatINR(displayedTainted)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                {account.lienDetails?.complaintId || selectedComplaintId
                  ? `${account.lienDetails?.complaintId || selectedComplaintId}${
                      lienCalc && lienCalc.hopDepth > 0 ? ` · Hop ${lienCalc.hopDepth}` : ''
                    }`
                  : 'No linked complaint trail'}
              </div>
            </div>

            <div className="bg-[#080E1A] border border-amber-500/35 rounded p-3.5">
              <div className="text-[11px] text-amber-300 font-medium">
                {isFullFreeze ? 'Full Freeze Hold [LOCKED]' : 'Calculated Precision Lien [HELD]'}
              </div>
              <div className="text-lg font-bold font-mono tabular-nums text-amber-400 mt-1">
                {formatINR(displayedHeld)}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                {isLienActive
                  ? `Active CBS Lien · ${heldPct}% of balance`
                  : isFullFreeze
                  ? '100% Legacy Blanket Freeze'
                  : `Proposed Hold · ${heldPct}% of balance`}
              </div>
            </div>

            <div className="bg-[#080E1A] border border-emerald-500/35 rounded p-3.5">
              <div className="text-[11px] text-emerald-300 font-medium">
                Protected Free Balance [USABLE]
              </div>
              <div className="text-lg font-bold font-mono tabular-nums text-emerald-400 mt-1">
                {formatINR(displayedUsable)}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                {usablePct}% remains operational
              </div>
            </div>
          </div>

          {/* Visual Proportion Bar */}
          <div>
            <div className="flex items-center justify-between text-[11px] font-mono mb-1.5">
              <span className="text-amber-300">
                HELD / LIEN: {formatINR(displayedHeld)} ({heldPct}%)
              </span>
              <span className="text-emerald-300">
                CLEAN / USABLE: {formatINR(displayedUsable)} ({usablePct}%)
              </span>
            </div>
            <div className="h-2.5 w-full bg-[#080E1A] border border-[#1E2D45] rounded overflow-hidden flex">
              <div
                className={isFullFreeze ? 'bg-red-500 h-full' : 'bg-amber-500 h-full'}
                style={{ width: `${heldPct}%` }}
              />
              <div
                className="bg-emerald-500 h-full"
                style={{ width: `${usablePct}%` }}
              />
            </div>
          </div>

          {/* Deterministic Formula & CBS Reference */}
          <div className="pt-3 border-t border-[#1E2D45] flex flex-wrap items-start justify-between gap-4 text-xs">
            <div className="space-y-1 max-w-2xl">
              <div className="font-mono text-[11px] text-slate-300">
                {lienCalc
                  ? lienCalc.formulaSummary
                  : account.lienDetails
                  ? `Active CBS Reference: ${account.lienDetails.cbsReferenceId} · Applied ${formatDateTime(account.lienDetails.appliedAt)}`
                  : 'No settled stolen-fund path reaches this account.'}
              </div>
              <div className="text-slate-400">
                {account.lienDetails?.reason || lienCalc?.explanation || 'Deterministic FIFO check complete.'}
              </div>
              {account.lienDetails && (
                <div className="font-mono text-[11px] text-teal-300">
                  CBS Lien Ref: {account.lienDetails.cbsReferenceId} · Complaint: {account.lienDetails.complaintId}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={
                  actionBusy !== null ||
                  !selectedComplaintId ||
                  (lienCalc !== null && lienCalc.heldAmount <= 0)
                }
                onClick={() => handleApplyLien('PRECISION_LIEN')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold bg-teal-500 hover:bg-teal-400 disabled:opacity-45 disabled:cursor-not-allowed text-slate-950 whitespace-nowrap"
              >
                {actionBusy === 'PRECISION_LIEN' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5" />
                )}
                <span>
                  {isLienActive
                    ? 'Update Precision Lien (RBI SOP)'
                    : 'Execute Precision Lien (RBI SOP)'}
                </span>
              </button>
              <button
                type="button"
                disabled={actionBusy !== null || !selectedComplaintId}
                onClick={() => handleApplyLien('FULL_FREEZE')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium bg-red-950/40 hover:bg-red-900/50 disabled:opacity-45 disabled:cursor-not-allowed text-red-300 border border-red-500/40 whitespace-nowrap"
              >
                {actionBusy === 'FULL_FREEZE' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Lock className="w-3.5 h-3.5" />
                )}
                <span>Full Account Freeze (Legacy)</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* OFFICIAL 6-STEP RBI MONEY MULE SOP STATUTORY STEPPER & DISPUTE CONSOLE */}
      <section className="bg-[#0F172A] border border-[#1E2D45] rounded-md overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#1E2D45] flex flex-wrap items-center justify-between gap-3 bg-[#0B1222]">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-sky-400" />
            <div>
              <h2 className="text-sm font-semibold text-white">
                RBI Money Mule SOP Statutory Workflow (Annex III · Effective April 1, 2027)
              </h2>
              <p className="text-[11px] text-slate-400">
                6-Step statutory compliance clock for suspected transactions ≥ ₹1,000: Hold → Day 0 Notice → 20d Customer Window → 10d Bank/NCRP Review → 30d LEA Window → Day 61 Auto-Release.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {sopClock && (
              <div className="font-mono text-xs text-amber-300 tabular-nums">
                Step {activeSopStep}/6 · Day {sopClock.dayCount} of 60 · {sopClock.stage}
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowRbiPdfModal(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium bg-[#132038] hover:bg-[#1B2C4A] text-sky-300 border border-sky-500/35 whitespace-nowrap"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>RBI Draft Annex III PDF</span>
            </button>
          </div>
        </div>

        {!sopClock ? (
          <div className="p-5 text-xs text-slate-400">
            No RBI Money Mule SOP statutory clock is currently running for <span className="font-mono text-slate-200">{account.upi_id}</span>. Execute a Precision Lien (Temporary Debit Hold ≥ ₹1,000) above to initialize Step 1–6 statutory tracking and the Day 61 automatic release circuit breaker.
          </div>
        ) : (
          <div className="p-5 space-y-6">
            {/* Temporary Debit Hold & Statutory Deadlines Telemetry Strip */}
            {account.temporaryDebitHold && account.statutoryDeadlines && (
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 bg-[#080E1A] border border-[#1E2D45] rounded p-3.5 text-xs">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Hold Reference</div>
                  <div className="font-mono text-teal-300 font-semibold mt-0.5">
                    {account.temporaryDebitHold.cbsRef}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {account.temporaryDebitHold.isAccountLevel
                      ? 'Account-Level (Last Resort)'
                      : 'Precision Lien (Suspected Amt)'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Explanation Due (D+20)</div>
                  <div className="font-mono text-slate-100 mt-0.5">
                    {formatDate(account.statutoryDeadlines.customerExplanationDue)}
                  </div>
                  <div className="text-[11px] text-slate-500">Step 3 Deadline</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Bank / NCRP Due (D+30)</div>
                  <div className="font-mono text-slate-100 mt-0.5">
                    {formatDate(account.statutoryDeadlines.bankReviewDue)}
                  </div>
                  <div className="text-[11px] text-slate-500">Step 4 Deadline</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">LEA Order Due (D+60)</div>
                  <div className="font-mono text-amber-300 mt-0.5">
                    {formatDate(account.statutoryDeadlines.leaResponseDue)}
                  </div>
                  <div className="text-[11px] text-slate-500">Step 5 Deadline</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Circuit Breaker (D+61)</div>
                  <div className="font-mono text-emerald-400 font-semibold mt-0.5">
                    {formatDate(account.statutoryDeadlines.maxHoldExpiry)}
                  </div>
                  <div className="text-[11px] text-slate-500">Auto-Release Mandate</div>
                </div>
              </div>
            )}

            {/* Official 6-Step RBI Money Mule SOP Timeline */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-2.5">
              {RBI_OFFICIAL_SOP_STEPS.map((st) => {
                const isCurrent = st.step === activeSopStep && !isResolved;
                const isDone = st.step < activeSopStep || isResolved;
                const deadlines = account.statutoryDeadlines;
                const dateMeta =
                  st.step === 1
                    ? `Hold: ${formatDate(account.temporaryDebitHold?.timestamp ?? sopClock.noticeSentAt)}`
                    : st.step === 2
                    ? `Notice: ${formatDate(sopClock.noticeSentAt)}`
                    : st.step === 3
                    ? `Due: ${formatDate(deadlines?.customerExplanationDue ?? sopClock.customerResponseDeadline)}`
                    : st.step === 4
                    ? `Due: ${formatDate(deadlines?.bankReviewDue ?? sopClock.nodalReviewDeadline)}`
                    : st.step === 5
                    ? `LEA Due: ${formatDate(deadlines?.leaResponseDue ?? sopClock.autoExpiryDeadline)}`
                    : `Auto-Lift: ${formatDate(deadlines?.maxHoldExpiry ?? sopClock.autoExpiryDeadline)}`;

                return (
                  <div
                    key={st.step}
                    className={`p-3 rounded border flex flex-col justify-between ${
                      isCurrent
                        ? 'bg-[#132038] border-sky-400/70'
                        : isDone
                        ? 'bg-[#080E1A] border-emerald-500/35'
                        : 'bg-[#080E1A] border-[#1E2D45]'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between text-[10px] font-mono">
                        <span
                          className={
                            isCurrent
                              ? 'text-sky-300 font-bold'
                              : isDone
                              ? 'text-emerald-400 font-semibold'
                              : 'text-slate-500'
                          }
                        >
                          STEP {st.step} · {isDone ? 'DONE' : isCurrent ? 'ACTIVE' : 'QUEUED'}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-white mt-1.5 leading-snug">
                        {st.title}
                      </div>
                      <div className="text-[11px] font-mono text-sky-300/90 mt-0.5">
                        {st.windowLabel}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1.5 leading-snug">
                        {st.legalNote}
                      </div>
                    </div>
                    <div className="text-[10px] font-mono text-slate-300 mt-2.5 pt-2 border-t border-[#172338]">
                      {dateMeta}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Dispute Proof Inspection + Simulation Console */}
            <div className="pt-4 border-t border-[#1E2D45] grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left: Submitted Customer Proof & AI Verification Assessment */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <FileCheck2 className="w-3.5 h-3.5 text-teal-400" />
                    <span>Customer Dispute Proof &amp; Gemini AI Audit</span>
                  </h3>
                </div>

                {dispute ? (
                  <div className="bg-[#080E1A] border border-[#1E2D45] rounded p-4 space-y-3 text-xs">
                    <div className="grid grid-cols-2 gap-3 pb-3 border-b border-[#172338]">
                      <div>
                        <div className="text-[11px] text-slate-500">Document &amp; Invoice #</div>
                        <div className="font-mono text-white mt-0.5">
                          {dispute.invoiceNumber}
                        </div>
                        <div className="text-[11px] text-slate-400">{dispute.documentType}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500">GSTIN &amp; Counterparty</div>
                        <div className="font-mono text-sky-300 mt-0.5">{dispute.gstin}</div>
                        <div className="text-[11px] text-slate-300">{dispute.counterpartyName}</div>
                      </div>
                      {dispute.claimedAmount !== undefined && (
                        <div>
                          <div className="text-[11px] text-slate-500">Claimed Amount</div>
                          <div className="font-mono tabular-nums text-white mt-0.5">
                            {formatINR(dispute.claimedAmount)}
                          </div>
                        </div>
                      )}
                      {dispute.referencedUtr && (
                        <div>
                          <div className="text-[11px] text-slate-500">Referenced UTR</div>
                          <div className="font-mono text-slate-200 mt-0.5">
                            {dispute.referencedUtr}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-slate-400 mr-2">AI Verification Score:</span>
                        <span
                          className={`font-mono font-bold tabular-nums text-sm ${
                            dispute.aiVerificationScore >= 75
                              ? 'text-emerald-400'
                              : dispute.aiVerificationScore >= 45
                              ? 'text-amber-400'
                              : 'text-red-400'
                          }`}
                        >
                          {dispute.aiVerificationScore}/100
                        </span>
                      </div>
                      <div
                        className={`font-mono text-xs font-semibold ${
                          dispute.aiRecommendation === 'RELEASE_LIEN'
                            ? 'text-emerald-400'
                            : dispute.aiRecommendation === 'MAINTAIN_LIEN'
                            ? 'text-amber-400'
                            : 'text-red-400'
                        }`}
                      >
                        AI Recommendation: {dispute.aiRecommendation.replace(/_/g, ' ')}
                      </div>
                    </div>

                    <p className="text-slate-300 leading-relaxed">{dispute.aiReasoning}</p>
                    <div className="text-[11px] text-slate-500">
                      Submitted {formatDateTime(dispute.submittedAt)} · AI score is advisory only; final lien release or escalation requires Nodal Officer authorization.
                    </div>
                  </div>
                ) : (
                  <div className="bg-[#080E1A] border border-[#1E2D45] rounded p-4 text-xs text-slate-400">
                    Awaiting customer documentary submission (GST Tax Invoice, Delivery Challan, or Commercial Contract) within the 20-day RBI dispute window. Use the right-hand simulator to ingest proof and run real-time Gemini verification against the held UTR.
                  </div>
                )}

                {/* Nodal Officer 1-Click Resolution Console */}
                {sopClock.stage !== 'Resolved / Released' && (
                  <div className="bg-[#080E1A] border border-[#1E2D45] rounded p-4 space-y-3">
                    <div className="text-xs font-semibold text-white">
                      Nodal Officer Statutory Resolution Decision
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">
                          Authorizing Nodal Officer
                        </label>
                        <input
                          type="text"
                          value={officerName}
                          onChange={(e) => setOfficerName(e.target.value)}
                          className="w-full bg-[#0F172A] border border-[#1E2D45] rounded px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">
                          Audit Remarks (Optional)
                        </label>
                        <input
                          type="text"
                          value={officerRemarks}
                          onChange={(e) => setOfficerRemarks(e.target.value)}
                          placeholder="e.g. Verified GST invoice against UTR"
                          className="w-full bg-[#0F172A] border border-[#1E2D45] rounded px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5 pt-1">
                      <button
                        type="button"
                        disabled={actionBusy !== null}
                        onClick={() => handleResolveLien('RELEASE')}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950"
                      >
                        {actionBusy === 'RELEASE' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Unlock className="w-3.5 h-3.5" />
                        )}
                        <span>
                          Approve &amp; Release {formatINR(account.precisionLienHold)} Lien
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={actionBusy !== null}
                        onClick={() => handleResolveLien('CONFIRM_FREEZE')}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium bg-red-950/45 hover:bg-red-900/60 disabled:opacity-50 text-red-200 border border-red-500/45"
                      >
                        {actionBusy === 'CONFIRM_FREEZE' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Lock className="w-3.5 h-3.5" />
                        )}
                        <span>Confirm Freeze &amp; Escalate to LEA</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Final Statutory Compliance Report after resolution */}
                {resolutionReport && (
                  <div className="bg-emerald-950/20 border border-emerald-500/40 rounded p-4 space-y-2 text-xs">
                    <div className="flex items-center gap-2 font-semibold text-emerald-300">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>
                        Statutory Compliance Resolution Recorded ({resolutionReport.resolutionId})
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 font-mono text-[11px] text-slate-300">
                      <div>CBS Ref: {resolutionReport.cbsReferenceId}</div>
                      <div>Decision: {resolutionReport.decision}</div>
                      <div>Released: {formatINR(resolutionReport.releasedAmount)}</div>
                      <div>Final Usable: {formatINR(resolutionReport.finalUsableCleanBalance)}</div>
                    </div>
                    <p className="text-slate-300">{resolutionReport.statutoryComplianceNote}</p>
                  </div>
                )}
              </div>

              {/* Right: Interactive "Simulate Customer Dispute Ingestion" Panel */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Simulate Customer Dispute Ingestion
                  </h3>
                  {isLienActive && (
                    <div className="flex items-center gap-2 text-[11px]">
                      <button
                        type="button"
                        onClick={() => applyDisputePreset('LEGITIMATE')}
                        className="text-emerald-400 hover:underline font-medium"
                      >
                        Load Valid GST Preset
                      </button>
                      <span className="text-slate-600">·</span>
                      <button
                        type="button"
                        onClick={() => applyDisputePreset('SUSPICIOUS')}
                        className="text-red-400 hover:underline font-medium"
                      >
                        Load Mismatched Preset
                      </button>
                    </div>
                  )}
                </div>

                {!isLienActive ? (
                  <div className="bg-[#080E1A] border border-[#1E2D45] rounded p-4 text-xs text-slate-400">
                    Customer dispute ingestion is enabled while an account is in <span className="text-amber-300 font-medium">Precision Lien Active</span> state.
                  </div>
                ) : (
                  <form
                    onSubmit={handleSubmitDispute}
                    className="bg-[#080E1A] border border-[#1E2D45] rounded p-4 space-y-3 text-xs"
                  >
                    <p className="text-[11px] text-slate-400">
                      Ingest customer commercial proof (GST Tax Invoice, Delivery Challan, or Commercial Contract). Gemini cross-checks GSTIN syntax, amount parity against held funds ({formatINR(account.precisionLienHold)}), and UTR match.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">
                          Document Type
                        </label>
                        <select
                          value={documentType}
                          onChange={(e) => setDocumentType(e.target.value as DisputeDocumentType)}
                          className="w-full bg-[#0F172A] border border-[#1E2D45] rounded px-2.5 py-1.5 text-xs text-slate-100"
                        >
                          <option value="GST Tax Invoice">GST Tax Invoice</option>
                          <option value="Delivery Challan">Delivery Challan</option>
                          <option value="Commercial Contract">Commercial Contract</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">
                          Invoice / Document Number
                        </label>
                        <input
                          type="text"
                          value={invoiceNumber}
                          onChange={(e) => setInvoiceNumber(e.target.value)}
                          placeholder="INV-GST/26-27/8842"
                          className="w-full bg-[#0F172A] border border-[#1E2D45] rounded px-2.5 py-1.5 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">
                          15-Char GSTIN
                        </label>
                        <input
                          type="text"
                          value={gstin}
                          onChange={(e) => setGstin(e.target.value)}
                          placeholder="27AABCM6412F1Z8"
                          className="w-full bg-[#0F172A] border border-[#1E2D45] rounded px-2.5 py-1.5 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">
                          Counterparty Business Name
                        </label>
                        <input
                          type="text"
                          value={counterpartyName}
                          onChange={(e) => setCounterpartyName(e.target.value)}
                          placeholder="Shree Balaji Wholesale Pvt Ltd"
                          className="w-full bg-[#0F172A] border border-[#1E2D45] rounded px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">
                          Claimed Invoice Amount (₹)
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={claimedAmount || ''}
                          onChange={(e) => setClaimedAmount(Number(e.target.value))}
                          placeholder={String(account.precisionLienHold)}
                          className="w-full bg-[#0F172A] border border-[#1E2D45] rounded px-2.5 py-1.5 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">
                          Referenced UPI UTR
                        </label>
                        <input
                          type="text"
                          value={referencedUtr}
                          onChange={(e) => setReferencedUtr(e.target.value)}
                          placeholder={lienCalc?.matchedUtrs?.[0] || 'UTR...'}
                          className="w-full bg-[#0F172A] border border-[#1E2D45] rounded px-2.5 py-1.5 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                        />
                      </div>
                    </div>

                    <div className="pt-1 flex items-center justify-between gap-3">
                      <span className="text-[11px] text-slate-500 font-mono">
                        Held UTRs: {(lienCalc?.matchedUtrs ?? []).slice(0, 2).join(', ') || 'Ledger lookup'}
                      </span>
                      <button
                        type="submit"
                        disabled={actionBusy !== null}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 whitespace-nowrap"
                      >
                        {actionBusy === 'DISPUTE' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" />
                        )}
                        <span>Run Gemini Proof Verification</span>
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Metrics Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: 'Connected Complaints', value: String(account.connected_complaints.length) },
          { label: 'Incoming Volume', value: formatINR(account.total_incoming_amount), sub: `${account.incoming_count} settled txns` },
          { label: 'Outgoing Volume', value: formatINR(account.total_outgoing_amount), sub: `${account.outgoing_count} settled txns` },
          { label: 'Unique Senders', value: String(account.unique_senders), sub: 'Fan-in count' },
          { label: 'Unique Recipients', value: String(account.unique_recipients), sub: 'Fan-out count' },
          { label: 'Rapid Pass-Through', value: `${account.rapid_pass_through_pct}%`, sub: `Peak ${account.velocity_1h_max}/h · ${account.velocity_24h_max}/24h` },
        ].map((m) => (
          <div key={m.label} className="bg-[#0F172A] border border-[#1E2D45] rounded-md p-3.5">
            <div className="text-[11px] text-slate-400">{m.label}</div>
            <div className="text-lg font-bold font-mono tabular-nums text-white mt-1">
              {m.value}
            </div>
            {m.sub && <div className="text-[11px] text-slate-500 font-mono mt-0.5">{m.sub}</div>}
          </div>
        ))}
      </div>

      {/* Detection Signals + Linked Accounts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 6-Signal Explainable Risk Breakdown */}
        <div className="lg:col-span-2 bg-[#0F172A] border border-[#1E2D45] rounded-md p-5">
          <h2 className="text-sm font-semibold text-white">
            Explainable Risk Signal Breakdown
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Configurable prototype weights (total 0–100). Each component is computed deterministically from observed ledger records.
          </p>
          <div className="mt-4 space-y-3.5">
            {account.signals.map((sig) => {
              const pct = sig.maxScore > 0 ? Math.round((sig.score / sig.maxScore) * 100) : 0;
              return (
                <div key={sig.key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-200">{sig.label}</span>
                    <span className="font-mono tabular-nums text-slate-300">
                      <span className="text-slate-400 mr-2">{sig.metricValue}</span>
                      <span className="font-semibold text-white">
                        {sig.score} / {sig.maxScore}
                      </span>
                    </span>
                  </div>
                  <div className="h-2 bg-[#080E1A] rounded overflow-hidden border border-[#1E2D45]">
                    <div
                      className={`h-full ${
                        pct >= 75 ? 'bg-red-500' : pct >= 45 ? 'bg-amber-500' : 'bg-teal-500'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-slate-500">{sig.description}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Linked Account Network + Supporting References */}
        <div className="bg-[#0F172A] border border-[#1E2D45] rounded-md p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Linked Account Network</h2>
              {cluster && (
                <button
                  type="button"
                  onClick={() => onSelectCluster(cluster.cluster_id)}
                  className="inline-flex items-center gap-1 text-[11px] text-teal-400 hover:underline"
                >
                  <Network className="w-3 h-3" />
                  <span>View Graph</span>
                </button>
              )}
            </div>
            <div className="mt-3 max-h-60 overflow-y-auto divide-y divide-[#172338]">
              {neighbor_accounts.length === 0 ? (
                <div className="text-xs text-slate-400 py-2">No counterparty accounts found.</div>
              ) : (
                neighbor_accounts.map((nb) => (
                  <button
                    key={nb.upi_id}
                    type="button"
                    onClick={() => onSelectAccount(nb.upi_id)}
                    className="w-full py-2 flex items-center justify-between text-left hover:bg-[#142036] px-2 rounded"
                  >
                    <span className="font-mono text-xs text-sky-300 truncate">{nb.upi_id}</span>
                    <span className={`font-mono text-[11px] shrink-0 ml-2 ${riskTextColor(nb.risk_category)}`}>
                      {nb.risk_score} · {roleDisplayLabel(nb.role)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-[#1E2D45]">
            <div className="text-xs font-semibold text-slate-300 mb-1.5">
              Supporting Transaction References ({account.supporting_transaction_ids.length})
            </div>
            <div className="font-mono text-[11px] text-slate-400 max-h-24 overflow-y-auto leading-relaxed">
              {account.supporting_transaction_ids.join(' · ') || 'None'}
            </div>
          </div>
        </div>
      </div>

      {/* Related Complaints */}
      {linked_complaints.length > 0 && (
        <div className="bg-[#0F172A] border border-[#1E2D45] rounded-md overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#1E2D45]">
            <h2 className="text-sm font-semibold text-white">
              Related Fraud Complaints ({linked_complaints.length})
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0B1222] text-slate-400 border-b border-[#1E2D45]">
                <tr>
                  <th className="px-4 py-2 font-medium">Complaint ID</th>
                  <th className="px-4 py-2 font-medium">Victim Ref</th>
                  <th className="px-4 py-2 font-medium">Initial Receiver</th>
                  <th className="px-4 py-2 font-medium text-right">Amount</th>
                  <th className="px-4 py-2 font-medium">UTR</th>
                  <th className="px-4 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#172338]">
                {linked_complaints.map((c) => (
                  <tr key={c.complaint_id} className="hover:bg-[#142036]">
                    <td className="px-4 py-2 font-mono text-sky-300">{c.complaint_id}</td>
                    <td className="px-4 py-2 font-mono text-slate-300">{c.victim_reference}</td>
                    <td className="px-4 py-2 font-mono text-slate-200">{c.receiver_upi}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-white">
                      {formatINR(c.amount)}
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px] text-slate-400">{c.utr}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => onTraceComplaint(c.complaint_id)}
                        className="inline-flex items-center gap-1 text-[11px] text-teal-400 hover:underline"
                      >
                        <GitBranch className="w-3 h-3" /> Trace Path
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Chronological Transaction Timeline */}
      <div className="bg-[#0F172A] border border-[#1E2D45] rounded-md overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#1E2D45]">
          <h2 className="text-sm font-semibold text-white">
            Account Transaction Timeline ({transactions.length} records)
          </h2>
        </div>
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#0B1222] text-slate-400 border-b border-[#1E2D45] sticky top-0">
              <tr>
                <th className="px-4 py-2.5 font-medium">Timestamp</th>
                <th className="px-4 py-2.5 font-medium">Direction</th>
                <th className="px-4 py-2.5 font-medium">Counterparty UPI</th>
                <th className="px-4 py-2.5 font-medium text-right">Amount</th>
                <th className="px-4 py-2.5 font-medium">Transaction ID / UTR</th>
                <th className="px-4 py-2.5 font-medium">Channel</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#172338]">
              {transactions.map((tx) => {
                const isIncoming = tx.receiver_upi === account.upi_id;
                const counterparty = isIncoming ? tx.sender_upi : tx.receiver_upi;
                return (
                  <tr key={tx.transaction_id} className="hover:bg-[#142036]">
                    <td className="px-4 py-2 font-mono tabular-nums text-[11px] text-slate-400 whitespace-nowrap">
                      {formatDateTime(tx.timestamp)}
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px] whitespace-nowrap">
                      <span className={isIncoming ? 'text-emerald-400' : 'text-amber-400'}>
                        {isIncoming ? 'INCOMING' : 'OUTGOING'}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono">
                      <button
                        type="button"
                        onClick={() => onSelectAccount(counterparty)}
                        className="text-sky-300 hover:underline"
                      >
                        {counterparty}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-white font-medium">
                      {formatINR(tx.amount)}
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                      {tx.transaction_id} · {tx.utr}
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px] text-slate-400">{tx.channel}</td>
                    <td
                      className={`px-4 py-2 font-mono text-[11px] ${
                        tx.status === 'SUCCESS' ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {tx.status}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inline Official RBI Draft Directions Annex III PDF Viewer Modal */}
      {showRbiPdfModal && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          onClick={() => setShowRbiPdfModal(false)}
        >
          <div
            className="bg-[#0F172A] border border-[#1E2D45] rounded-md w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-[#1E2D45] bg-[#0B1222] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-sky-400" />
                <div>
                  <div className="text-sm font-semibold text-white">
                    RBI Draft KYC Amendment Directions, 2026 — Annex III (Money Mule SOP)
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Official Standard Operating Procedure on Suspected Money Mule Accounts (Effective April 1, 2027)
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowRbiPdfModal(false)}
                className="p-1.5 rounded bg-[#131F33] hover:bg-[#1B2B45] text-slate-300 border border-[#243652]"
                aria-label="Close PDF viewer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <iframe
              src={RBI_DRAFT_PDF_URL}
              title="RBI Draft Amendment Directions 2026 Annex III"
              className="w-full flex-1 bg-white"
            />
          </div>
        </div>
      )}
    </div>
  );
};

