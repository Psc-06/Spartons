import React, { useState } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react';
import type { ImportValidationSummary } from '../shared/types';
import { api } from '../lib/api';

interface DatasetUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: (datasetId: string) => void;
  onLoadDemo: () => Promise<void>;
}

const TRANSACTION_FIELDS = [
  { key: 'transaction_id', label: 'Transaction ID', required: true },
  { key: 'sender_upi', label: 'Sender Account', required: true },
  { key: 'receiver_upi', label: 'Receiver Account', required: true },
  { key: 'amount', label: 'Amount', required: true },
  { key: 'timestamp', label: 'Timestamp', required: true },
  { key: 'channel', label: 'Transaction Type', required: false },
  { key: 'utr', label: 'Reference Number (UTR)', required: false },
  { key: 'status', label: 'Status', required: false },
] as const;

const COMPLAINT_FIELDS = [
  { key: 'complaint_id', label: 'Complaint ID' },
  { key: 'victim_reference', label: 'Victim Reference' },
  { key: 'reported_transaction_id', label: 'Reported Txn ID' },
  { key: 'utr', label: 'Reference / UTR' },
  { key: 'transaction_timestamp', label: 'Timestamp' },
  { key: 'amount', label: 'Amount' },
  { key: 'sender_upi', label: 'Sender Account' },
  { key: 'receiver_upi', label: 'Receiver Account' },
  { key: 'complaint_date', label: 'Complaint Date' },
] as const;

interface ParsedSheet {
  fileName: string;
  headers: string[];
  rows: Record<string, unknown>[];
  duplicateCount: number;
  missingFieldRows: number;
}

function autoMap(keys: string[], headers: string[]): Record<string, string> {
  const aliases: Record<string, string[]> = {
    transaction_id: ['transactionid', 'txnid', 'txid', 'id'],
    sender_upi: ['senderupi', 'senderaccount', 'sender', 'fromaccount', 'from'],
    receiver_upi: ['receiverupi', 'receiveraccount', 'receiver', 'toaccount', 'to', 'beneficiary'],
    amount: ['amount', 'amt', 'value', 'inr'],
    timestamp: ['timestamp', 'date', 'datetime', 'time', 'txntime'],
    channel: ['channel', 'transactiontype', 'type', 'mode'],
    utr: ['utr', 'referencenumber', 'refno', 'reference', 'rrn'],
    status: ['status', 'state', 'txstatus'],
  };

  const normHeaders = headers.map((h) => ({
    raw: h,
    norm: h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''),
  }));

  const map: Record<string, string> = {};
  for (const key of keys) {
    const targetNorm = key.replace(/[^a-z0-9]/g, '');
    const candidates = aliases[key] ?? [targetNorm];
    const match =
      normHeaders.find((h) => candidates.includes(h.norm)) ??
      normHeaders.find((h) => candidates.some((c) => h.norm.includes(c) || c.includes(h.norm)));
    map[key] = match ? match.raw : '';
  }
  return map;
}

async function parseSpreadsheetFile(file: File): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return { headers: [], rows: [] };
    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { headers, rows };
  }
  const text = await file.text();
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  return {
    headers: parsed.meta.fields ?? [],
    rows: parsed.data,
  };
}

