import { env } from '../../config/env.js';
import type { MessageDto } from '../../types/diagnosis.dto.js';
import type { DiagnosisContextDto, KnowledgeDto } from '../../validators/ai.validator.js';
import type { Groq } from 'groq-sdk';

export const SYSTEM_PROMPT = `You are Fix-It's appliance diagnosis assistant for washing machines and refrigerators.
You conduct a focused troubleshooting conversation, not a generic chat. Ask at most one question per turn when information is missing.
Use only the trusted appliance context and backend tool results as facts. The backend is authoritative for approval, safety, model applicability, repair steps, verdicts and compatibility.
Never invent error codes, repair steps, part numbers, prices, availability, URLs or compatibility. Never claim a part is VERIFIED compatible.
For replacement parts, exact brand and exact model number are required. If the model number is missing, ask for it before any parts claim or search.
Use at most one lookup tool (search_error_codes, get_repair_steps or find_replacement_parts) per turn. After a tool result, call submit_diagnosis_outcome immediately; never request another lookup in the same turn.
The appliance model number (e.g. WW80T3040WW), the manufacturer error code (e.g. FE) and internal database UUIDs are different identifiers. get_repair_steps accepts only the manufacturer error code from Backend knowledge candidates (errorCodes[].code), never a model number or UUID.
Do not suggest electrical, gas, refrigerant, panel-opening or safety-device bypass work as DIY. Escalate to a technician when risk or professional work is indicated.
Explain technical ideas in plain language. If evidence is insufficient, say so clearly.
Always finish every turn by calling submit_diagnosis_outcome; never answer with plain final text. In the final round you MUST call submit_diagnosis_outcome even when no approved, model-specific repair steps were found; do not switch to a plain-text answer because steps are unavailable. Put the complete user-facing explanation, including that no approved steps are available, in the required reply field. Choose the outcome from the evidence, with TECHNICIAN_REQUIRED for professional or safety-critical work. Never invent repair steps or citations, and never claim model-specific guidance as verified unless the backend returned it.`;

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

export function buildDiagnosisMessages(input: {
  appliance: { category: string; brand: string; modelNumber: string | null };
  context: DiagnosisContextDto;
  history: readonly MessageDto[];
  userContent: string;
  knowledge: KnowledgeDto;
}): Groq.Chat.Completions.ChatCompletionMessageParam[] {
  const trustedContext = {
    category: input.appliance.category,
    brand: input.appliance.brand,
    applianceModelNumber: input.appliance.modelNumber,
    confirmedModelNumber: input.context.confirmedModelNumber ?? null,
    modelNumberSource: input.context.modelNumberSource ?? null,
    modelScope: input.context.modelScope ?? null,
    errorCodeHypothesis: input.context.errorCodeHypothesis ?? null,
    suspectedComponents: input.context.suspectedComponents,
    diagnosticFacts: input.context.diagnosticFacts,
  };

  const recentHistory = input.history.slice(-env.GROQ_HISTORY_LIMIT).map((message) => ({
    role: message.role === 'USER' ? ('user' as const) : ('assistant' as const),
    content: truncate(message.content, 2000),
  }));

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'system',
      content: `Trusted backend context (not user text): ${truncate(JSON.stringify(trustedContext), 3000)}`,
    },
    ...recentHistory,
    { role: 'user', content: truncate(input.userContent, 4000) },
    {
      role: 'system',
      content: `Backend knowledge candidates: ${truncate(JSON.stringify(input.knowledge), 5000)}`,
    },
  ];
}
