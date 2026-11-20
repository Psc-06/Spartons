import React, { useState } from 'react';
import { AlertTriangle, HelpCircle, X } from 'lucide-react';
import type { RiskCategory, RiskTier } from '../shared/types';

export function computeRiskTier(score: number): RiskTier {
  if (score >= 85) return 'CRITICAL';
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

export function riskTierColor(tier: RiskTier | RiskCategory): string {
  switch (tier) {
    case 'CRITICAL':
      return 'text-[#EF4444]';
    case 'HIGH':
      return 'text-[#F97316]';
    case 'MEDIUM':
      return 'text-[#EAB308]';
    default:
      return 'text-[#22C55E]';
  }
}

export function riskTierHex(tier: RiskTier | RiskCategory): string {
  switch (tier) {
    case 'CRITICAL':
      return '#EF4444';
    case 'HIGH':
      return '#F97316';
    case 'MEDIUM':
      return '#EAB308';
    default:
      return '#22C55E';
  }
}

/**
 * Clean, restrained semantic risk indicator (text + score, never gaudy candy pills).
 */
export const RiskIndicator: React.FC<{
  score: number;
  showScore?: boolean;
  className?: string;
}> = ({ score, showScore = true, className = '' }) => {
  const tier = computeRiskTier(score);
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs font-semibold tabular-nums ${riskTierColor(tier)} ${className}`}>
      {showScore && <span>{score}</span>}
      {showScore && <span className="text-[#475569]">·</span>}
      <span>{tier}</span>
    </span>
  );
};

/**
 * Plain-English contextual tooltip for complex financial investigation terms.
 */
export const InfoTooltip: React.FC<{
  text: string;
  label?: string;
}> = ({ text, label = 'More information' }) => {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-flex items-center align-middle ml-1"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={label}
        className="text-[#64748B] hover:text-[#94A3B8] focus:outline-none"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-64 p-2.5 rounded-md bg-[#0B1120] border border-[#364966] text-[11px] leading-relaxed text-[#E2E8F0] font-normal shadow-xl pointer-events-none whitespace-normal text-left"
        >
          {text}
        </span>
      )}
    </span>
  );
};

/**
 * Confirmation dialog for destructive or high-impact investigative actions.
 */
export const ConfirmDialog: React.FC<{
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = true,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-[#151F30] border border-[#263449] rounded-lg w-full max-w-md overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-[#263449] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AlertTriangle
              className={`w-4 h-4 shrink-0 ${destructive ? 'text-[#EF4444]' : 'text-[#EAB308]'}`}
            />
            <h3 className="text-sm font-semibold text-[#F1F5F9]">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-[#94A3B8] hover:text-white"
            aria-label="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 text-xs text-[#94A3B8] leading-relaxed">{description}</div>
        <div className="px-5 py-3.5 bg-[#101827] border-t border-[#263449] flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-2 rounded-md text-xs font-medium text-[#94A3B8] hover:text-white hover:bg-[#1E293B]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 rounded-md text-xs font-semibold text-white transition-colors ${
              destructive
                ? 'bg-[#EF4444] hover:bg-red-500'
                : 'bg-[#3B82F6] hover:bg-blue-500'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
