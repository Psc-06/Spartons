import React, { useEffect, useState } from 'react';
import {
  Download,
  FileBarChart2,
  FileJson,
  Loader2,
  MessageSquarePlus,
  Printer,
  ShieldAlert,
} from 'lucide-react';
import type { InvestigationCase, InvestigationReportData } from '../shared/types';
import {
  api,
  downloadCsvFile,
  formatDateTime,
  formatINR,
  formatShortINR,
  roleDisplayLabel,
} from '../lib/api';
import { computeRiskTier } from '../components/UiPrimitives';

interface ReportsViewProps {
  datasetId: string;
  cases: InvestigationCase[];
  initialCaseId: string | null;
  onCasesChanged: () => Promise<void>;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  datasetId,
  cases,
  initialCaseId,
  onCasesChanged,
}) => {
  const [selectedCaseId, setSelectedCaseId] = useState<string>(
    initialCaseId || cases[0]?.case_id || '',
  );
  const [includeAi, setIncludeAi] = useState<boolean>(true);
  const [report, setReport] = useState<InvestigationReportData | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Investigator Conclusion & Notes editor directly inside Reports view
  const [conclusionInput, setConclusionInput] = useState('');
  const [savingConclusion, setSavingConclusion] = useState(false);

  useEffect(() => {
    if (initialCaseId) {
      setSelectedCaseId(initialCaseId);
    } else if (!selectedCaseId && cases.length > 0) {
      setSelectedCaseId(cases[0].case_id);
    }
  }, [initialCaseId, cases, selectedCaseId]);

  const handleGenerate = async (targetCaseId = selectedCaseId) => {
    if (!targetCaseId) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await api.generateReport({
        caseId: targetCaseId,
        includeAiSummary: includeAi,
        datasetId,
      });
      setReport(res);
      await onCasesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate investigation report.');
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (initialCaseId) {
      handleGenerate(initialCaseId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCaseId]);

  const handleSaveConclusion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!report || !conclusionInput.trim()) return;
    setSavingConclusion(true);
    try {
      const updated = await api.updateInvestigation(report.case_record.case_id, {
        addNote: {
          author: report.case_record.assignee,
          content: conclusionInput.trim(),
        },
        actor: report.case_record.assignee,
      });
      setReport((prev) => (prev ? { ...prev, case_record: updated } : prev));
      setConclusionInput('');
      await onCasesChanged();
    } finally {
      setSavingConclusion(false);
    }
  };

  const exportTrailCsv = () => {
    if (!report) return;
    downloadCsvFile(
      `${report.report_id}_evidence_trail.csv`,
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
        'is_circular',
      ],
      report.traced_transactions.map((t) => [
        t.hop,
        t.transaction_id,
        t.utr,
        t.timestamp,
        t.sender_upi,
        t.receiver_upi,
        t.amount,
        t.potentially_attributed_amount,
        t.attribution_status,
        t.status,
        t.is_circular,
      ]),
    );
  };

  const downloadEvidenceJson = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.report_id}_evidence_package.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Static printable network flow SVG
  const renderStaticNetworkSvg = (rep: InvestigationReportData) => {
    const cluster = rep.network_cluster;
    if (!cluster || cluster.nodes.length === 0) return null;

    const layers: Record<string, string[]> = {
      VICTIM: [],
      INITIAL_RECIPIENT: [],
      INTERMEDIARY: [],
      DOWNSTREAM: [],
    };
    for (const n of cluster.nodes) {
      if (n.role in layers) layers[n.role].push(n.id);
    }
    layers.VICTIM = layers.VICTIM.slice(0, 8);

    const colKeys = ['VICTIM', 'INITIAL_RECIPIENT', 'INTERMEDIARY', 'DOWNSTREAM'] as const;
    const colTitles = ['Source / Victims (Sample)', 'Initial Recipients', 'Intermediary Layer', 'Final Destinations'];
    const width = 820;
    const maxCount = Math.max(2, ...colKeys.map((k) => layers[k].length));
    const height = Math.max(220, maxCount * 42 + 64);

    const coords = new Map<string, { x: number; y: number }>();
    colKeys.forEach((key, colIdx) => {
      const items = layers[key];
      const spacing = (height - 64) / Math.max(1, items.length);
      items.forEach((id, rowIdx) => {
        coords.set(id, {
          x: 24 + colIdx * 200,
          y: 48 + rowIdx * spacing + spacing / 2,
        });
      });
    });

    const drawnEdges = cluster.edges
      .filter((e) => coords.has(e.source) && coords.has(e.target))
      .slice(0, 40);

    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto border border-[#263449] print:border-slate-300 rounded bg-[#0B1120] print:bg-slate-50"
      >
        {colTitles.map((title, idx) => (
          <text
            key={title}
            x={24 + idx * 200 + 72}
            y={22}
            textAnchor="middle"
            fontSize={10}
            fontWeight="600"
            className="fill-[#94A3B8] print:fill-slate-600"
          >
            {title}
          </text>
        ))}

        {drawnEdges.map((edge) => {
          const from = coords.get(edge.source)!;
          const to = coords.get(edge.target)!;
          return (
            <line
              key={edge.id}
              x1={from.x + 144}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={edge.is_circular ? '#EF4444' : '#3B82F6'}
              strokeWidth={edge.is_circular ? 1.5 : 1}
              strokeOpacity={0.55}
              strokeDasharray={edge.is_circular ? '4 2' : undefined}
            />
          );
        })}

        {[...coords.entries()].map(([id, pt]) => {
          const node = cluster.nodes.find((n) => n.id === id);
          const tier = node ? computeRiskTier(node.risk_score) : 'LOW';
          const stroke =
            tier === 'CRITICAL'
              ? '#EF4444'
              : tier === 'HIGH'
              ? '#F97316'
              : tier === 'MEDIUM'
              ? '#EAB308'
              : '#3B82F6';
          return (
            <g key={id}>
              <rect
                x={pt.x}
                y={pt.y - 13}
                width={144}
                height={26}
                rx={4}
                className="fill-[#151F30] print:fill-white"
                stroke={stroke}
                strokeWidth={1.25}
              />
              <text
                x={pt.x + 72}
                y={pt.y + 3}
                textAnchor="middle"
                fontSize={9}
                fontFamily="IBM Plex Mono, monospace"
                className="fill-[#F1F5F9] print:fill-slate-900"
              >
                {id.length > 21 ? `${id.slice(0, 19)}…` : id}
              </text>
            </g>
          );
        })}
      </svg>
    );
  };

  return (
    <div className="space-y-6">
      {/* Controls Bar (hidden when printing) */}
      <div className="no-print space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-[#263449]">
          <div>
            <h1 className="text-xl font-semibold text-[#F1F5F9] tracking-tight">
              Investigation Reports
            </h1>
            <p className="text-xs text-[#94A3B8] mt-1">
              Preview structured dossiers separating automated findings from investigator conclusions, then export to PDF, CSV, or JSON evidence packages.
            </p>
          </div>
        </div>

        <div className="bg-[#151F30] border border-[#263449] rounded-md p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4 flex-1">
            <div className="min-w-[260px]">
              <label className="block text-[11px] font-medium text-[#94A3B8] mb-1">
                Select Investigation Case
              </label>
              <select
                value={selectedCaseId}
                onChange={(e) => setSelectedCaseId(e.target.value)}
                className="w-full bg-[#0B1120] border border-[#263449] rounded-md px-3 py-2 text-xs text-[#F1F5F9] font-mono"
              >
                {cases.length === 0 ? (
                  <option value="">No investigation cases available</option>
                ) : (
                  cases.map((c) => (
                    <option key={c.case_id} value={c.case_id}>
                      {c.case_id} — {c.title} ({c.complaint_ids.length} complaints)
                    </option>
                  ))
                )}
              </select>
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-[#F1F5F9] mt-4 cursor-pointer">
              <input
                type="checkbox"
                checked={includeAi}
                onChange={(e) => setIncludeAi(e.target.checked)}
                className="accent-[#3B82F6]"
              />
              <span>Include AI Analytical Briefing</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!selectedCaseId || generating}
              onClick={() => handleGenerate(selectedCaseId)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold bg-[#3B82F6] hover:bg-blue-500 disabled:opacity-40 text-white"
            >
              {generating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileBarChart2 className="w-3.5 h-3.5" />
              )}
              <span>{generating ? 'Compiling Preview...' : 'Preview Report'}</span>
            </button>

            {report && (
              <>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium bg-[#101827] hover:bg-[#1E2B42] text-[#F1F5F9] border border-[#263449]"
                >
                  <Printer className="w-3.5 h-3.5 text-[#3B82F6]" />
                  <span>Export PDF</span>
                </button>
                <button
                  type="button"
                  onClick={exportTrailCsv}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-[#101827] hover:bg-[#1E2B42] text-[#F1F5F9] border border-[#263449]"
                >
                  <Download className="w-3.5 h-3.5 text-[#3B82F6]" />
                  <span>Export CSV</span>
                </button>
                <button
                  type="button"
                  onClick={downloadEvidenceJson}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-[#101827] hover:bg-[#1E2B42] text-[#F1F5F9] border border-[#263449]"
                >
                  <FileJson className="w-3.5 h-3.5 text-[#3B82F6]" />
                  <span>Download Evidence</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="no-print p-4 bg-[#EF4444]/10 border border-[#EF4444]/40 rounded-md text-xs text-red-200">
          {error}
        </div>
      )}

      {!report && !generating && (
        <div className="no-print bg-[#151F30] border border-[#263449] rounded-md p-10 text-center">
          <FileBarChart2 className="w-8 h-8 text-[#64748B] mx-auto mb-3" />
          <div className="text-sm font-semibold text-[#F1F5F9]">Ready to Compile Report</div>
          <p className="text-xs text-[#94A3B8] mt-1 max-w-md mx-auto">
            Select an investigation case above and click &ldquo;Preview Report&rdquo; to assemble the print-ready PDF dossier and exportable evidence files.
          </p>
        </div>
      )}

      {/* Printable Institutional Report Preview */}
      {report && (
        <article className="print-report-container bg-[#151F30] print:bg-white text-[#F1F5F9] print:text-slate-900 border border-[#263449] rounded-md p-8 space-y-7">
          {/* 1. Official Report Header */}
          <header className="pb-5 border-b-2 border-[#263449] print:border-slate-900 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold tracking-wider text-[#3B82F6] print:text-slate-700">
                MULESHIELD FINANCIAL CRIME INTELLIGENCE
              </div>
              <h2 className="text-xl font-bold text-[#F1F5F9] print:text-slate-950 mt-1">
                {report.label}
              </h2>
              <div className="text-sm text-[#94A3B8] print:text-slate-700 mt-1 font-medium">
                {report.case_record.title}
              </div>
            </div>
            <div className="text-right font-mono text-[11px] text-[#94A3B8] print:text-slate-600 space-y-0.5">
              <div>Report ID: {report.report_id}</div>
              <div>Case ID: {report.case_record.case_id}</div>
              <div>Generated: {formatDateTime(report.generated_at)}</div>
              <div>Engine: {report.analysis_version}</div>
              <div>
                Source: {report.dataset_source} ({report.source_type})
              </div>
            </div>
          </header>

          {/* 2. Mandatory Disclaimer */}
          <section className="p-4 rounded bg-[#EAB308]/10 print:bg-amber-50 border border-[#EAB308]/40 print:border-amber-400 flex items-start gap-3 text-xs">
            <ShieldAlert className="w-4 h-4 text-[#EAB308] print:text-amber-700 shrink-0 mt-0.5" />
            <p className="text-amber-100 print:text-slate-800 leading-relaxed font-medium">
              {report.disclaimer}
            </p>
          </section>

          {/* 3. Case Overview Metrics */}
          <section className="print-break-inside-avoid grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3.5 rounded bg-[#101827] print:bg-slate-50 border border-[#263449] print:border-slate-300">
              <div className="text-[11px] text-[#94A3B8] print:text-slate-600">Linked Complaints</div>
              <div className="text-lg font-semibold font-mono tabular-nums mt-0.5">
                {report.linked_complaints.length}
              </div>
            </div>
            <div className="p-3.5 rounded bg-[#101827] print:bg-slate-50 border border-[#263449] print:border-slate-300">
              <div className="text-[11px] text-[#94A3B8] print:text-slate-600">Total Reported Exposure</div>
              <div className="text-lg font-semibold font-mono tabular-nums mt-0.5">
                {formatINR(report.total_reported_amount)}
              </div>
            </div>
            <div className="p-3.5 rounded bg-[#101827] print:bg-slate-50 border border-[#263449] print:border-slate-300">
              <div className="text-[11px] text-[#94A3B8] print:text-slate-600">Connected Accounts</div>
              <div className="text-lg font-semibold font-mono tabular-nums mt-0.5">
                {report.connected_accounts.length}
              </div>
            </div>
            <div className="p-3.5 rounded bg-[#101827] print:bg-slate-50 border border-[#263449] print:border-slate-300">
              <div className="text-[11px] text-[#94A3B8] print:text-slate-600">Investigator / Status</div>
              <div className="text-xs font-semibold mt-1">{report.case_record.assignee}</div>
              <div className="text-[11px] font-mono text-[#3B82F6] print:text-slate-600">
                {report.case_record.status.replace(/_/g, ' ')} · {report.case_record.priority}
              </div>
            </div>
          </section>

          {/* 4. System-Generated Findings vs Investigator Conclusions (Explicitly Separated) */}
          <section className="print-break-inside-avoid grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* System-Generated Findings */}
            <div className="p-5 rounded bg-[#101827] print:bg-slate-50 border border-[#263449] print:border-slate-300 space-y-3 text-xs">
              <div className="pb-2 border-b border-[#263449] print:border-slate-300">
                <div className="text-[11px] font-mono text-[#3B82F6] print:text-slate-600">
                  SECTION A · AUTOMATED OUTPUT
                </div>
                <h3 className="text-sm font-semibold mt-0.5">
                  System-Generated Analytical Findings
                </h3>
              </div>
              {report.ai_summary ? (
                <>
                  <p className="leading-relaxed text-[#E2E8F0] print:text-slate-800">
                    {report.ai_summary.summary}
                  </p>
                  {report.ai_summary.observed_patterns.length > 0 && (
                    <div>
                      <div className="font-semibold text-[#94A3B8] print:text-slate-700 mb-1">
                        Detected Patterns:
                      </div>
                      <ul className="list-disc pl-4 space-y-1 text-[#CBD5E1] print:text-slate-700">
                        {report.ai_summary.observed_patterns.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="text-[10px] text-[#64748B] print:text-slate-600 italic pt-1">
                    {report.ai_summary.disclaimer} ({report.ai_summary.model_used})
                  </div>
                </>
              ) : (
                <p className="text-[#94A3B8] print:text-slate-600">
                  Automated narrative summary was not requested or unavailable. Deterministic ledger tables below remain complete.
                </p>
              )}
            </div>

            {/* Investigator Conclusions & Notes */}
            <div className="p-5 rounded bg-[#101827] print:bg-slate-50 border border-[#263449] print:border-slate-300 space-y-3 text-xs flex flex-col justify-between">
              <div className="space-y-3">
                <div className="pb-2 border-b border-[#263449] print:border-slate-300">
                  <div className="text-[11px] font-mono text-[#22C55E] print:text-slate-600">
                    SECTION B · HUMAN REVIEW
                  </div>
                  <h3 className="text-sm font-semibold mt-0.5">
                    Investigator Conclusions &amp; Notes
                  </h3>
                </div>
                {report.case_record.notes.length === 0 ? (
                  <p className="text-[#94A3B8] print:text-slate-600">
                    No investigator conclusions have been logged yet for this case.
                  </p>
                ) : (
                  <div className="space-y-2.5 max-h-48 overflow-y-auto print:max-h-none">
                    {report.case_record.notes.map((note) => (
                      <div
                        key={note.id}
                        className="p-2.5 rounded bg-[#151F30] print:bg-white border border-[#263449] print:border-slate-200"
                      >
                        <div className="flex justify-between text-[10px] text-[#94A3B8] print:text-slate-500 mb-1">
                          <span className="font-semibold">{note.author}</span>
                          <span className="font-mono">{formatDateTime(note.timestamp)}</span>
                        </div>
                        <p className="text-[#E2E8F0] print:text-slate-800 leading-relaxed">
                          {note.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick Add Conclusion (Hidden when printing) */}
              <form onSubmit={handleSaveConclusion} className="no-print flex gap-2 pt-2 border-t border-[#263449]">
                <input
                  type="text"
                  value={conclusionInput}
                  onChange={(e) => setConclusionInput(e.target.value)}
                  placeholder="Append investigator conclusion to report..."
                  className="flex-1 bg-[#0B1120] border border-[#263449] focus:border-[#3B82F6] rounded px-2.5 py-1.5 text-xs text-[#F1F5F9] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!conclusionInput.trim() || savingConclusion}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-[#3B82F6] hover:bg-blue-500 text-white text-xs font-medium disabled:opacity-40"
                >
                  <MessageSquarePlus className="w-3.5 h-3.5" />
                  <span>Add</span>
                </button>
              </form>
            </div>
          </section>

          {/* 5. Embedded Network Diagram Snapshot */}
          {report.network_cluster && (
            <section className="print-break-inside-avoid space-y-2.5">
              <h3 className="text-sm font-semibold border-b border-[#263449] print:border-slate-300 pb-1.5">
                Network Graph Snapshot ({report.network_cluster.cluster_id} — {report.network_cluster.name})
              </h3>
              {renderStaticNetworkSvg(report)}
            </section>
          )}

          {/* 6. Suspicious Accounts Summary */}
          <section className="space-y-2.5">
            <h3 className="text-sm font-semibold border-b border-[#263449] print:border-slate-300 pb-1.5">
              Suspicious Accounts Summary ({report.connected_accounts.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px] border-collapse">
                <thead>
                  <tr className="border-b border-[#263449] print:border-slate-400 text-[#94A3B8] print:text-slate-700">
                    <th className="py-2 pr-3">Account ID</th>
                    <th className="py-2 pr-3">Role</th>
                    <th className="py-2 pr-3 text-right">Risk Score</th>
                    <th className="py-2 pr-3 text-right">Complaints</th>
                    <th className="py-2 pr-3 text-right">Pass-Through</th>
                    <th className="py-2">Key Evidence Indicators</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#263449] print:divide-slate-200">
                  {report.connected_accounts.map((a) => (
                    <tr key={a.upi_id}>
                      <td className="py-1.5 pr-3 font-mono">{a.upi_id}</td>
                      <td className="py-1.5 pr-3">{roleDisplayLabel(a.role)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono font-bold">
                        {a.risk_score} ({computeRiskTier(a.risk_score)})
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono">
                        {a.connected_complaints.length}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono">
                        {a.rapid_pass_through_pct}%
                      </td>
                      <td className="py-1.5 text-[#CBD5E1] print:text-slate-700">{a.explanation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 7. Key Traced Transaction Paths */}
          <section className="space-y-2.5">
            <h3 className="text-sm font-semibold border-b border-[#263449] print:border-slate-300 pb-1.5">
              Supporting Transaction Evidence &amp; Multi-Hop Timeline (Top 40 Transfers)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px] border-collapse font-mono">
                <thead>
                  <tr className="border-b border-[#263449] print:border-slate-400 text-[#94A3B8] print:text-slate-700 font-sans">
                    <th className="py-2 pr-2">Hop</th>
                    <th className="py-2 pr-2">Timestamp</th>
                    <th className="py-2 pr-2">Txn ID / Ref</th>
                    <th className="py-2 pr-2">Sender → Receiver</th>
                    <th className="py-2 pr-2 text-right">Amount</th>
                    <th className="py-2 pr-2 text-right">FIFO Est.</th>
                    <th className="py-2">Basis</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#263449] print:divide-slate-200">
                  {report.traced_transactions.slice(0, 40).map((t) => (
                    <tr key={t.transaction_id}>
                      <td className="py-1.5 pr-2">
                        H{t.hop}
                        {t.is_circular ? ' (Loop)' : ''}
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">{formatDateTime(t.timestamp)}</td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">
                        {t.transaction_id} / {t.utr}
                      </td>
                      <td className="py-1.5 pr-2">
                        {t.sender_upi} → {t.receiver_upi}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{formatShortINR(t.amount)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {formatShortINR(t.potentially_attributed_amount)}
                      </td>
                      <td className="py-1.5 font-sans">{t.attribution_status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 8. Attribution Assumptions & Limitations */}
          <section className="print-break-inside-avoid grid grid-cols-1 md:grid-cols-2 gap-6 text-xs pt-2">
            <div>
              <h3 className="text-sm font-semibold border-b border-[#263449] print:border-slate-300 pb-1.5 mb-2">
                Attribution Assumptions ({report.attribution_method})
              </h3>
              <ul className="list-disc pl-5 space-y-1 text-[#94A3B8] print:text-slate-700">
                {report.attribution_assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold border-b border-[#263449] print:border-slate-300 pb-1.5 mb-2">
                Missing Evidence &amp; Analytical Limitations
              </h3>
              <ul className="list-disc pl-5 space-y-1 text-[#94A3B8] print:text-slate-700">
                {report.missing_evidence_and_limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          </section>
        </article>
      )}
    </div>
  );
};
