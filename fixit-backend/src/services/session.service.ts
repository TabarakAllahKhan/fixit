import { prisma } from '../config/prisma.js';
import {
  sessionDtoSelect,
  toPaginatedDto,
  toSessionDto,
  type PaginatedDto,
  type SessionDto,
} from '../types/diagnosis.dto.js';
import { MessageRole } from '../generated/prisma/client.js';
import { HttpError } from '../utils/httpError.js';
import type { CreateSessionInput, ListSessionsQuery, SessionIdParam } from '../validators/diagnosis.validator.js';

// The first conversation turn is the user's own starting clue(s), in validator
// order. An error code is a string clue at this stage: no knowledge lookup or
// errorCodeId linkage exists yet, and no model number is inferred from either.
// The separately persisted session.errorCode is used directly as a lookup
// clue on later turns, never reconstructed from this message.
function initialMessageContent(input: CreateSessionInput): string {
  return [input.symptom, input.errorCode].filter((part): part is string => Boolean(part)).join('\n');
}

export async function createSession(userId: string, input: CreateSessionInput): Promise<SessionDto> {
  // Ownership, appliance creation (inline path), session creation and the
  // initial message must all succeed or none of them may be persisted.
  // userId always comes from the verified token, never from the request.
  const session = await prisma.$transaction(async (tx) => {
    let applianceId: string;

    if (input.applianceId) {
      const appliance = await tx.appliance.findFirst({
        where: { id: input.applianceId, userId },
        select: { id: true },
      });

      if (!appliance) {
        throw new HttpError(404, 'APPLIANCE_NOT_FOUND', 'Appliance not found');
      }
      applianceId = appliance.id;
    } else {
      // Validation guarantees a brand on this path. The defensive check keeps
      // a direct service caller from creating an unidentified appliance.
      if (!input.brand) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'A saved appliance or brand is required');
      }
      const appliance = await tx.appliance.create({
        data: {
          userId,
          brand: input.brand,
          modelNumber: input.modelNumber ?? null,
        },
        select: { id: true },
      });
      applianceId = appliance.id;
    }

    const created = await tx.diagnosisSession.create({
      data: {
        userId,
        applianceId,
        symptom: input.symptom,
        errorCode: input.errorCode ?? null,
      },
      select: sessionDtoSelect,
    });

    await tx.message.create({
      data: {
        sessionId: created.id,
        role: MessageRole.USER,
        content: initialMessageContent(input),
      },
    });

    return created;
  });

  return toSessionDto(session);
}

export async function listSessions(userId: string, query: ListSessionsQuery): Promise<PaginatedDto<SessionDto>> {
  const { page, limit } = query;
  const skip = (page - 1) * limit;

  const [sessions, total] = await prisma.$transaction(async (tx) => {
    const rows = await tx.diagnosisSession.findMany({
      where: { userId },
      select: sessionDtoSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take: limit,
    });
    const count = await tx.diagnosisSession.count({ where: { userId } });
    return [rows, count] as const;
  });

  return toPaginatedDto(sessions.map(toSessionDto), total, page, limit);
}

export async function getSessionById(userId: string, params: SessionIdParam): Promise<SessionDto> {
  // A nonexistent id and someone else's session intentionally share one
  // response so the endpoint cannot be used to enumerate sessions.
  const session = await prisma.diagnosisSession.findFirst({
    where: { id: params.id, userId },
    select: sessionDtoSelect,
  });

  if (!session) {
    throw new HttpError(404, 'SESSION_NOT_FOUND', 'Diagnosis session not found');
  }

  return toSessionDto(session);
}
