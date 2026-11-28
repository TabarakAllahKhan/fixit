import { createHash, randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { MessageRole, Prisma, SessionStatus, Verdict } from '../generated/prisma/client.js';
import {
  messageDtoSelect,
  sessionDtoSelect,
  toMessageDto,
  toPaginatedDto,
  toSessionDto,
  type MessageDto,
  type PaginatedDto,
  type SessionDto,
  type TurnDto,
} from '../types/diagnosis.dto.js';
import { HttpError } from '../utils/httpError.js';
import {
  parseAssistantMetadata,
  parseDiagnosisContext,
  type AssistantMessageMetadataDto,
} from '../validators/ai.validator.js';
import type {
  CompleteSessionInput,
  ConfirmFixInput,
  ListMessagesQuery,
  SendMessageInput,
  SessionIdParam,
} from '../validators/diagnosis.validator.js';
import type { ResearchCacheDto, ResearchDto } from '../validators/research.validator.js';
import { hasTrustedModel, resolveTrustedApplianceIdentity, type TrustedApplianceIdentity } from './ai/appliance-identity.js';
import { runDiagnosisTurn } from './ai/orchestrator.js';
import { assessUserSafety, restrictedFollowUpWindow } from './ai/safety.js';
import { extractCandidateCodes, searchErrorCodes } from './knowledge.service.js';
import { searchReplacementParts } from './parts.service.js';
import {
  buildResearchAnchorKey,
  buildResearchKey,
  isResearchEnabled,
  researchApplianceIssue,
  summarizeResearch,
} from './research.service.js';

async function requireOwnedSession(userId: string, sessionId: string) {
  const session = await prisma.diagnosisSession.findFirst({
    where: { id: sessionId, userId },
    select: { id: true, status: true },
  });

  if (!session) {
    throw new HttpError(404, 'SESSION_NOT_FOUND', 'Diagnosis session not found');
  }
  return session;
}

export async function listMessages(
  userId: string,
  params: SessionIdParam,
  query: ListMessagesQuery,
): Promise<PaginatedDto<MessageDto>> {
  await requireOwnedSession(userId, params.id);

  const { page, limit } = query;
  const skip = (page - 1) * limit;

  const [messages, total] = await prisma.$transaction(async (tx) => {
    const rows = await tx.message.findMany({
      where: { sessionId: params.id },
      select: messageDtoSelect,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip,
      take: limit,
    });
    const count = await tx.message.count({ where: { sessionId: params.id } });
    return [rows, count] as const;
  });

  return toPaginatedDto(messages.map(toMessageDto), total, page, limit);
}

// This function is used to convert a pair of user and assistant messages into a TurnDto, which represents a single turn in the diagnosis session. It extracts metadata from the assistant message and ensures that both messages are present. If the metadata is missing or incomplete, it throws an HttpError indicating that the turn is incomplete.
function toTurnDto(userMessage: MessageDto, assistantMessage: MessageDto): TurnDto {
  const metadata = parseAssistantMetadata(assistantMessage.metadata);
  if (!metadata) {
    throw new HttpError(409, 'AI_TURN_INCOMPLETE', 'A stored turn is missing structured metadata');
  }
  return {
    userMessage,
    assistantMessage,
    progress: metadata.progress,
    ...(metadata.progress.followUpQuestion ? { followUpQuestion: metadata.progress.followUpQuestion } : {}),
    ...(metadata.knowledge ? { knowledge: metadata.knowledge } : {}),
    ...(metadata.parts ? { parts: metadata.parts } : {}),
    ...(metadata.troubleshooting ? { troubleshooting: metadata.troubleshooting } : {}),
    ...(metadata.research ? { research: metadata.research } : {}),
    ...(metadata.safety ? { safety: metadata.safety } : {}),
    citations: metadata.citations,
  };
}

type TurnResearch = {
  research?: ResearchDto;
  cache?: ResearchCacheDto;
  reused: boolean;
};

// One bounded research operation per turn, reused while its key is unchanged.
// The key covers brand, trusted model, the session's persisted user-entered
// error code and the symptom, so new identity or symptom information triggers
// fresh research. An UNAVAILABLE result is retried on the next turn. Research
// is advisory: any failure degrades to UNAVAILABLE, never a failed turn.
async function resolveTurnResearch(
  identity: TrustedApplianceIdentity,
  session: { errorCode: string | null; symptom: string | null },
  fallbackSymptom: string,
  cached: ResearchCacheDto | undefined,
): Promise<TurnResearch> {
  if (!isResearchEnabled()) return { reused: false };

  const query = {
    brand: identity.brand,
    // Only a trusted, unconflicted model may anchor model-specific research.
    modelNumber: hasTrustedModel(identity) ? identity.modelNumber : null,
    // The persisted session error code only; never inferred from free text.
    errorCode: session.errorCode,
    symptom: session.symptom ?? fallbackSymptom,
  };
  const key = buildResearchKey(query);
  const anchorKey = buildResearchAnchorKey(query);
  if (!key || !anchorKey) return { reused: false };

  const reusable = cached && cached.result.status !== 'UNAVAILABLE';
  // A legacy session (no persisted symptom) researches with the current
  // message, which differs every turn. It reuses the cache while brand, model,
  // error code and classification are unchanged instead of re-researching on
  // every turn.
  const legacyMatch = session.symptom === null && cached?.anchorKey === anchorKey;
  if (reusable && (cached.key === key || legacyMatch)) {
    return { research: cached.result, cache: cached, reused: true };
  }

  let research: ResearchDto;
  try {
    research = await researchApplianceIssue(query);
  } catch {
    research = { status: 'UNAVAILABLE', confidence: 'INSUFFICIENT', results: [] };
  }
  return {
    research,
    cache: { version: 1, key, anchorKey, researchedAt: new Date().toISOString(), result: research },
    reused: false,
  };
}

// This function is used to find a stored turn in the database based on the sessionID
// and requestID. It retrieves both the user and assistant messages associated with the turn. If either message is missing, it throws an HttpError indicating that the turn is incomplete. If both messages are found, it returns a TurnDto representing the complete turn.
async function findStoredTurn(sessionId: string, requestId: string): Promise<TurnDto | null> {
  const [userMessage, assistantMessage] = await Promise.all([
    prisma.message.findFirst({
      where: { sessionId, clientRequestId: requestId, role: MessageRole.USER },
      select: messageDtoSelect,
    }),
    prisma.message.findFirst({
      where: { sessionId, clientRequestId: requestId, role: MessageRole.ASSISTANT },
      select: messageDtoSelect,
    }),
  ]);

  if (!userMessage && !assistantMessage) return null;
  if (!userMessage || !assistantMessage) {
    throw new HttpError(409, 'AI_TURN_INCOMPLETE', 'A stored turn is missing one of its messages');
  }
  return toTurnDto(toMessageDto(userMessage), toMessageDto(assistantMessage));
}

function challengeHash(challengeId: string): string {
  return createHash('sha256').update(challengeId).digest('hex');
}

// Share one in-flight provider turn per (user, session, requestId). The DB
// unique index still protects persistence; this prevents two concurrent
// identical requests from both paying for a provider call.
const inFlightTurns = new Map<string, Promise<TurnDto>>();

export async function sendMessage(
  userId: string,
  params: SessionIdParam,
  input: SendMessageInput,
): Promise<TurnDto> {
  const key = `${userId}:${params.id}:${input.requestId}`;
  const inFlight = inFlightTurns.get(key);
  if (inFlight) return inFlight;

  const turn = performSendMessage(userId, params, input);
  inFlightTurns.set(key, turn);
  try {
    return await turn;
  } finally {
    if (inFlightTurns.get(key) === turn) inFlightTurns.delete(key);
  }
}

/*
Turn flow:
1. Verify ownership, open status and requestId replay.
2. Retrieve bounded history and establish trusted appliance identity.
3. Check user-reported hazards (sticky across turns). A hazard skips research.
4. Run one bounded research operation when enabled, or reuse the cache.
5. Search the knowledge base for relevant error codes.
6. Run the Gemini tool loop with research as untrusted evidence; backend
   policy validates the outcome, safety and evidence wording.
7. Persist the user message, assistant turn and context in one conditional
   transaction, protected against concurrent requests.
*/
async function performSendMessage(
  userId: string,
  params: SessionIdParam,
  input: SendMessageInput,
): Promise<TurnDto> {
  // Ownership/state read and the entire AI/tool loop happen outside any
  // database transaction. A short conditional transaction follows only after
  // the provider returns a valid structured result.
  const session = await prisma.diagnosisSession.findFirst({
    where: { id: params.id, userId },
    select: {
      id: true,
      status: true,
      context: true,
      errorCode: true,
      symptom: true,
      updatedAt: true,
      appliance: { select: { category: true, brand: true, modelNumber: true } },
    },
  });

  if (!session) {
    throw new HttpError(404, 'SESSION_NOT_FOUND', 'Diagnosis session not found');
  }
  if (session.status !== SessionStatus.OPEN) {
    throw new HttpError(409, 'SESSION_CLOSED', 'Diagnosis session is closed');
  }
  if (!session.appliance) {
    throw new HttpError(409, 'APPLIANCE_NOT_AVAILABLE', 'Appliance context is no longer available');
  }

  const replayed = await findStoredTurn(session.id, input.requestId);
  if (replayed) return replayed;

  const context = parseDiagnosisContext(session.context);
  const historyRows = await prisma.message.findMany({
    where: { sessionId: session.id },
    select: messageDtoSelect,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: env.GEMINI_HISTORY_LIMIT,
  });
  const history = historyRows.reverse().map(toMessageDto);
  // I3: the restricted follow-up window after a refused dangerous request is
  // counted in USER turns and loaded separately, so it does not depend on
  // GEMINI_HISTORY_LIMIT or on how many assistant messages sit in between.
  const restrictionWindow = restrictedFollowUpWindow(env.SAFETY_FOLLOW_UP_USER_TURNS);
  const restrictionRows = await prisma.message.findMany({
    where: { sessionId: session.id, role: MessageRole.USER },
    select: messageDtoSelect,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: restrictionWindow,
  });
  const restrictionUserHistory = [...restrictionRows]
    .reverse()
    .filter((message) => message.role === MessageRole.USER)
    .map((message) => message.content)
    .slice(-restrictionWindow);

  // Resolve identity before any provider or knowledge work. Only the fresh DB
  // appliance and USER-authored messages are inputs; assistant history and AI
  // diagnostic facts stay in the advisory context passed to the orchestrator.
  const identity = resolveTrustedApplianceIdentity({
    appliance: session.appliance,
    persisted: context.trustedApplianceIdentity,
    userMessages: history
      .filter((message) => message.role === MessageRole.USER)
      .map((message) => message.content),
    currentUserContent: input.content,
  });

  const knowledge = await searchErrorCodes(
    {
      category: identity.category,
      brand: identity.brand,
      modelScope: identity.modelScope ?? undefined,
    },
    // The persisted, user-authored error code is used as-is; it is never
    // reconstructed from assistant text or from the conversation history.
    [
      ...(session.errorCode ? [session.errorCode] : []),
      ...extractCandidateCodes([input.content, ...context.diagnosticFacts, ...history.map((m) => m.content)]),
    ],
    env.ALLOW_UNREVIEWED_KNOWLEDGE,
  );

  // Immediate hazards are decided by the backend before any external call:
  // when one is active, research is skipped and the orchestrator answers with
  // a backend-written safety response.
  const hazardActive =
    assessUserSafety({
      userContent: input.content,
      history,
      restrictionUserHistory,
      restrictionWindow,
      context,
    }).length > 0;
  const turnResearch = hazardActive
    ? { reused: false }
    : await resolveTurnResearch(
        identity,
        { errorCode: session.errorCode, symptom: session.symptom ?? null },
        input.content,
        context.research,
      );

  const result = await runDiagnosisTurn({
    identity,
    context: turnResearch.cache ? { ...context, research: turnResearch.cache } : context,
    history,
    restrictionUserHistory,
    sessionErrorCode: session.errorCode,
    userContent: input.content,
    knowledge,
    includeUnreviewed: env.ALLOW_UNREVIEWED_KNOWLEDGE,
    partsSearch: searchReplacementParts,
    ...(turnResearch.research ? { research: turnResearch.research } : {}),
  });

  const fixChallenge = result.issueFixChallenge ? randomUUID() : undefined;
  const issuedAt = fixChallenge ? new Date() : undefined;
  const expiresAt = issuedAt ? new Date(issuedAt.getTime() + env.FIX_CONFIRMATION_TTL_SECONDS * 1000) : undefined;

  const metadata: AssistantMessageMetadataDto = {
    kind: 'ASSISTANT_TURN',
    requestId: input.requestId,
    progress: {
      ...result.progress,
      ...(fixChallenge && expiresAt
        ? { fixChallenge, fixChallengeExpiresAt: expiresAt.toISOString() }
        : {}),
    },
    knowledge: result.knowledge,
    ...(result.parts ? { parts: result.parts } : {}),
    ...(result.troubleshooting ? { troubleshooting: result.troubleshooting } : {}),
    ...(turnResearch.research && !result.safety
      ? { research: summarizeResearch(turnResearch.research, turnResearch.reused) }
      : {}),
    ...(result.safety ? { safety: result.safety } : {}),
    citations: result.citations,
  };

  try {
    const stored = await prisma.$transaction(async (tx) => {
      const existing = await tx.message.findFirst({
        where: { sessionId: session.id, clientRequestId: input.requestId, role: MessageRole.ASSISTANT },
        select: messageDtoSelect,
      });
      if (existing) {
        const existingUser = await tx.message.findFirst({
          where: { sessionId: session.id, clientRequestId: input.requestId, role: MessageRole.USER },
          select: messageDtoSelect,
        });
        if (!existingUser) {
          throw new HttpError(409, 'AI_TURN_INCOMPLETE', 'A stored turn is missing its user message');
        }
        return { user: existingUser, assistant: existing, replay: true as const };
      }

      // Conditional on the snapshot read before the provider call, so two
      // concurrent turns with different requestIds cannot overwrite context.
      // Claim before writing messages: a stale turn must leave no partial turn.
      const claimed = await tx.diagnosisSession.updateMany({
        where: {
          id: session.id,
          userId,
          status: SessionStatus.OPEN,
          updatedAt: session.updatedAt,
        },
        data: {
          context: result.nextContext as unknown as Prisma.InputJsonValue,
          ...(result.errorCodeId ? { errorCodeId: result.errorCodeId } : {}),
          ...(result.progress.verdict ? { verdict: result.progress.verdict } : {}),
          ...(fixChallenge && issuedAt && expiresAt
            ? {
                fixConfirmationChallengeId: challengeHash(fixChallenge),
                fixConfirmationIssuedAt: issuedAt,
                fixConfirmationExpiresAt: expiresAt,
              }
            : {
                fixConfirmationChallengeId: null,
                fixConfirmationIssuedAt: null,
                fixConfirmationExpiresAt: null,
              }),
        },
      });
      if (claimed.count !== 1) {
        const latest = await tx.diagnosisSession.findUnique({
          where: { id: session.id },
          select: { status: true },
        });
        if (latest?.status !== SessionStatus.OPEN) {
          throw new HttpError(409, 'SESSION_CLOSED', 'Diagnosis session is closed');
        }
        throw new HttpError(409, 'SESSION_CONFLICT', 'Diagnosis session changed during this turn');
      }

      const userMessage = await tx.message.create({
        data: {
          sessionId: session.id,
          role: MessageRole.USER,
          content: input.content,
          clientRequestId: input.requestId,
        },
        select: messageDtoSelect,
      });

      const assistantMessage = await tx.message.create({
        data: {
          sessionId: session.id,
          role: MessageRole.ASSISTANT,
          content: result.reply,
          clientRequestId: input.requestId,
          metadata: metadata as unknown as Prisma.InputJsonValue,
        },
        select: messageDtoSelect,
      });

      return { user: userMessage, assistant: assistantMessage, replay: false as const };
    });

    return toTurnDto(toMessageDto(stored.user), toMessageDto(stored.assistant));
  } catch (error) {
    // A concurrent retry may lose the uniqueness race. Return the winner's
    // stored turn instead of leaking a Prisma constraint error.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const stored = await findStoredTurn(session.id, input.requestId);
      if (stored) return stored;
    }
    throw error;
  }
}