export const DatasetUploadModal: React.FC<DatasetUploadModalProps> = ({
  isOpen,
  onClose,
  onImported,
  onLoadDemo,
}) => {
  const [datasetName, setDatasetName] = useState('New Investigation Dataset');
  const [txFile, setTxFile] = useState<ParsedSheet | null>(null);
  const [cmpFile, setCmpFile] = useState<ParsedSheet | null>(null);
  const [txMap, setTxMap] = useState<Record<string, string>>({});
  const [cmpMap, setCmpMap] = useState<Record<string, string>>({});
  const [showOptionalComplaints, setShowOptionalComplaints] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [processingStep, setProcessingStep] = useState<string | null>(null);
  const [progressPct, setProgressPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportValidationSummary | null>(null);

  if (!isOpen) return null;

  const inspectSheetQuality = (
    rows: Record<string, unknown>[],
    mapping: Record<string, string>,
    idKey: string,
  ) => {
    const seen = new Set<string>();
    let duplicateCount = 0;
    let missingFieldRows = 0;
    const idHeader = mapping[idKey];
    const amtHeader = mapping.amount;
    for (const r of rows) {
      const idVal = idHeader ? String(r[idHeader] ?? '').trim() : '';
      const amtVal = amtHeader ? Number(r[amtHeader]) : 1;
      if (!idVal || !Number.isFinite(amtVal) || amtVal <= 0) {
        missingFieldRows++;
      } else if (seen.has(idVal)) {
        duplicateCount++;
      } else {
        seen.add(idVal);
      }
    }
    return { duplicateCount, missingFieldRows };
  };

  const handleSelectFile = async (kind: 'transactions' | 'complaints', file: File | null) => {
    if (!file) return;
    setError(null);
    setSummary(null);
    try {
      const { headers, rows } = await parseSpreadsheetFile(file);
      if (rows.length === 0) {
        setError(`"${file.name}" appears empty or has no readable header row.`);
        return;
      }
      if (kind === 'transactions') {
        const mapping = autoMap(
          TRANSACTION_FIELDS.map((f) => f.key),
          headers,
        );
        const q = inspectSheetQuality(rows, mapping, 'transaction_id');
        setTxMap(mapping);
        setTxFile({ fileName: file.name, headers, rows, ...q });
        if (datasetName === 'New Investigation Dataset') {
          setDatasetName(file.name.replace(/\.(csv|xlsx|xls)$/i, ''));
        }
      } else {
        const mapping = autoMap(
          COMPLAINT_FIELDS.map((f) => f.key),
          headers,
        );
        const q = inspectSheetQuality(rows, mapping, 'complaint_id');
        setCmpMap(mapping);
        setCmpFile({ fileName: file.name, headers, rows, ...q });
      }
    } catch {
      setError(`Unable to read "${file.name}". Please ensure it is a valid CSV or Excel (.xlsx) file.`);
    }
  };

  const handleProcessUpload = async () => {
    if (!txFile) {
      setError('Upload a transaction CSV or XLSX file to continue.');
      return;
    }
    setError(null);
    setProcessingStep('Validating columns and data types...');
    setProgressPct(28);

    try {
      // Ensure default SUCCESS status when an uploaded bank ledger omits a status column
      const preparedTxRows = txFile.rows.map((row) => {
        const copy: Record<string, unknown> = { ...row };
        if (!txMap.status) copy.status = 'SUCCESS';
        return copy;
      });

      await new Promise((r) => setTimeout(r, 200));
      setProcessingStep('Checking duplicates and running graph analysis...');
      setProgressPct(65);

      const res = await api.uploadDataset({
        name: datasetName.trim() || 'Uploaded Investigation Dataset',
        transactionsRows: preparedTxRows,
        complaintsRows: cmpFile ? cmpFile.rows : undefined,
        transactionMapping: txMap,
        complaintMapping: cmpFile ? cmpMap : undefined,
      });

      setProgressPct(100);
      setProcessingStep('Analysis complete');
      setSummary(res.validation_summary);
      onImported(res.activeDatasetId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process uploaded file.');
      setProcessingStep(null);
      setProgressPct(0);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#151F30] border border-[#263449] rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 bg-[#101827] border-b border-[#263449] flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-[#F1F5F9]">
              Upload Transaction Data
            </h2>
            <p className="text-xs text-[#94A3B8] mt-0.5">
              Import CSV or Excel (.xlsx) statements, confirm column mapping, and run automated mule network detection.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-[#1E293B] text-[#94A3B8] hover:text-white"
            aria-label="Close upload dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Quick Templates & Demo Shortcut */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#263449]">
            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <a
                href="/api/templates/transactions"
                download="muleshield_transactions_template.csv"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#101827] hover:bg-[#1C2940] text-[#F1F5F9] border border-[#263449]"
              >
                <Download className="w-3.5 h-3.5 text-[#3B82F6]" />
                <span>Sample Transactions CSV</span>
              </a>
              <a
                href="/api/templates/complaints"
                download="muleshield_complaints_template.csv"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#101827] hover:bg-[#1C2940] text-[#94A3B8] hover:text-[#F1F5F9] border border-[#263449]"
              >
                <Download className="w-3.5 h-3.5 text-[#94A3B8]" />
                <span>Sample Complaints CSV</span>
              </a>
            </div>
            <button
              type="button"
              onClick={async () => {
                await onLoadDemo();
                onClose();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#101827] hover:bg-[#1C2940] text-[#3B82F6] border border-[#3B82F6]/30"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reload 50-Complaint Demo Data</span>
            </button>
          </div>

          {/* Dataset Name */}
          <div>
            <label className="block text-xs font-medium text-[#F1F5F9] mb-1.5">
              Dataset / Batch Label
            </label>
            <input
              type="text"
              value={datasetName}
              onChange={(e) => setDatasetName(e.target.value)}
              className="w-full bg-[#0B1120] border border-[#263449] focus:border-[#3B82F6] rounded-md px-3 py-2 text-xs text-[#F1F5F9] focus:outline-none"
            />
          </div>

          {/* Step 1: Drag-and-Drop Transaction File */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0] ?? null;
              handleSelectFile('transactions', f);
            }}
            className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
              dragging
                ? 'border-[#3B82F6] bg-[#3B82F6]/10'
                : 'border-[#263449] bg-[#0B1120] hover:border-[#3B82F6]/50'
            }`}
          >
            <FileSpreadsheet className="w-7 h-7 text-[#3B82F6] mx-auto mb-2.5" />
            <div className="text-sm font-medium text-[#F1F5F9]">
              {txFile ? txFile.fileName : 'Drag and drop a transaction CSV or Excel (.xlsx) file here'}
            </div>
            <p className="text-xs text-[#94A3B8] mt-1">
              Supported formats: <span className="font-mono text-[#F1F5F9]">.csv, .xlsx, .xls</span> · Expected columns: Transaction ID, Sender Account, Receiver Account, Amount, Timestamp, Transaction Type, Reference Number
            </p>
            <label className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold bg-[#151F30] hover:bg-[#1E2B42] text-[#F1F5F9] border border-[#263449] cursor-pointer">
              <Upload className="w-3.5 h-3.5 text-[#3B82F6]" />
              <span>{txFile ? 'Replace File' : 'Browse Files'}</span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,text/csv"
                className="hidden"
                onChange={(e) => handleSelectFile('transactions', e.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          {/* Optional Fraud Complaints File */}
          <div className="bg-[#101827] border border-[#263449] rounded-md p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-[#F1F5F9]">
                  Optional: Attach Fraud Complaints File (CSV / XLSX)
                </div>
                <p className="text-[11px] text-[#94A3B8] mt-0.5">
                  Attach victim complaints to link specific reported transactions, or leave blank to automatically trace top high-value transfers.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowOptionalComplaints((v) => !v)}
                className="text-xs font-medium text-[#3B82F6] hover:underline whitespace-nowrap ml-3"
              >
                {showOptionalComplaints || cmpFile ? 'Hide' : 'Attach Complaints File'}
              </button>
            </div>
            {(showOptionalComplaints || cmpFile) && (
              <div className="mt-3 pt-3 border-t border-[#263449] flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-mono text-[#94A3B8]">
                  {cmpFile
                    ? `${cmpFile.fileName} (${cmpFile.rows.length} complaints)`
                    : 'No complaints file selected'}
                </span>
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#151F30] hover:bg-[#1E2B42] text-[#F1F5F9] border border-[#263449] cursor-pointer">
                  <Upload className="w-3.5 h-3.5 text-[#3B82F6]" />
                  <span>Select Complaints File</span>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls,text/csv"
                    className="hidden"
                    onChange={(e) => handleSelectFile('complaints', e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            )}
          </div>

          {/* Step 2: Field Mapping & Quality Warnings */}
          {txFile && (
            <div className="space-y-4">
              {/* Data Quality Summary Strip */}
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="bg-[#101827] border border-[#263449] rounded-md p-3">
                  <div className="text-[11px] text-[#94A3B8]">Records Detected</div>
                  <div className="text-base font-bold font-mono tabular-nums text-[#F1F5F9] mt-0.5">
                    {txFile.rows.length.toLocaleString('en-IN')}
                  </div>
                </div>
                <div className="bg-[#101827] border border-[#263449] rounded-md p-3">
                  <div className="text-[11px] text-[#94A3B8]">Duplicate Transaction IDs</div>
                  <div
                    className={`text-base font-bold font-mono tabular-nums mt-0.5 ${
                      txFile.duplicateCount > 0 ? 'text-[#EAB308]' : 'text-[#22C55E]'
                    }`}
                  >
                    {txFile.duplicateCount}
                  </div>
                </div>
                <div className="bg-[#101827] border border-[#263449] rounded-md p-3">
                  <div className="text-[11px] text-[#94A3B8]">Rows with Data Warnings</div>
                  <div
                    className={`text-base font-bold font-mono tabular-nums mt-0.5 ${
                      txFile.missingFieldRows > 0 ? 'text-[#F97316]' : 'text-[#22C55E]'
                    }`}
                  >
                    {txFile.missingFieldRows}
                  </div>
                </div>
              </div>

              {/* Field Mapping Grid */}
              <div className="bg-[#101827] border border-[#263449] rounded-md p-4">
                <div className="text-xs font-semibold text-[#F1F5F9] mb-3">
                  Confirm Transaction Field Mapping
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {TRANSACTION_FIELDS.map((field) => (
                    <div key={field.key}>
                      <label className="block text-[11px] text-[#94A3B8] mb-1">
                        {field.label}
                        {field.required && <span className="text-[#EF4444] ml-0.5">*</span>}
                      </label>
                      <select
                        value={txMap[field.key] ?? ''}
                        onChange={(e) =>
                          setTxMap((prev) => ({ ...prev, [field.key]: e.target.value }))
                        }
                        className="w-full bg-[#0B1120] border border-[#263449] rounded px-2 py-1.5 text-xs text-[#F1F5F9]"
                      >
                        <option value="">-- Not Mapped --</option>
                        {txFile.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview First 20 Rows */}
              <div className="bg-[#101827] border border-[#263449] rounded-md overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[#263449] text-xs font-semibold text-[#F1F5F9]">
                  Preview Uploaded Transactions (First 20 Rows)
                </div>
                <div className="overflow-x-auto max-h-52">
                  <table className="w-full text-left text-[11px] font-mono">
                    <thead className="bg-[#0B1120] text-[#94A3B8] sticky top-0">
                      <tr>
                        {txFile.headers.map((h) => (
                          <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1D2A3F]">
                      {txFile.rows.slice(0, 20).map((row, i) => (
                        <tr key={i} className="hover:bg-[#151F30]">
                          {txFile.headers.map((h) => (
                            <td key={h} className="px-3 py-1.5 text-[#E2E8F0] whitespace-nowrap">
                              {String(row[h] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Processing Progress */}
          {processingStep && (
            <div className="bg-[#101827] border border-[#263449] rounded-md p-4 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-[#F1F5F9] font-medium">
                  {progressPct < 100 ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#3B82F6]" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#22C55E]" />
                  )}
                  {processingStep}
                </span>
                <span className="font-mono text-[#94A3B8]">{progressPct}%</span>
              </div>
              <div className="h-1.5 bg-[#0B1120] rounded overflow-hidden">
                <div
                  className="h-full bg-[#3B82F6] transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {/* Error & Validation Result */}
          {error && (
            <div className="p-3.5 rounded-md bg-[#EF4444]/10 border border-[#EF4444]/40 flex items-start gap-2.5 text-xs text-red-200">
              <AlertCircle className="w-4 h-4 text-[#EF4444] shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {summary && (
            <div className="p-4 rounded-md bg-[#22C55E]/10 border border-[#22C55E]/35 text-xs space-y-1.5">
              <div className="font-semibold text-[#22C55E] flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>Import &amp; Graph Analysis Complete</span>
              </div>
              <div className="text-[#E2E8F0] font-mono text-[11px]">
                Imported {summary.transactions_imported} transactions · {summary.complaints_imported}{' '}
                reported leads · Skipped {summary.duplicate_transaction_ids} duplicates · Flagged{' '}
                {summary.non_success_transactions.failed +
                  summary.non_success_transactions.reversed +
                  summary.non_success_transactions.pending}{' '}
                non-settled rows.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-[#101827] border-t border-[#263449] flex items-center justify-between">
          <span className="text-[11px] text-[#94A3B8]">
            Synthetic / uploaded records are analyzed locally and never sent to live banking networks.
          </span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-md text-xs font-medium text-[#94A3B8] hover:text-white hover:bg-[#1E293B]"
            >
              {summary ? 'Done' : 'Cancel'}
            </button>
            <button
              type="button"
              disabled={!txFile || (processingStep !== null && progressPct < 100)}
              onClick={handleProcessUpload}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold bg-[#3B82F6] hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Confirm Mapping &amp; Process</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
