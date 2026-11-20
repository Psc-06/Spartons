import React, { useState } from 'react';
import { AlertTriangle, Loader2, Send, ShieldAlert, Sparkles, X } from 'lucide-react';
import type { AiStructuredExplanation } from '../shared/types';
import { api } from '../lib/api';

export interface AiContextTarget {
  contextType: 'DATASET' | 'CLUSTER' | 'ACCOUNT' | 'COMPLAINT' | 'TRACE' | 'CASE';
  entityId?: string;
  label: string;
}

interface AiAssistantDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  datasetId: string;
  contextTarget: AiContextTarget;
  onJumpToAccount: (upiId: string) => void;
  onJumpToComplaint: (complaintId: string) => void;
}

const SUGGESTED_QUESTIONS: Record<AiContextTarget['contextType'], string[]> = {
  DATASET: [
    'Which accounts appear in the largest number of complaints?',
    'What suspicious transaction patterns are present across the clusters?',
    'Which transaction references should an investigator examine first?',
    'Summarise the top connected mule-like networks for an investigation briefing.',
  ],
  CLUSTER: [
    'Summarise this network for an investigation report.',
    'How are multiple complaints connected inside this cluster?',
    'Which accounts in this cluster require urgent investigative review and why?',
    'What evidence is missing or uncertain in this cluster?',
  ],
  ACCOUNT: [
    'Why has this account been flagged?',
    'Which complaints are connected to this account?',
    'Which transaction references should an investigator examine for this account?',
    'What data limitations should be noted before escalating this account?',
  ],
  COMPLAINT: [
    'Show me how the money moved after the original transaction.',
    'Are mixed funds or attribution limitations present in this trace?',
    'Which downstream accounts received potentially linked funds?',
  ],
  TRACE: [
    'Show me how the money moved after the original transaction.',
    'What suspicious transaction patterns are present in this flow?',
    'What data limitations affect this FIFO attribution trace?',
  ],
  CASE: [
    'Summarise this case for a preliminary investigation report.',
    'Which transaction references and accounts are highest priority in this case?',
    'What verification steps should an investigator perform next?',
  ],
};

