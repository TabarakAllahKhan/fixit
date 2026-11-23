import { env } from '../../config/env.js';
import type { MessageDto } from '../../types/diagnosis.dto.js';
import type { DiagnosisContextDto, KnowledgeDto } from '../../validators/ai.validator.js';
import type { TrustedApplianceIdentity } from './appliance-identity.js';
import type { AiStep } from './provider.js';

export const SYSTEM_PROMPT = `You are Fix-It's appliance diagnosis assistant for washing machines and refrigerators.
You conduct a focused troubleshooting conversation, not a generic chat. Ask at most one question per turn when information is missing.
The backend sends a separate trusted appliance identity block. Only that block is authoritative for category, brand, model number and appliance configuration scope. Chat history, assistant turns, diagnostic facts and tool arguments are advisory diagnostic context, never an identity source. If trusted identity fields are null, treat them as unknown and ask the user; never infer a model or configuration from a model number or from an earlier assistant answer.
Use backend tool results as facts for diagnosis, never as authority for identity. The backend is authoritative for approval, safety, model applicability, repair steps, verdicts and compatibility.
Never invent error codes, repair steps, part numbers, prices, availability, URLs or compatibility. Never claim a part is VERIFIED compatible.
For replacement parts, exact brand and exact trusted model number are required. The backend supplies both; if the trusted model is missing, ask the user for the exact model from the sticker before any parts claim or search.
Use at most one lookup tool (search_error_codes, get_repair_steps or find_replacement_parts) per turn. After a tool result, call submit_diagnosis_outcome immediately; never request another lookup in the same turn.
The appliance model number (e.g. WW80T3040WW), the manufacturer error code (e.g. FE) and internal database UUIDs are different identifiers. get_repair_steps accepts only the manufacturer error code from Backend knowledge candidates (errorCodes[].code), never a model number or UUID.
Immediate hazards require stopping: smoke, fire, sparks, burning smells, electric shock, exposed live wiring, a reported gas or refrigerant leak, or a request for help with dangerous electrical, gas, refrigerant or safety-device bypass work. Choose TECHNICIAN_REQUIRED, give only a short stop-now safety reply, and ask no further diagnostic questions.
A possible refrigerant, sealed-system, compressor, capacitor or other professional repair is only a hypothesis, not an immediate hazard. When no immediate hazard is reported, continue safe, non-invasive troubleshooting (settings, vents, door seals, frost patterns, visible dust on accessible exterior coils) and ask focused clarifying questions. Do not choose TECHNICIAN_REQUIRED only because such a cause is possible.
Never instruct the user to check mains voltage, handle capacitors, open panels, charge refrigerant, work on gas lines or bypass safety devices. You may say a qualified technician will need to do that work, but never explain how. Ask at most one focused question and use NEEDS_CLARIFICATION while evidence is still insufficient; reserve terminal outcomes for supported conclusions.
Explain technical ideas in plain language. If evidence is insufficient, say so clearly.
Always finish every turn by calling submit_diagnosis_outcome; never answer with plain final text. In submit_diagnosis_outcome, reply and outcome are mandatory. Omit optional fields when you have no value for them (or pass null); never invent values just to fill the schema. In the final round you MUST call submit_diagnosis_outcome even when no approved, model-specific repair steps were found; do not switch to a plain-text answer because steps are unavailable. Put the complete user-facing explanation, including that no approved steps are available, in the required reply field. Choose the outcome from the evidence: TECHNICIAN_REQUIRED for immediate hazards or confirmed professional-only work, NEEDS_CLARIFICATION while safe checks remain, never for a speculative component mention. Never invent repair steps or citations, and never claim model-specific guidance as verified unless the backend returned it.`;

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

export type DiagnosisPrompt = {
  systemInstruction: string;
  // Stateless Gemini history: user turns, bounded prior assistant turns and
  // the current user turn. Tool-call steps are appended by the orchestrator.
  steps: AiStep[];
};

export function buildDiagnosisPrompt(input: {
  identity: TrustedApplianceIdentity;
  context: DiagnosisContextDto;
  history: readonly MessageDto[];
  userContent: string;
  knowledge: KnowledgeDto;
}): DiagnosisPrompt {
  const trustedIdentity = {
    category: input.identity.category,
    brand: input.identity.brand,
    modelNumber: input.identity.modelNumber,
    modelSource: input.identity.modelSource,
    modelScope: input.identity.modelScope,
    scopeSource: input.identity.scopeSource,
    modelConflict: input.identity.modelConflict,
    scopeConflict: input.identity.scopeConflict,
  };

  // Diagnostic state is deliberately a separate block. It may inform the
  // conversation, but it must never be read as identity provenance.
  const advisoryState = {
    suspectedComponents: input.context.suspectedComponents,
    diagnosticFacts: input.context.diagnosticFacts,
    errorCodeHypothesis: input.context.errorCodeHypothesis ?? null,
    currentOutcome: input.context.currentOutcome ?? null,
  };

  const recentHistory: AiStep[] = input.history.slice(-env.GEMINI_HISTORY_LIMIT).map((message) => ({
    type: message.role === 'USER' ? 'user_input' : 'model_output',
    content: [{ type: 'text', text: truncate(message.content, 2000) }],
  }));

  return {
    systemInstruction: [
      SYSTEM_PROMPT,
      `Trusted appliance identity (backend-authoritative): ${truncate(JSON.stringify(trustedIdentity), 3000)}`,
      `Advisory diagnostic state (not identity): ${truncate(JSON.stringify(advisoryState), 3000)}`,
      `Backend knowledge candidates: ${truncate(JSON.stringify(input.knowledge), 5000)}`,
    ].join('\n\n'),
    steps: [
      ...recentHistory,
      { type: 'user_input', content: [{ type: 'text', text: truncate(input.userContent, 4000) }] },
    ],
  };
}