export async function confirmFix(
  userId: string,
  params: SessionIdParam,
  input: ConfirmFixInput,
): Promise<SessionDto> {
  const session = await prisma.diagnosisSession.findFirst({
    where: { id: params.id, userId },
    select: {
      id: true,
      status: true,
      fixConfirmationChallengeId: true,
      fixConfirmationExpiresAt: true,
    },
  });

  if (!session) {
    throw new HttpError(404, 'SESSION_NOT_FOUND', 'Diagnosis session not found');
  }
  if (session.status !== SessionStatus.OPEN) {
    throw new HttpError(409, 'SESSION_CLOSED', 'Diagnosis session is closed');
  }
  if (
    !session.fixConfirmationChallengeId ||
    session.fixConfirmationChallengeId !== challengeHash(input.challengeId) ||
    !session.fixConfirmationExpiresAt ||
    session.fixConfirmationExpiresAt.getTime() <= Date.now()
  ) {
    throw new HttpError(409, 'INVALID_FIX_CONFIRMATION', 'Fix confirmation challenge is invalid or expired');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.diagnosisSession.updateMany({
      where: {
        id: session.id,
        userId,
        status: SessionStatus.OPEN,
        fixConfirmationChallengeId: session.fixConfirmationChallengeId,
        fixConfirmationExpiresAt: { gt: new Date() },
      },
      data: {
        status: SessionStatus.COMPLETED,
        verdict: Verdict.FIXED,
        fixConfirmationChallengeId: null,
        fixConfirmationIssuedAt: null,
        fixConfirmationExpiresAt: null,
      },
    });
    if (claimed.count !== 1) {
      throw new HttpError(409, 'INVALID_FIX_CONFIRMATION', 'Fix confirmation challenge is invalid or expired');
    }
    return tx.diagnosisSession.findUniqueOrThrow({
      where: { id: session.id },
      select: sessionDtoSelect,
    });
  });

  return toSessionDto(updated);
}

