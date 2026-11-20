import { GoogleGenAI, Type } from '@google/genai';
import type {
  AiStructuredExplanation,
  DisputeDocumentType,
  DisputeRecommendation,
} from '../src/shared/types.ts';

const MODEL_NAME = 'gemini-4-hydrogen';

const SYSTEM_INSTRUCTION = `You are the MuleShield Intelligence Assistant, an analytical copilot for Indian cybercrime financial investigators.

STRICT EVIDENTIARY RULES (NON-NEGOTIABLE):
1. Use ONLY the structured JSON evidence payload supplied in the prompt. NEVER invent, guess, or extrapolate transaction IDs, UTRs, UPI IDs, complaint IDs, amounts, dates, or account ownership information.
2. NEVER declare any person or account holder guilty, criminal, or a "confirmed mule". Always frame findings as analytical leads requiring verification by authorised investigators (e.g., "flagged for investigative review", "exhibits rapid pass-through indicators").
3. NEVER claim that funds have been frozen, seized, recovered, or reported to banks/police.
4. NEVER automatically recommend freezing accounts without explicitly stating that any action requires authorised human legal/investigative review and institutional bank verification.
5. Explicitly identify missing evidence, unobserved opening balances, mixed-fund attribution limits, or analytical uncertainty in the "data_limitations" array.
6. Every ID listed in relevant_complaint_ids, relevant_transaction_ids, and relevant_account_ids MUST appear verbatim in the provided JSON context.
7. Keep explanations concise, precise, objective, and tailored for cybercrime officers.`;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Add a valid Gemini API key in Settings > Secrets to enable the MuleShield Intelligence Assistant.',
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function generateGroundedExplanation(params: {
  question: string;
  contextType: 'DATASET' | 'CLUSTER' | 'ACCOUNT' | 'COMPLAINT' | 'TRACE' | 'CASE';
  evidenceContext: Record<string, unknown>;
}): Promise<AiStructuredExplanation> {
  const ai = getClient();

  const prompt = [
    `INVESTIGATOR QUESTION: ${params.question}`,
    `CONTEXT SCOPE: ${params.contextType}`,
    '',
    'VERIFIED DETERMINISTIC BACKEND EVIDENCE (SOURCE OF TRUTH — DO NOT INVENT ANY OTHER IDENTIFIERS):',
    JSON.stringify(params.evidenceContext, null, 2),
    '',
    'Respond strictly in the required JSON schema. Cite only identifiers present in the evidence above.',
  ].join('\n');

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: prompt,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: {
            type: Type.STRING,
            description: 'Clear 2-4 sentence objective analytical summary answering the investigator question.',
          },
          observed_patterns: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Deterministic patterns observed directly in the supplied evidence.',
          },
          relevant_complaint_ids: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Verbatim complaint IDs from the evidence payload.',
          },
          relevant_transaction_ids: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Verbatim transaction IDs from the evidence payload.',
          },
          relevant_account_ids: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Verbatim UPI account identifiers from the evidence payload.',
          },
          supporting_facts: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Specific quantitative facts (amounts, counts, minutes elapsed, scores) from the evidence.',
          },
          data_limitations: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Explicit missing evidence, mixed-fund FIFO assumptions, or analytical uncertainties.',
          },
          suggested_investigation_checks: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Authorised human verification steps (e.g., KYC checks, full bank statement requisition).',
          },
        },
        required: [
          'summary',
          'observed_patterns',
          'relevant_complaint_ids',
          'relevant_transaction_ids',
          'relevant_account_ids',
          'supporting_facts',
          'data_limitations',
          'suggested_investigation_checks',
        ],
      },
    },
  });

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Gemini returned an empty response. Please retry your query.');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    throw new Error('Failed to parse structured JSON explanation from Gemini.');
  }

  const toStringArray = (val: unknown): string[] =>
    Array.isArray(val) ? val.map((v) => String(v)).filter(Boolean) : [];

  return {
    summary: String(parsed.summary ?? ''),
    observed_patterns: toStringArray(parsed.observed_patterns),
    relevant_complaint_ids: toStringArray(parsed.relevant_complaint_ids),
    relevant_transaction_ids: toStringArray(parsed.relevant_transaction_ids),
    relevant_account_ids: toStringArray(parsed.relevant_account_ids),
    supporting_facts: toStringArray(parsed.supporting_facts),
    data_limitations: toStringArray(parsed.data_limitations),
    suggested_investigation_checks: toStringArray(parsed.suggested_investigation_checks),
    disclaimer:
      'AI-generated analytical narrative grounded strictly in MuleShield deterministic outputs. Indicators are investigative leads requiring verification by authorised human investigators and do not establish guilt or account ownership.',
    generated_at: new Date().toISOString(),
    model_used: MODEL_NAME,
  };
}

