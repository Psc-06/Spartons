import React, { useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import type { AccountProfile, AccountStatus } from '../shared/types';
import {
  accountStatusTextColor,
  downloadCsvFile,
  formatINR,
  riskTextColor,
  roleDisplayLabel,
} from '../lib/api';

interface SuspiciousAccountsViewProps {
  accounts: AccountProfile[];
  loading: boolean;
  onSelectAccount: (upiId: string) => void;
}

export const SuspiciousAccountsView: React.FC<SuspiciousAccountsViewProps> = ({
  accounts,
  loading,
  onSelectAccount,
}) => {
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<string>('ALL');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | AccountStatus>('ALL');
  const [onlyRuleTriggered, setOnlyRuleTriggered] = useState(false);

  const lienSummary = useMemo(() => {
    const activeLiens = accounts.filter((a) => a.accountStatus === 'Precision Lien Active');
    const fullFreezes = accounts.filter((a) => a.accountStatus === 'Full Freeze');
    const ruleTriggeredCount = accounts.filter((a) => (a.triggeredRules?.length ?? 0) > 0).length;
    const totalHeld = accounts.reduce((acc, a) => acc + (a.precisionLienHold || 0), 0);
    const totalProtected = activeLiens.reduce((acc, a) => acc + (a.usableCleanBalance || 0), 0);
    return {
      activeLienCount: activeLiens.length,
      fullFreezeCount: fullFreezes.length,
      ruleTriggeredCount,
      totalHeld,
      totalProtected,
    };
  }, [accounts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (riskFilter !== 'ALL' && a.risk_category !== riskFilter) return false;
      if (roleFilter !== 'ALL' && a.role !== roleFilter) return false;
      if (statusFilter !== 'ALL' && a.accountStatus !== statusFilter) return false;
      if (onlyRuleTriggered && (a.triggeredRules?.length ?? 0) === 0) return false;
      if (q) {
        const ruleMatch = (a.triggeredRules ?? []).some(
          (r) => r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q),
        );
        return (
          a.upi_id.toLowerCase().includes(q) ||
          (a.accountHolderName && a.accountHolderName.toLowerCase().includes(q)) ||
          (a.cluster_id && a.cluster_id.toLowerCase().includes(q)) ||
          a.accountStatus.toLowerCase().includes(q) ||
          a.explanation.toLowerCase().includes(q) ||
          ruleMatch
        );
      }
      return true;
    });
  }, [accounts, search, riskFilter, roleFilter, statusFilter, onlyRuleTriggered]);

  const handleExportCsv = () => {
    downloadCsvFile(
      'muleshield_accounts_risk_assessment.csv',
      [
        'upi_id',
        'role',
        'account_status',
        'total_balance_inr',
        'precision_lien_hold_inr',
        'usable_clean_balance_inr',
        'rbi_sop_stage',
        'risk_score',
        'risk_category',
        'connected_complaints',
        'rapid_pass_through_pct',
        'unique_senders',
        'unique_recipients',
        'velocity_1h_max',
        'velocity_24h_max',
        'has_circular_pattern',
        'cluster_id',
        'explanation',
      ],
      filtered.map((a) => [
        a.upi_id,
        a.role,
        a.accountStatus,
        a.totalBalance,
        a.precisionLienHold,
        a.usableCleanBalance,
        a.rbiSopClock?.stage ?? '',
        a.risk_score,
        a.risk_category,
        a.connected_complaints.length,
        a.rapid_pass_through_pct,
        a.unique_senders,
        a.unique_recipients,
        a.velocity_1h_max,
        a.velocity_24h_max,
        a.has_circular_pattern,
        a.cluster_id ?? '',
        a.explanation,
      ]),
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-4 border-b border-[#1E2D45]">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            Suspicious Accounts &amp; Precision Lien Registry
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Deterministic 0–100 behavioural scoring paired with RBI 60-Day Money Mule SOP precision lien holds and protected usable balances.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportCsv}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-[#131F33] hover:bg-[#1B2B45] text-slate-200 border border-[#243652]"
        >
          <Download className="w-3.5 h-3.5 text-sky-400" />
          <span>Export Accounts CSV</span>
        </button>
      </div>

      {/* Precision Lien Protocol Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#0F172A] border border-[#1E2D45] rounded-md p-3.5">
          <div className="text-[11px] text-slate-400">Active Precision Liens (RBI SOP)</div>
          <div className="text-lg font-bold font-mono tabular-nums text-amber-400 mt-1">
            {lienSummary.activeLienCount}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {lienSummary.fullFreezeCount} legacy full freeze(s)
          </div>
        </div>
        <div className="bg-[#0F172A] border border-[#1E2D45] rounded-md p-3.5">
          <div className="text-[11px] text-slate-400">Total Disputed Funds Held</div>
          <div className="text-lg font-bold font-mono tabular-nums text-white mt-1">
            {formatINR(lienSummary.totalHeld)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Deterministic FIFO lien earmark
          </div>
        </div>
        <div className="bg-[#0F172A] border border-[#1E2D45] rounded-md p-3.5">
          <div className="text-[11px] text-slate-400">Protected Clean Balance</div>
          <div className="text-lg font-bold font-mono tabular-nums text-emerald-400 mt-1">
            {formatINR(lienSummary.totalProtected)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Unfrozen for legitimate merchant ops
          </div>
        </div>
        <div className="bg-[#0F172A] border border-[#1E2D45] rounded-md p-3.5 flex flex-col justify-between gap-2">
          <div className="text-[11px] text-slate-400">Quick Inspection Queues</div>
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() =>
                setStatusFilter((prev) =>
                  prev === 'Precision Lien Active' ? 'ALL' : 'Precision Lien Active',
                )
              }
              className={`w-full py-1 px-2.5 rounded text-[11px] font-medium border transition-colors ${
                statusFilter === 'Precision Lien Active'
                  ? 'bg-amber-500/20 border-amber-400/50 text-amber-300'
                  : 'bg-[#080E1A] border-[#1E2D45] text-sky-300 hover:border-sky-500/50'
              }`}
            >
              {statusFilter === 'Precision Lien Active'
                ? 'Showing RBI SOP Active Liens'
                : 'Filter RBI SOP Active Liens'}
            </button>
            <button
              type="button"
              onClick={() => setOnlyRuleTriggered((v) => !v)}
              className={`w-full py-1 px-2.5 rounded text-[11px] font-medium border transition-colors ${
                onlyRuleTriggered
                  ? 'bg-red-500/20 border-red-400/50 text-red-300'
                  : 'bg-[#080E1A] border-[#1E2D45] text-slate-300 hover:border-red-500/45'
              }`}
            >
              {onlyRuleTriggered
                ? `Rule Triggers Only (${lienSummary.ruleTriggeredCount})`
                : `Filter 4 Deterministic Rules (${lienSummary.ruleTriggeredCount})`}
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 bg-[#0F172A] border border-[#1E2D45] rounded-md p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by UPI ID, cluster ID, status, or flagged signal..."
            className="w-full bg-[#080E1A] border border-[#1E2D45] focus:border-sky-500 rounded-md pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 bg-[#080E1A] p-1 rounded-md border border-[#1E2D45]">
          {['ALL', 'HIGH', 'MEDIUM', 'LOW'].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRiskFilter(r)}
              className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                riskFilter === r
                  ? 'bg-[#172742] text-sky-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <select
          aria-label="Filter by account status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'ALL' | AccountStatus)}
          className="bg-[#080E1A] border border-[#1E2D45] rounded-md px-3 py-1.5 text-xs text-slate-200"
        >
          <option value="ALL">All Lien Statuses</option>
          <option value="Precision Lien Active">Precision Lien Active</option>
          <option value="Under Investigation">Under Investigation</option>
          <option value="Full Freeze">Full Freeze</option>
          <option value="Active">Active</option>
        </select>

        <select
          aria-label="Filter by account role"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="bg-[#080E1A] border border-[#1E2D45] rounded-md px-3 py-1.5 text-xs text-slate-200"
        >
          <option value="ALL">All Roles</option>
          <option value="INITIAL_RECIPIENT">Initial Recipients</option>
          <option value="INTERMEDIARY">Intermediaries</option>
          <option value="DOWNSTREAM">Downstream</option>
          <option value="CONTROL">Unlinked Controls</option>
        </select>
      </div>

      {/* Accounts Table */}
      <div className="bg-[#0F172A] border border-[#1E2D45] rounded-md overflow-hidden">
        {loading ? (
          <div className="p-6 text-xs text-slate-400">Scoring accounts...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            No accounts match the selected filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0B1222] text-slate-400 border-b border-[#1E2D45]">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Account UPI ID</th>
                  <th className="px-4 py-2.5 font-medium">Lien Status / RBI SOP</th>
                  <th className="px-4 py-2.5 font-medium text-right">Lien Hold / Clean Bal</th>
                  <th className="px-4 py-2.5 font-medium text-right">Risk Score</th>
                  <th className="px-4 py-2.5 font-medium text-right">Complaints</th>
                  <th className="px-4 py-2.5 font-medium text-right">Pass-Through</th>
                  <th className="px-4 py-2.5 font-medium">Investigative Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#172338]">
                {filtered.map((acct) => (
                  <tr
                    key={acct.upi_id}
                    onClick={() => onSelectAccount(acct.upi_id)}
                    className="hover:bg-[#142036] cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="font-mono text-sky-300 font-medium">
                        {acct.upi_id}
                        {acct.cluster_id && (
                          <span className="text-[11px] text-teal-400 ml-2">
                            · {acct.cluster_id}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {roleDisplayLabel(acct.role)}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className={`font-medium ${accountStatusTextColor(acct.accountStatus)}`}>
                        {acct.accountStatus}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {acct.rbiSopClock
                          ? `Step ${acct.rbiSopStep ?? 2}/6 · Day ${acct.rbiSopClock.dayCount}/60${
                              acct.rbiSopClock.disputeSubmission
                                ? ` · AI ${acct.rbiSopClock.disputeSubmission.aiVerificationScore}/100`
                                : ''
                            }`
                          : 'No active SOP clock'}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                      <div className={acct.precisionLienHold > 0 ? 'text-amber-300 font-semibold' : 'text-slate-400'}>
                        {acct.precisionLienHold > 0 ? `${formatINR(acct.precisionLienHold)} held` : '₹0 held'}
                      </div>
                      <div className="text-[11px] text-emerald-400">
                        {formatINR(acct.usableCleanBalance)} usable
                      </div>
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right font-mono tabular-nums font-bold whitespace-nowrap ${riskTextColor(acct.risk_category)}`}
                    >
                      {acct.risk_score}/100 · {acct.risk_category}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-200">
                      {acct.connected_complaints.length}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-200">
                      {acct.rapid_pass_through_pct}%
                    </td>
                    <td className="px-4 py-2.5 text-slate-400 max-w-md">
                      {(acct.triggeredRules?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-0.5 font-mono text-[10px]">
                          {acct.triggeredRules.map((r) => (
                            <span
                              key={r.code}
                              className={
                                r.severity === 'CRITICAL'
                                  ? 'text-red-400 font-bold'
                                  : 'text-amber-300 font-semibold'
                              }
                            >
                              [{r.code}]
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="truncate">
                        {acct.has_circular_pattern && (
                          <span className="text-red-400 font-semibold mr-1.5">[Circular]</span>
                        )}
                        {acct.explanation}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

