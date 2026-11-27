import { prisma } from '../config/prisma.js';
import { ReviewStatus, SafetyClass } from '../generated/prisma/client.js';
import type { ApplianceCategory } from '../generated/prisma/enums.js';
import type {
  CitationDto,
  KnowledgeDto,
  RepairStepKnowledgeDto,
} from '../validators/ai.validator.js';

// The knowledge base is the only source of authoritative repair guidance.
// This service retrieves rows and applies approval/scope/safety rules; prompts
// never grant those permissions to the model.

export type KnowledgeApplianceContext = {
  // Legacy category on a trusted appliance row. Null means no reliable
  // category match is available, not "any category".
  category: ApplianceCategory | null;
  brand: string;
  modelScope?: 'UNSPECIFIED' | 'TOP_LOAD' | 'FRONT_LOAD' | 'FRENCH_DOOR_BOTTOM_FREEZER';
};

export type ApprovedRepairSequence = {
  eligible: boolean;
  reason?: string;
  errorCodeId?: string;
  steps: RepairStepKnowledgeDto[];
  citation?: CitationDto;
};

function toCitation(source: {
  title: string;
  url: string | null;
  kind: string;
}): CitationDto {
  return {
    title: source.title,
    ...(source.url ? { url: source.url } : {}),
    sourceKind: source.kind as CitationDto['sourceKind'],
  };
}

// Extract bounded code-like tokens (FE, E1, NF1, dE, etc.). This is only used
// to decide what to look up; it never creates a diagnosis by itself.
export function extractCandidateCodes(texts: readonly string[]): string[] {
  const codes = new Set<string>();
  // Deliberately narrow: only code-shaped tokens (FE, dE, E1, NF1, F02, etc.).
  // Ordinary words are never promoted to error-code clues.
  const codePattern = /^(?:[A-Z]{1,4}\d{1,3}[A-Z]?|\d{1,3}[A-Z]{1,2}|[A-Z]{2,3})$/;
  const stopWords = new Set(['THE', 'AND', 'FOR', 'NOT', 'YES', 'DO', 'IS', 'IT', 'MY', 'OK', 'ON', 'IN', 'OF', 'TO']);
  for (const text of texts) {
    for (const match of text.toUpperCase().match(/\b[A-Z0-9]{2,6}\b/g) ?? []) {
      if (!stopWords.has(match) && codePattern.test(match)) codes.add(match);
      if (codes.size >= 8) break;
    }
    if (codes.size >= 8) break;
  }
  return [...codes];
}

export async function searchErrorCodes(
  context: KnowledgeApplianceContext,
  codes: readonly string[],
  includeUnreviewed: boolean,
): Promise<KnowledgeDto> {
  // UNSPECIFIED is not a wildcard here either: without a trusted category no
  // category-specific candidates can be returned. Approval, model-scope and
  // USER_SAFE checks below remain unchanged.
  if (!context.category) {
    return {
      unverified: false,
      errorCodes: [],
      repairSteps: [],
      note: 'No trusted appliance category is available; no category-specific knowledge was searched.',
    };
  }

  const uniqueCodes = [...new Set(codes.map((code) => code.trim().toUpperCase()).filter(Boolean))].slice(0, 8);
  if (uniqueCodes.length === 0) {
    return { unverified: false, errorCodes: [], repairSteps: [], note: 'No error-code clue was found.' };
  }

  const rows = await prisma.errorCode.findMany({
    where: {
      category: context.category,
      brand: context.brand,
      // Codes are normalized to uppercase above, while seeded codes such as
      // dC/UE may be stored mixed-case. Case-insensitive lookup keeps that
      // normalization consistent without changing approval or scope rules.
      code: { in: uniqueCodes, mode: 'insensitive' },
      reviewStatus: {
        in: includeUnreviewed ? [ReviewStatus.APPROVED, ReviewStatus.UNREVIEWED] : [ReviewStatus.APPROVED],
      },
    },
    include: { source: true },
    orderBy: [{ code: 'asc' }],
    take: 8,
  });

  const unverified = rows.some((row) => row.reviewStatus !== ReviewStatus.APPROVED);
  const errorCodes = rows.map((row) => {
    const exactScopeMatch = Boolean(context.modelScope) && row.modelScope === context.modelScope;
    const trusted = row.reviewStatus === ReviewStatus.APPROVED && exactScopeMatch;
    let reason: string | undefined;
    if (row.modelScope === 'UNSPECIFIED') {
      reason = 'Applicability is unspecified; this code cannot be used as authoritative guidance.';
    } else if (!exactScopeMatch) {
      reason = 'The appliance configuration is not confirmed to match this code’s model scope.';
    } else if (!trusted) {
      reason = 'This knowledge entry is unverified.';
    }

    return {
      id: row.id,
      code: row.code,
      meaning: row.meaning,
      modelScope: row.modelScope as KnowledgeDto['errorCodes'][number]['modelScope'],
      trusted,
      ...(reason ? { reason } : {}),
      source: toCitation(row.source),
    };
  });

  return {
    unverified,
    errorCodes,
    repairSteps: [],
    note: unverified
      ? 'Development-only unverified knowledge is included and must not be treated as authoritative.'
      : undefined,
  };
}

export async function getApprovedRepairSequence(
  errorCodeId: string,
  context: KnowledgeApplianceContext,
  _includeUnreviewed: boolean,
): Promise<ApprovedRepairSequence> {
  const code = await prisma.errorCode.findUnique({
    where: { id: errorCodeId },
    include: {
      source: true,
      repairStepLinks: {
        orderBy: { position: 'asc' },
        include: { repairStep: { include: { source: true } } },
      },
    },
  });

  if (!code || !context.category || code.category !== context.category || code.brand !== context.brand) {
    return { eligible: false, reason: 'The error code is not applicable to this appliance.', steps: [] };
  }

  if (code.reviewStatus !== ReviewStatus.APPROVED) {
    return { eligible: false, reason: 'The error code is not approved.', steps: [] };
  }

  if (!context.modelScope || context.modelScope === 'UNSPECIFIED' || code.modelScope !== context.modelScope) {
    return {
      eligible: false,
      reason: 'The exact appliance model scope must be confirmed before repair guidance can be used.',
      steps: [],
    };
  }

  if (code.repairStepLinks.length === 0) {
    return { eligible: false, reason: 'No approved repair sequence is available.', steps: [] };
  }

  if (code.repairStepLinks.some((link) => link.reviewStatus !== ReviewStatus.APPROVED)) {
    return { eligible: false, reason: 'At least one repair-step link is not approved.', steps: [] };
  }

  if (
    code.repairStepLinks.some(
      (link) =>
        link.repairStep.reviewStatus !== ReviewStatus.APPROVED ||
        link.repairStep.safetyClass !== SafetyClass.USER_SAFE,
    )
  ) {
    return {
      eligible: false,
      reason: 'At least one repair step is unreviewed or technician-only; no DIY sequence can be returned.',
      steps: [],
    };
  }

  const steps = code.repairStepLinks.map((link, index) => ({
    position: link.position || index + 1,
    instruction: link.repairStep.instruction,
    source: toCitation(link.repairStep.source),
  }));

  return { eligible: true, errorCodeId: code.id, steps, citation: toCitation(code.source) };
}

export function collectKnowledgeCitations(knowledge: KnowledgeDto): CitationDto[] {
  const citations: CitationDto[] = [];
  for (const code of knowledge.errorCodes) citations.push(code.source);
  for (const step of knowledge.repairSteps) citations.push(step.source);
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = `${citation.title}|${citation.url ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
