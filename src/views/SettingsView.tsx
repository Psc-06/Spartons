import React, { useEffect, useState } from 'react';
import { CheckCircle2, RotateCcw, Save, ShieldCheck, Upload } from 'lucide-react';
import type { DatasetMetadata, RiskWeightsConfig } from '../shared/types';
import { api } from '../lib/api';
import { ConfirmDialog, InfoTooltip } from '../components/UiPrimitives';

interface SettingsViewProps {
  activeDataset: DatasetMetadata | null;
  onConfigUpdated: () => Promise<void>;
  onResetDemo: () => Promise<void>;
  onOpenUpload: () => void;
}

const DEFAULT_WEIGHTS: RiskWeightsConfig = {
  rapidPassThrough: 25,
  crossComplaintRecurrence: 25,
  fanIn: 15,
  fanOut: 15,
  transactionVelocity: 10,
  networkAndCircular: 10,
  mediumThreshold: 40,
  highThreshold: 70,
};

export const SettingsView: React.FC<SettingsViewProps> = ({
  activeDataset,
  onConfigUpdated,
  onResetDemo,
  onOpenUpload,
}) => {
  const [config, setConfig] = useState<RiskWeightsConfig>(DEFAULT_WEIGHTS);
  const [disclaimer, setDisclaimer] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  useEffect(() => {
    api
      .getRiskConfig()
      .then((res) => {
        setConfig(res.config);
        setDisclaimer(res.disclaimer);
      })
      .catch(() => {});
  }, []);

  const totalWeight =
    config.rapidPassThrough +
    config.crossComplaintRecurrence +
    config.fanIn +
    config.fanOut +
    config.transactionVelocity +
    config.networkAndCircular;

  const handleSave = async () => {
    setError(null);
    setSavedNotice(false);
    if (config.highThreshold <= config.mediumThreshold) {
      setError('High-priority threshold must exceed Medium-priority threshold.');
      return;
    }
    setSaving(true);
    try {
      await api.updateRiskConfig(config);
      await onConfigUpdated();
      setSavedNotice(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update configuration.');
    } finally {
      setSaving(false);
    }
  };

  const weightItems: Array<{
    key: keyof Omit<RiskWeightsConfig, 'mediumThreshold' | 'highThreshold'>;
    label: string;
    desc: string;
  }> = [
    {
      key: 'rapidPassThrough',
      label: 'Rapid Forwarding (≤ 60m)',
      desc: 'Share of settled incoming funds forwarded to another account within short windows.',
    },
    {
      key: 'crossComplaintRecurrence',
      label: 'Cross-Complaint Recurrence',
      desc: 'Count of distinct fraud complaints linked directly or through multi-hop trails.',
    },
    {
      key: 'fanIn',
      label: 'Fan-In Concentration',
      desc: 'Number of distinct sending accounts transferring into the same account.',
    },
    {
      key: 'fanOut',
      label: 'Fan-Out Dispersion',
      desc: 'Number of distinct downstream accounts receiving funds from the account.',
    },
    {
      key: 'transactionVelocity',
      label: 'Transaction Velocity',
      desc: 'Peak settled transfer count within 1-hour and 24-hour bursts.',
    },
    {
      key: 'networkAndCircular',
      label: 'Network & Circular Loops',
      desc: 'Multi-hop layering depth, cluster linkage, and circular return transfers.',
    },
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="pb-5 border-b border-[#263449]">
        <h1 className="text-xl font-semibold text-[#F1F5F9] tracking-tight">
          Settings &amp; Risk Engine
        </h1>
        <p className="text-xs text-[#94A3B8] mt-1">
          {disclaimer ||
            'Adjust deterministic risk weights and classification thresholds. Saving dynamically recalculates risk scores across the active dataset.'}
        </p>
      </div>

      {/* Risk Weights Configuration */}
      <div className="bg-[#151F30] border border-[#263449] rounded-md p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[#F1F5F9] flex items-center">
              <span>Explainable Risk Weights</span>
              <InfoTooltip text="Adjust how strongly each behavioral indicator influences an account's 0–100 score. Recommended total is 100 points." />
            </h2>
            <p className="text-xs text-[#94A3B8] mt-0.5">
              Configurable scoring model (recommended total = 100 pts). Never replaces human investigative review.
            </p>
          </div>
          <span
            className={`font-mono text-xs font-semibold ${
              totalWeight === 100 ? 'text-[#22C55E]' : 'text-[#EAB308]'
            }`}
          >
            Total Weight: {totalWeight} pts
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {weightItems.map((item) => (
            <div
              key={item.key}
              className="bg-[#101827] border border-[#263449] rounded-md p-3.5 space-y-2"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[#F1F5F9]">{item.label}</span>
                <span className="font-mono font-semibold text-[#3B82F6] tabular-nums">
                  {config[item.key]} pts
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={40}
                value={config[item.key]}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, [item.key]: Number(e.target.value) }))
                }
                className="w-full accent-[#3B82F6] cursor-pointer"
              />
              <div className="text-[11px] text-[#94A3B8]">{item.desc}</div>
            </div>
          ))}
        </div>

        {/* Threshold Cutoffs */}
        <div className="pt-4 border-t border-[#263449] grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#F1F5F9] mb-1.5">
              Medium Risk Cutoff (Default: 40)
            </label>
            <input
              type="number"
              min={10}
              max={80}
              value={config.mediumThreshold}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, mediumThreshold: Number(e.target.value) }))
              }
              className="w-full bg-[#0B1120] border border-[#263449] rounded-md px-3 py-2 text-xs font-mono text-[#EAB308]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#F1F5F9] mb-1.5">
              High Risk Cutoff (Default: 70)
            </label>
            <input
              type="number"
              min={20}
              max={95}
              value={config.highThreshold}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, highThreshold: Number(e.target.value) }))
              }
              className="w-full bg-[#0B1120] border border-[#263449] rounded-md px-3 py-2 text-xs font-mono text-[#F97316]"
            />
          </div>
        </div>

        {error && (
          <div className="p-3 rounded bg-[#EF4444]/10 border border-[#EF4444]/40 text-xs text-red-200">
            {error}
          </div>
        )}
        {savedNotice && (
          <div className="p-3 rounded bg-[#22C55E]/10 border border-[#22C55E]/35 flex items-center gap-2 text-xs text-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
            <span>Risk weights updated and all accounts recalculated.</span>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={() => setConfig(DEFAULT_WEIGHTS)}
            className="text-xs text-[#94A3B8] hover:text-[#F1F5F9] underline underline-offset-2"
          >
            Restore Defaults (25/25/15/15/10/10)
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold bg-[#3B82F6] hover:bg-blue-500 text-white"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Recalculating...' : 'Save & Recalculate'}</span>
          </button>
        </div>
      </div>

      {/* Workspace & Governance */}
      <div className="bg-[#151F30] border border-[#263449] rounded-md p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#F1F5F9]">
          <ShieldCheck className="w-4 h-4 text-[#3B82F6]" />
          <span>Data Provenance, Privacy &amp; Workspace Controls</span>
        </div>

        {activeDataset && (
          <div className="bg-[#101827] border border-[#263449] rounded-md p-4 text-xs space-y-1.5 font-mono">
            <div className="text-[#F1F5F9]">Active Dataset: {activeDataset.name}</div>
            <div className="text-[#94A3B8]">
              Provenance:{' '}
              {activeDataset.source_type === 'SYNTHETIC_DEMO'
                ? 'Synthetic Demonstration Dataset (@demo handles — not live bank data)'
                : 'Uploaded Investigation Dataset'}
            </div>
            <div className="text-[#94A3B8]">
              Validation: {activeDataset.validation_summary.complaints_imported} complaints ·{' '}
              {activeDataset.validation_summary.transactions_imported} transactions ·{' '}
              {activeDataset.validation_summary.duplicate_transaction_ids} duplicates skipped
            </div>
          </div>
        )}

        <ul className="list-disc pl-5 space-y-1 text-xs text-[#94A3B8]">
          <li>MuleShield is an analytical investigation platform and never connects to live banking or payment rails.</li>
          <li>MuleShield never initiates account freezes, reversals, or automated enforcement filings.</li>
          <li>AI summaries run strictly server-side and explain deterministic ledger records without inventing identifiers.</li>
        </ul>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            onClick={onOpenUpload}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold bg-[#3B82F6] hover:bg-blue-500 text-white"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload CSV / XLSX Data</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmResetOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium bg-[#101827] hover:bg-[#1E2B42] text-[#F1F5F9] border border-[#263449]"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#EF4444]" />
            <span>Reset 50-Complaint Demo Workspace</span>
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmResetOpen}
        title="Reset Demonstration Workspace?"
        description="Resetting restores the default 50-complaint synthetic dataset and resets demo cases back to their initial state. Any unsaved local edits in the demo cases will be replaced."
        confirmLabel="Reset Workspace"
        destructive={true}
        onCancel={() => setConfirmResetOpen(false)}
        onConfirm={async () => {
          setConfirmResetOpen(false);
          await onResetDemo();
        }}
      />
    </div>
  );
};