export async function completeSession(
  userId: string,
  params: SessionIdParam,
  _input: CompleteSessionInput,
): Promise<SessionDto> {
  const session = await prisma.diagnosisSession.findFirst({
    where: { id: params.id, userId },
    select: { id: true, status: true, verdict: true },
  });

  if (!session) {
    throw new HttpError(404, 'SESSION_NOT_FOUND', 'Diagnosis session not found');
  }
  if (session.status !== SessionStatus.OPEN) {
    throw new HttpError(409, 'SESSION_CLOSED', 'Diagnosis session is closed');
  }
  if (
    session.verdict !== Verdict.NEEDS_PART &&
    session.verdict !== Verdict.TECHNICIAN_REQUIRED &&
    session.verdict !== Verdict.UNRESOLVED
  ) {
    throw new HttpError(409, 'SESSION_NOT_COMPLETABLE', 'This session has no verdict that can be completed');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.diagnosisSession.updateMany({
      where: { id: session.id, userId, status: SessionStatus.OPEN, verdict: session.verdict },
      data: { status: SessionStatus.COMPLETED },
    });
    if (claimed.count !== 1) {
      throw new HttpError(409, 'SESSION_CLOSED', 'Diagnosis session is closed');
    }
    return tx.diagnosisSession.findUniqueOrThrow({
      where: { id: session.id },
      select: sessionDtoSelect,
    });
  });

  return toSessionDto(updated);
}
