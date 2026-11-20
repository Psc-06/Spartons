import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  Clock,
  Plus,
  Upload,
} from 'lucide-react';
import type {
  AlertItem,
  DashboardSummary,
  DatasetMetadata,
  InvestigationCase,
} from '../shared/types';
import { formatDateTime, formatINR, formatShortINR } from '../lib/api';
import { InfoTooltip } from '../components/UiPrimitives';

export interface ChecklistProgress {
  reviewedData: boolean;
  exploredNetwork: boolean;
  tracedFunds: boolean;
  inspectedAccount: boolean;
  previewedReport: boolean;
}

interface OverviewViewProps {
  summary: DashboardSummary | null;
  datasets: DatasetMetadata[];
  cases: InvestigationCase[];
  alerts: AlertItem[];
  totalTransactionVolume: number;
  checklist: ChecklistProgress;
  loading: boolean;
  onOpenUpload: () => void;
  onCreateInvestigation: () => void;
  onSelectCase: (caseId: string) => void;
  onSelectAccount: (upiId: string) => void;
  onSelectCluster: (clusterId: string) => void;
  onGoToTransactions: () => void;
  onGoToNetwork: () => void;
  onGoToTracing: () => void;
  onGoToAccounts: () => void;
  onGoToReports: () => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  summary,
  datasets,
  cases,
  alerts,
  totalTransactionVolume,
  checklist,
  loading,
  onOpenUpload,
  onCreateInvestigation,
  onSelectCase,
  onSelectAccount,
  onSelectCluster,
  onGoToTransactions,
  onGoToNetwork,
  onGoToTracing,
  onGoToAccounts,
  onGoToReports,
}) => {
  if (loading || !summary) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-12 bg-[#151F30] border border-[#263449] rounded-md" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 bg-[#151F30] border border-[#263449] rounded-md" />
          ))}
        </div>
        <div className="h-64 bg-[#151F30] border border-[#263449] rounded-md" />
      </div>
    );
  }

  const activeCasesCount = cases.filter((c) => c.status !== 'CLOSED').length;
  const suspiciousAccountsCount =
    (summary.risk_distribution.find((r) => r.category === 'HIGH')?.count ?? 0) +
    (summary.risk_distribution.find((r) => r.category === 'MEDIUM')?.count ?? 0);

  // Compile Recent Activity cleanly from real case audit trails
  const recentActivity = cases
    .flatMap((c) =>
      c.audit_log.map((entry) => ({
        ...entry,
        case_id: c.case_id,
        case_title: c.title,
      })),
    )
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 7);

  const checklistSteps = [
    {
      step: 1,
      title: 'Review or upload transaction data',
      description: '50 sample UPI fraud complaints & 1,300+ ledger transfers are loaded—or drop your own CSV/XLSX file.',
      done: checklist.reviewedData,
      actionLabel: 'View Transactions',
      onAction: onGoToTransactions,
    },
    {
      step: 2,
      title: 'Explore the interactive money-flow network',
      description: 'See how separate victim complaints connect through shared intermediaries and exit accounts.',
      done: checklist.exploredNetwork,
      actionLabel: 'Open Network Explorer',
      onAction: onGoToNetwork,
    },
    {
      step: 3,
      title: 'Trace suspicious funds hop-by-hop',
      description: 'Follow money forward from any reported payment with conservative FIFO attribution.',
      done: checklist.tracedFunds,
      actionLabel: 'Trace Funds',
      onAction: onGoToTracing,
    },
    {
      step: 4,
      title: 'Inspect flagged mule-like accounts',
      description: 'Review plain-English risk indicators, rapid pass-through rates, and supporting UTRs.',
      done: checklist.inspectedAccount,
      actionLabel: 'Review Accounts',
      onAction: onGoToAccounts,
    },
    {
      step: 5,
      title: 'Generate a preliminary evidence report',
      description: 'Export a print-ready PDF dossier and supporting CSV files for case review.',
      done: checklist.previewedReport,
      actionLabel: 'Open Reports',
      onAction: onGoToReports,
    },
  ];

  const completedSteps = checklistSteps.filter((s) => s.done).length;

  const metrics = [
    {
      label: 'Total Investigations',
      value: String(cases.length),
      sub: `${summary.kpis.total_complaints} complaints analyzed`,
    },
    {
      label: 'Active Investigations',
      value: String(activeCasesCount),
      sub: `${summary.kpis.suspicious_network_clusters} linked clusters`,
    },
    {
      label: 'Files Analyzed',
      value: String(datasets.length * 2),
      sub: `${summary.dataset.transaction_count.toLocaleString('en-IN')} ledger rows`,
    },
    {
      label: 'Suspicious Accounts',
      value: String(suspiciousAccountsCount),
      sub: `${summary.kpis.high_priority_accounts} high-priority review`,
      highlight: 'text-[#F97316]',
      tooltip: 'Accounts flagged with Medium, High, or Critical behavioral indicators requiring analyst verification.',
    },
    {
      label: 'Transaction Value Analyzed',
      value: formatShortINR(totalTransactionVolume || summary.kpis.total_reported_amount),
      sub: `${formatShortINR(summary.kpis.total_reported_amount)} reported fraud`,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Clean Operational Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-[#263449]">
        <div>
          <h1 className="text-xl font-semibold text-[#F1F5F9] tracking-tight">
            Investigation Overview
          </h1>
          <p className="text-xs text-[#94A3B8] mt-1">
            Operational command center for active financial crime cases, flagged mule networks, and transaction analysis.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onOpenUpload}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium bg-[#151F30] hover:bg-[#1E2B42] text-[#F1F5F9] border border-[#263449] transition-colors whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5 text-[#3B82F6]" />
            <span>Upload CSV / XLSX</span>
          </button>
          <button
            type="button"
            onClick={onCreateInvestigation}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold bg-[#3B82F6] hover:bg-blue-500 text-white transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Investigation</span>
          </button>
        </div>
      </div>

      {/* 5 Compact Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="bg-[#151F30] border border-[#263449] rounded-md p-4"
          >
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

      {/* Quick-Start Investigation Checklist + High-Priority Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick-Start Investigation Checklist */}
        <section className="lg:col-span-2 bg-[#151F30] border border-[#263449] rounded-md overflow-hidden">
          <div className="px-5 py-4 border-b border-[#263449] flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-[#F1F5F9]">
                Quick-Start Investigation Guide
              </h2>
              <p className="text-xs text-[#94A3B8] mt-0.5">
                Follow these 5 steps to uncover connected mule accounts and build an evidence report.
              </p>
            </div>
            <span className="font-mono text-xs text-[#3B82F6] font-medium shrink-0">
              {completedSteps}/5 completed
            </span>
          </div>

          <div className="divide-y divide-[#263449]">
            {checklistSteps.map((item) => (
              <div
                key={item.step}
                className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-[#19253A] transition-colors"
              >
                <div className="flex items-start gap-3 min-w-0">
                  {item.done ? (
                    <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="w-4 h-4 text-[#475569] shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[#F1F5F9]">
                      {item.step}. {item.title}
                    </div>
                    <p className="text-xs text-[#94A3B8] mt-0.5">{item.description}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={item.onAction}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-[#101827] hover:bg-[#3B82F6] text-[#F1F5F9] border border-[#263449] hover:border-[#3B82F6] transition-colors whitespace-nowrap shrink-0"
                >
                  <span>{item.actionLabel}</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* High-Priority Investigation Alerts */}
        <section className="bg-[#151F30] border border-[#263449] rounded-md overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-[#263449] flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[#F1F5F9]">High-Priority Alerts</h2>
              <p className="text-xs text-[#94A3B8] mt-0.5">
                Top networks &amp; accounts requiring review
              </p>
            </div>
            <AlertTriangle className="w-4 h-4 text-[#F97316]" />
          </div>
          <div className="divide-y divide-[#263449] flex-1 overflow-y-auto max-h-[380px]">
            {alerts.slice(0, 6).map((al) => (
              <button
                key={al.id}
                type="button"
                onClick={() => {
                  if (al.account_id) onSelectAccount(al.account_id);
                  else if (al.cluster_id) onSelectCluster(al.cluster_id);
                }}
                className="w-full text-left px-5 py-3.5 hover:bg-[#19253A] transition-colors"
              >
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span
                    className={`font-semibold ${
                      al.severity === 'HIGH' ? 'text-[#EF4444]' : 'text-[#EAB308]'
                    }`}
                  >
                    {al.severity === 'HIGH' ? 'High Priority' : 'Medium Priority'}
                  </span>
                  <span className="font-mono text-[#94A3B8]">{al.metric}</span>
                </div>
                <div className="text-xs font-medium text-[#F1F5F9] mt-1">{al.title}</div>
                <div className="text-[11px] text-[#94A3B8] mt-0.5 line-clamp-2">
                  {al.description}
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* Recent Investigations + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Investigations Table */}
        <section className="lg:col-span-2 bg-[#151F30] border border-[#263449] rounded-md overflow-hidden">
          <div className="px-5 py-4 border-b border-[#263449] flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[#F1F5F9]">Recent Investigations</h2>
              <p className="text-xs text-[#94A3B8] mt-0.5">
                Click any case to open its workspace, evidence, and report builder
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#101827] text-[#94A3B8] border-b border-[#263449]">
                <tr>
                  <th className="px-4 py-3 font-medium">Case ID</th>
                  <th className="px-4 py-3 font-medium">Investigation Name</th>
                  <th className="px-4 py-3 font-medium">Assigned Investigator</th>
                  <th className="px-4 py-3 font-medium text-right">Exposure</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#263449]">
                {cases.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-[#94A3B8]">
                      No investigations created yet. Click &ldquo;New Investigation&rdquo; to start a case.
                    </td>
                  </tr>
                ) : (
                  cases.slice(0, 6).map((inv) => (
                    <tr
                      key={inv.case_id}
                      onClick={() => onSelectCase(inv.case_id)}
                      className="hover:bg-[#19253A] cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-[#3B82F6] font-medium whitespace-nowrap">
                        {inv.case_id}
                      </td>
                      <td className="px-4 py-3 text-[#F1F5F9] font-medium">{inv.title}</td>
                      <td className="px-4 py-3 text-[#94A3B8] whitespace-nowrap">{inv.assignee}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-[#F1F5F9] whitespace-nowrap">
                        {formatINR(inv.total_reported_amount)}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-[#94A3B8] whitespace-nowrap">
                        {inv.status.replace(/_/g, ' ')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Recent Activity Feed */}
        <section className="bg-[#151F30] border border-[#263449] rounded-md overflow-hidden">
          <div className="px-5 py-4 border-b border-[#263449] flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[#F1F5F9]">Recent Activity</h2>
              <p className="text-xs text-[#94A3B8] mt-0.5">Latest investigator actions</p>
            </div>
            <Clock className="w-4 h-4 text-[#64748B]" />
          </div>
          <div className="divide-y divide-[#263449] max-h-[340px] overflow-y-auto">
            {recentActivity.length === 0 ? (
              <div className="p-5 text-xs text-[#94A3B8]">No recent case activity recorded.</div>
            ) : (
              recentActivity.map((act) => (
                <div key={act.id} className="px-5 py-3 text-xs">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-[#64748B]">
                    <span className="font-mono text-[#3B82F6]">{act.case_id}</span>
                    <span className="font-mono">{formatDateTime(act.timestamp)}</span>
                  </div>
                  <div className="text-[#F1F5F9] mt-1 leading-snug">{act.details}</div>
                  <div className="text-[11px] text-[#94A3B8] mt-0.5">By {act.actor}</div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