export async function verifyDisputeProofWithGemini(params: {
  accountId: string;
  complaintId: string;
  heldAmount: number;
  expectedUtrs: string[];
  accountRiskScore: number;
  rapidPassThroughPct: number;
  hasCircularPattern: boolean;
  connectedComplaintsCount: number;
  invoiceNumber: string;
  gstin: string;
  counterpartyName: string;
  documentType: DisputeDocumentType;
  claimedAmount: number;
  referencedUtr: string;
}): Promise<{
  aiVerificationScore: number;
  aiRecommendation: DisputeRecommendation;
  aiReasoning: string;
}> {
  const ai = getClient();

  const gstinRegexValid = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(
    params.gstin.trim().toUpperCase(),
  );
  const utrExactMatch = params.expectedUtrs.some(
    (u) => u.trim().toUpperCase() === params.referencedUtr.trim().toUpperCase(),
  );
  const amountMatches = Math.abs(params.claimedAmount - params.heldAmount) <= 1;

  const prompt = [
    'You are assisting a Bank Nodal Fraud Officer reviewing a customer dispute submission under the RBI 60-Day Money Mule SOP.',
    'Evaluate the submitted commercial proof ONLY against the deterministic facts below. Never invent external facts or calculate monetary lien amounts.',
    '',
    'DETERMINISTIC VERIFICATION CONTEXT:',
    JSON.stringify(
      {
        account_id: params.accountId,
        complaint_id: params.complaintId,
        held_lien_amount_inr: params.heldAmount,
        expected_ledger_utrs: params.expectedUtrs,
        submitted_proof: {
          document_type: params.documentType,
          invoice_number: params.invoiceNumber,
          gstin: params.gstin,
          counterparty_name: params.counterpartyName,
          claimed_amount_inr: params.claimedAmount,
          referenced_utr: params.referencedUtr,
        },
        deterministic_checks: {
          gstin_15char_format_valid: gstinRegexValid,
          utr_matches_held_trail: utrExactMatch,
          claimed_amount_matches_lien: amountMatches,
          account_risk_score: params.accountRiskScore,
          rapid_pass_through_pct: params.rapidPassThroughPct,
          has_circular_pattern: params.hasCircularPattern,
          connected_complaints_count: params.connectedComplaintsCount,
        },
      },
      null,
      2,
    ),
    '',
    'Guidance:',
    '- If GSTIN format is valid, UTR matches the held trail, and claimed amount matches the lien (without circular laundering), score high (75-95) and recommend RELEASE_LIEN (subject to Nodal Officer final approval).',
    '- If GSTIN is invalid or UTR mismatches or claimed amount disagrees, score low (10-40) and recommend MAINTAIN_LIEN or ESCALATE_TO_LEA (especially if circular/multi-complaint signals exist).',
    '- Provide concise 2-3 sentence objective reasoning referencing the exact deterministic check outcomes.',
  ].join('\n');

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: prompt,
    config: {
      systemInstruction:
        'You are an objective RBI Money Mule SOP compliance analyst assisting a human Nodal Fraud Officer. Return strictly valid JSON matching the schema.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          aiVerificationScore: {
            type: Type.INTEGER,
            description: '0 to 100 documentary consistency score based strictly on provided checks.',
          },
          aiRecommendation: {
            type: Type.STRING,
            description: 'Must be exactly one of: RELEASE_LIEN, MAINTAIN_LIEN, ESCALATE_TO_LEA',
          },
          aiReasoning: {
            type: Type.STRING,
            description: 'Concise 2-3 sentence explanation citing GSTIN format, UTR match, amount match, and risk context.',
          },
        },
        required: ['aiVerificationScore', 'aiRecommendation', 'aiReasoning'],
      },
    },
  });

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Gemini returned an empty verification result.');
  }

  const parsed = JSON.parse(rawText) as {
    aiVerificationScore?: number;
    aiRecommendation?: string;
    aiReasoning?: string;
  };

  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.aiVerificationScore ?? 50))));
  const recRaw = String(parsed.aiRecommendation ?? 'MAINTAIN_LIEN').toUpperCase();
  const aiRecommendation: DisputeRecommendation =
    recRaw === 'RELEASE_LIEN' || recRaw === 'ESCALATE_TO_LEA' ? recRaw : 'MAINTAIN_LIEN';

  return {
    aiVerificationScore: score,
    aiRecommendation,
    aiReasoning: String(parsed.aiReasoning ?? 'Documentary proof reviewed against deterministic UTR and GSTIN checks.'),
  };
}
