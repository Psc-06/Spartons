import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Briefcase,
  FileBarChart2,
  FolderOpen,
  GitBranch,
  LayoutDashboard,
  Network,
  Search,
  Settings,
  Shield,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import type {
  AlertItem,
  DatasetMetadata,
  GlobalSearchResult,
  InvestigationCase,
} from '../shared/types';
import { api, formatINR } from '../lib/api';
import { RiskIndicator } from './UiPrimitives';

export type NavTab =
  | 'overview'
  | 'investigations'
  | 'transactions'
  | 'network'
  | 'accounts'
  | 'account-detail'
  | 'reports'
  | 'settings';

interface LayoutProps {
  activeTab: NavTab;
  onNavigate: (tab: NavTab) => void;
  datasets: DatasetMetadata[];
  activeDatasetId: string;
  activeCase: InvestigationCase | null;
  cases: InvestigationCase[];
  onSelectActiveCase: (caseId: string) => void;
  onOpenUpload: () => void;
  onOpenAiAssistant: () => void;
  alerts: AlertItem[];
  onJumpToAccount: (upiId: string) => void;
  onJumpToComplaint: (complaintId: string) => void;
  onJumpToCluster: (clusterId: string) => void;
  onJumpToCase: (caseId: string) => void;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{
  id: NavTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'investigations', label: 'Investigations', icon: Briefcase },
  { id: 'transactions', label: 'Transaction Analysis', icon: GitBranch },
  { id: 'network', label: 'Network Explorer', icon: Network },
  { id: 'accounts', label: 'Suspicious Accounts', icon: AlertTriangle },
  { id: 'reports', label: 'Reports', icon: FileBarChart2 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const Layout: React.FC<LayoutProps> = ({
  activeTab,
  onNavigate,
  datasets,
  activeDatasetId,
  activeCase,
  cases,
  onSelectActiveCase,
  onOpenUpload,
  onOpenAiAssistant,
  alerts,
  onJumpToAccount,
  onJumpToComplaint,
  onJumpToCluster,
  onJumpToCase,
  children,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GlobalSearchResult | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const searchRef = useRef<HTMLDivElement>(null);
  const alertsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
      if (alertsRef.current && !alertsRef.current.contains(e.target as Node)) {
        setAlertsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api.globalSearch(searchQuery.trim(), activeDatasetId);
        setSearchResults(res);
        setSearchOpen(true);
      } catch {
        setSearchResults(null);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [searchQuery, activeDatasetId]);

  const activeDataset = datasets.find((d) => d.id === activeDatasetId);
  const highAlertsCount = alerts.filter((a) => a.severity === 'HIGH').length;

  const hasSearchHits =
    searchResults &&
    (searchResults.accounts.length > 0 ||
      searchResults.complaints.length > 0 ||
      searchResults.clusters.length > 0 ||
      searchResults.transactions.length > 0 ||
      searchResults.investigations.length > 0);

  return (
    <div className="min-h-screen flex flex-col bg-[#0B1120] text-[#F1F5F9]">
      {/* Top Navigation Bar */}
      <header className="no-print h-14 shrink-0 bg-[#101827] border-b border-[#263449] px-5 flex items-center justify-between gap-6 sticky top-0 z-40">
        {/* Left: MuleShield Brand + Current Investigation Context */}
        <div className="flex items-center gap-5 min-w-0">
          <button
            type="button"
            onClick={() => onNavigate('overview')}
            className="flex items-center gap-2.5 text-left shrink-0 focus:outline-none"
          >
            <div className="w-7 h-7 rounded-md bg-[#3B82F6]/15 border border-[#3B82F6]/40 flex items-center justify-center">
              <Shield className="w-4 h-4 text-[#3B82F6]" />
            </div>
            <span className="text-sm font-bold tracking-tight text-[#F1F5F9] whitespace-nowrap">
              MuleShield
            </span>
          </button>

          <span className="h-5 w-px bg-[#263449] hidden md:block" aria-hidden="true" />

          {/* Current Investigation Context Indicator */}
          <div className="hidden md:flex items-center gap-2 min-w-0">
            <FolderOpen className="w-3.5 h-3.5 text-[#3B82F6] shrink-0" />
            <span className="text-xs text-[#94A3B8] whitespace-nowrap">Investigation:</span>
            <select
              aria-label="Current active investigation"
              value={activeCase?.case_id ?? ''}
              onChange={(e) => onSelectActiveCase(e.target.value)}
              className="bg-[#151F30] border border-[#263449] hover:border-[#3B82F6]/50 rounded-md px-2.5 py-1 text-xs font-medium text-[#F1F5F9] focus:outline-none max-w-[260px] truncate cursor-pointer"
            >
              {cases.length === 0 ? (
                <option value="">No active case</option>
              ) : (
                cases.map((c) => (
                  <option key={c.case_id} value={c.case_id} className="bg-[#101827]">
                    {c.case_id} · {c.title}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {/* Center: Global Search */}
        <div ref={searchRef} className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onFocus={() => searchResults && setSearchOpen(true)}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search account ID, transaction, reference number, or case..."
            className="w-full bg-[#0B1120] border border-[#263449] focus:border-[#3B82F6] rounded-md pl-9 pr-8 py-1.5 text-xs text-[#F1F5F9] placeholder:text-[#64748B] focus:outline-none transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSearchResults(null);
                setSearchOpen(false);
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#F1F5F9]"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {searchOpen && searchQuery.trim().length >= 2 && (
            <div className="absolute left-0 right-0 mt-1.5 bg-[#151F30] border border-[#263449] rounded-md shadow-2xl max-h-96 overflow-y-auto z-50 divide-y divide-[#263449]">
              {!hasSearchHits ? (
                <div className="p-4 text-xs text-[#94A3B8]">
                  No records found matching &ldquo;{searchQuery}&rdquo;.
                </div>
              ) : (
                <>
                  {searchResults!.accounts.length > 0 && (
                    <div className="p-2">
                      <div className="px-2 py-1 text-[11px] font-semibold text-[#94A3B8]">
                        Accounts
                      </div>
                      {searchResults!.accounts.map((a) => (
                        <button
                          key={a.upi_id}
                          type="button"
                          onClick={() => {
                            setSearchOpen(false);
                            onJumpToAccount(a.upi_id);
                          }}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-[#1E2B42] text-left text-xs"
                        >
                          <span className="font-mono text-[#F1F5F9] truncate">{a.upi_id}</span>
                          <RiskIndicator score={a.risk_score} />
                        </button>
                      ))}
                    </div>
                  )}
                  {searchResults!.complaints.length > 0 && (
                    <div className="p-2">
                      <div className="px-2 py-1 text-[11px] font-semibold text-[#94A3B8]">
                        Reported Transactions
                      </div>
                      {searchResults!.complaints.map((c) => (
                        <button
                          key={c.complaint_id}
                          type="button"
                          onClick={() => {
                            setSearchOpen(false);
                            onJumpToComplaint(c.complaint_id);
                          }}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-[#1E2B42] text-left text-xs"
                        >
                          <span className="font-mono text-[#3B82F6]">{c.complaint_id}</span>
                          <span className="font-mono text-[#94A3B8] truncate mx-2">
                            {c.receiver_upi}
                          </span>
                          <span className="font-mono tabular-nums text-[#F1F5F9]">
                            {formatINR(c.amount)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {searchResults!.clusters.length > 0 && (
                    <div className="p-2">
                      <div className="px-2 py-1 text-[11px] font-semibold text-[#94A3B8]">
                        Networks
                      </div>
                      {searchResults!.clusters.map((cl) => (
                        <button
                          key={cl.cluster_id}
                          type="button"
                          onClick={() => {
                            setSearchOpen(false);
                            onJumpToCluster(cl.cluster_id);
                          }}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-[#1E2B42] text-left text-xs"
                        >
                          <span className="text-[#F1F5F9] truncate">
                            <span className="font-mono text-[#3B82F6] mr-2">{cl.cluster_id}</span>
                            {cl.name}
                          </span>
                          <span className="font-mono text-[#94A3B8] shrink-0 ml-2">
                            {cl.complaint_count} linked
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {searchResults!.investigations.length > 0 && (
                    <div className="p-2">
                      <div className="px-2 py-1 text-[11px] font-semibold text-[#94A3B8]">
                        Investigations
                      </div>
                      {searchResults!.investigations.map((inv) => (
                        <button
                          key={inv.case_id}
                          type="button"
                          onClick={() => {
                            setSearchOpen(false);
                            onJumpToCase(inv.case_id);
                          }}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-[#1E2B42] text-left text-xs"
                        >
                          <span className="text-[#F1F5F9] truncate">
                            <span className="font-mono text-[#3B82F6] mr-2">{inv.case_id}</span>
                            {inv.title}
                          </span>
                          <span className="text-[11px] text-[#94A3B8] shrink-0 ml-2">
                            {inv.status}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Right: AI Assistant, Notifications, Investigator Profile */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onOpenAiAssistant}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#151F30] hover:bg-[#1D2B42] text-[#F1F5F9] border border-[#263449] transition-colors whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#3B82F6]" />
            <span>AI Assistant</span>
          </button>

          {/* Notifications */}
          <div ref={alertsRef} className="relative">
            <button
              type="button"
              onClick={() => setAlertsOpen((v) => !v)}
              className="relative p-1.5 rounded-md text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-[#151F30] border border-transparent hover:border-[#263449] transition-colors"
              aria-label="Investigation alerts"
            >
              <Bell className="w-4 h-4" />
              {highAlertsCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded bg-[#EF4444] text-[10px] font-bold text-white flex items-center justify-center tabular-nums">
                  {highAlertsCount}
                </span>
              )}
            </button>

            {alertsOpen && (
              <div className="absolute right-0 mt-2 w-96 bg-[#151F30] border border-[#263449] rounded-md shadow-2xl z-50">
                <div className="px-4 py-3 border-b border-[#263449] flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#F1F5F9]">
                    High-Priority Alerts ({alerts.length})
                  </span>
                  <span className="text-[11px] text-[#94A3B8]">Click to inspect</span>
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-[#263449]">
                  {alerts.length === 0 ? (
                    <div className="p-4 text-xs text-[#94A3B8]">No alerts in current dataset.</div>
                  ) : (
                    alerts.map((al) => (
                      <button
                        key={al.id}
                        type="button"
                        onClick={() => {
                          setAlertsOpen(false);
                          if (al.account_id) onJumpToAccount(al.account_id);
                          else if (al.cluster_id) onJumpToCluster(al.cluster_id);
                        }}
                        className="w-full text-left px-4 py-3 hover:bg-[#1C2940] transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`text-[11px] font-semibold ${
                              al.severity === 'HIGH'
                                ? 'text-[#EF4444]'
                                : al.severity === 'MEDIUM'
                                ? 'text-[#EAB308]'
                                : 'text-[#22C55E]'
                            }`}
                          >
                            {al.severity === 'HIGH' ? 'High Priority' : 'Medium Priority'}
                          </span>
                          <span className="text-[11px] font-mono text-[#94A3B8]">{al.metric}</span>
                        </div>
                        <div className="text-xs font-medium text-[#F1F5F9] mt-0.5">{al.title}</div>
                        <div className="text-[11px] text-[#94A3B8] mt-0.5 line-clamp-2">
                          {al.description}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Investigator Profile */}
          <div className="flex items-center gap-2 pl-3 border-l border-[#263449]">
            {!avatarFailed ? (
              <img
                src="/src/assets/images/avatar_investigator_1795159055031.jpg"
                alt="Inspector R. Deshmukh"
                referrerPolicy="no-referrer"
                onError={() => setAvatarFailed(true)}
                className="w-7 h-7 rounded-full object-cover border border-[#263449]"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-[#151F30] border border-[#263449] flex items-center justify-center text-[11px] font-semibold text-[#3B82F6]">
                RD
              </div>
            )}
            <div className="hidden xl:block text-left leading-tight">
              <div className="text-xs font-medium text-[#F1F5F9] whitespace-nowrap">
                Insp. R. Deshmukh
              </div>
              <div className="text-[11px] text-[#94A3B8] whitespace-nowrap">
                Financial Crime Unit
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Body: Left Sidebar + Main Content */}
      <div className="flex-1 flex min-h-0">
        {/* Persistent Left Sidebar (7 Focused Modules) */}
        <aside className="no-print w-60 shrink-0 bg-[#101827] border-r border-[#263449] flex flex-col justify-between sticky top-14 h-[calc(100vh-3.5rem)]">
          <div className="p-3 space-y-1 overflow-y-auto">
            <div className="px-3 py-1.5 text-[11px] font-medium text-[#64748B]">
              Workspace
            </div>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive =
                activeTab === item.id ||
                (activeTab === 'account-detail' && item.id === 'accounts');
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-[#151F30] text-[#F1F5F9] border border-[#263449]'
                      : 'text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-[#151F30]/60 border border-transparent'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-[#3B82F6]' : 'text-[#64748B]'
                    }`}
                  />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Bottom Data Upload Action & Dataset Context */}
          <div className="p-3 border-t border-[#263449] space-y-2.5">
            <button
              type="button"
              onClick={onOpenUpload}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-semibold bg-[#3B82F6] hover:bg-blue-500 text-white transition-colors whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5 shrink-0" />
              <span>Upload Data (CSV / XLSX)</span>
            </button>
            <div className="px-1 text-[11px] text-[#64748B] leading-snug">
              <div className="text-[#94A3B8] font-medium truncate">
                {activeDataset?.name || 'Demo Dataset'}
              </div>
              <div className="mt-0.5">
                {activeDataset?.source_type === 'SYNTHETIC_DEMO'
                  ? 'Synthetic sample dataset (@demo)'
                  : 'Uploaded investigation dataset'}
              </div>
            </div>
          </div>
        </aside>

        {/* Main Viewport */}
        <main className="flex-1 min-w-0 p-6 lg:p-8 max-w-[1600px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
};