export const AiAssistantDrawer: React.FC<AiAssistantDrawerProps> = ({
  isOpen,
  onClose,
  datasetId,
  contextTarget,
  onJumpToAccount,
  onJumpToComplaint,
}) => {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<
    Array<{ question: string; contextLabel: string; answer: AiStructuredExplanation }>
  >([]);

  if (!isOpen) return null;

  const submitQuestion = async (qText: string) => {
    const trimmed = qText.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    setQuestion('');
    try {
      const answer = await api.explainWithAi({
        datasetId,
        question: trimmed,
        contextType: contextTarget.contextType,
        entityId: contextTarget.entityId,
      });
      setHistory((prev) => [
        { question: trimmed, contextLabel: contextTarget.label, answer },
        ...prev,
      ]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to reach Intelligence Assistant.',
      );
    } finally {
      setLoading(false);
    }
  };

  const prompts = SUGGESTED_QUESTIONS[contextTarget.contextType] ?? SUGGESTED_QUESTIONS.DATASET;

  return (
    <div className="no-print fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-[#101827] border-l border-[#263449] shadow-2xl flex flex-col">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#263449] flex items-center justify-between bg-[#151F30]">
        <div className="flex items-center gap-2.5 min-w-0">
          <Sparkles className="w-4 h-4 text-[#3B82F6] shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[#F1F5F9] truncate">
              MuleShield AI Assistant
            </h2>
            <p className="text-[11px] text-[#94A3B8] truncate">
              Scope: {contextTarget.label} · Grounded in deterministic ledger records
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded hover:bg-[#1E2B42] text-[#94A3B8] hover:text-white"
          aria-label="Close assistant"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Evidentiary Guardrail Banner */}
      <div className="px-5 py-2.5 bg-[#0B1120] border-b border-[#263449] text-[11px] text-[#94A3B8] flex items-start gap-2">
        <ShieldAlert className="w-3.5 h-3.5 text-[#3B82F6] shrink-0 mt-0.5" />
        <span>
          Explains verified analytical findings only. Cannot invent transaction IDs, declare guilt, or initiate account actions.
        </span>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        <div>
          <div className="text-[11px] font-semibold text-[#94A3B8] mb-2">
            Suggested Investigator Queries
          </div>
          <div className="grid grid-cols-1 gap-2">
            {prompts.map((p) => (
              <button
                key={p}
                type="button"
                disabled={loading}
                onClick={() => submitQuestion(p)}
                className="text-left px-3 py-2 rounded-md text-xs text-[#F1F5F9] bg-[#151F30] hover:bg-[#1E2B42] border border-[#263449] transition-colors disabled:opacity-50"
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="p-4 rounded-md bg-[#151F30] border border-[#3B82F6]/40 flex items-center gap-3 text-xs text-[#93C5FD]">
            <Loader2 className="w-4 h-4 animate-spin text-[#3B82F6] shrink-0" />
            <span>Synthesizing verified backend evidence...</span>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-md bg-[#EF4444]/10 border border-[#EF4444]/40 flex items-start gap-2.5 text-xs text-red-200">
            <AlertTriangle className="w-4 h-4 text-[#EF4444] shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-red-300">Assistant Unavailable</div>
              <p className="mt-1">{error}</p>
            </div>
          </div>
        )}

        {history.map((item, idx) => {
          const ans = item.answer;
          return (
            <div
              key={idx}
              className="rounded-md bg-[#151F30] border border-[#263449] divide-y divide-[#263449]"
            >
              <div className="px-4 py-3 bg-[#101827]">
                <div className="text-[11px] text-[#94A3B8]">Query · {item.contextLabel}</div>
                <div className="text-xs font-semibold text-[#F1F5F9] mt-0.5">
                  {item.question}
                </div>
              </div>

              <div className="p-4 space-y-4 text-xs">
                <div>
                  <div className="text-[11px] font-semibold text-[#3B82F6] mb-1">
                    Analytical Explanation (AI-Generated)
                  </div>
                  <p className="text-[#E2E8F0] leading-relaxed">{ans.summary}</p>
                </div>

                {ans.observed_patterns.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold text-[#94A3B8] mb-1">
                      Observed Patterns
                    </div>
                    <ul className="list-disc pl-4 space-y-1 text-[#CBD5E1]">
                      {ans.observed_patterns.map((pat, i) => (
                        <li key={i}>{pat}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {ans.supporting_facts.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold text-[#94A3B8] mb-1">
                      Supporting Facts from Source Ledger
                    </div>
                    <ul className="list-disc pl-4 space-y-1 text-[#CBD5E1]">
                      {ans.supporting_facts.map((fact, i) => (
                        <li key={i}>{fact}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-2.5 pt-2 border-t border-[#263449]">
                  {ans.relevant_account_ids.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold text-[#94A3B8] mb-1">
                        Referenced Accounts
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px]">
                        {ans.relevant_account_ids.map((id) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => onJumpToAccount(id)}
                            className="text-[#3B82F6] hover:underline"
                          >
                            {id}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {ans.relevant_complaint_ids.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold text-[#94A3B8] mb-1">
                        Referenced Complaints
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px]">
                        {ans.relevant_complaint_ids.map((id) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => onJumpToComplaint(id)}
                            className="text-[#93C5FD] hover:underline"
                          >
                            {id}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {ans.relevant_transaction_ids.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold text-[#94A3B8] mb-1">
                        Referenced Transaction IDs
                      </div>
                      <div className="font-mono text-[11px] text-[#CBD5E1] leading-relaxed">
                        {ans.relevant_transaction_ids.join(' · ')}
                      </div>
                    </div>
                  )}
                </div>

                {ans.data_limitations.length > 0 && (
                  <div className="p-3 rounded bg-[#EAB308]/10 border border-[#EAB308]/30">
                    <div className="text-[11px] font-semibold text-[#EAB308] mb-1">
                      Data Limitations &amp; Analytical Uncertainty
                    </div>
                    <ul className="list-disc pl-4 space-y-1 text-[11px] text-amber-100/90">
                      {ans.data_limitations.map((lim, i) => (
                        <li key={i}>{lim}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {ans.suggested_investigation_checks.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold text-[#94A3B8] mb-1">
                      Recommended Verification Checks
                    </div>
                    <ul className="list-disc pl-4 space-y-1 text-[#CBD5E1]">
                      {ans.suggested_investigation_checks.map((chk, i) => (
                        <li key={i}>{chk}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="text-[10px] text-[#64748B] pt-2 border-t border-[#263449]">
                  {ans.disclaimer} ({ans.model_used})
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Input Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitQuestion(question);
        }}
        className="p-4 border-t border-[#263449] bg-[#151F30] flex items-center gap-2"
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about flagged accounts, fund trails, or network links..."
          className="flex-1 bg-[#0B1120] border border-[#263449] focus:border-[#3B82F6] rounded-md px-3 py-2 text-xs text-[#F1F5F9] placeholder:text-[#64748B] focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold bg-[#3B82F6] hover:bg-blue-500 disabled:opacity-40 text-white transition-colors"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Ask</span>
        </button>
      </form>
    </div>
  );
};
