import { prisma } from '../config/prisma.js';
import { MessageRole, SessionStatus } from '../generated/prisma/client.js';
import {
  messageDtoSelect,
  toMessageDto,
  toPaginatedDto,
  type MessageDto,
  type PaginatedDto,
} from '../types/diagnosis.dto.js';
import { HttpError } from '../utils/httpError.js';
import type {
  CompleteSessionInput,
  ConfirmFixInput,
  ListMessagesQuery,
  SendMessageInput,
  SessionIdParam,
} from '../validators/diagnosis.validator.js';

// Placeholder kept for the two actions that belong to later phases. They stay
// explicitly inert rather than pretending to persist or decide anything.
function notImplemented(operation: string): never {
  throw new HttpError(501, 'NOT_IMPLEMENTED', `${operation} is not implemented yet`);
}

async function requireOwnedSession(userId: string, sessionId: string): Promise<void> {
  const session = await prisma.diagnosisSession.findFirst({
    where: { id: sessionId, userId },
    select: { id: true },
  });

  if (!session) {
    throw new HttpError(404, 'SESSION_NOT_FOUND', 'Diagnosis session not found');
  }
}

// This function is used to list messages in a diagnosis session.
// It checks if the session is owned by the user and retrieves messages with pagination.
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

export async function sendMessage(
  userId: string,
  params: SessionIdParam,
  input: SendMessageInput,
): Promise<MessageDto> {
  // Read first only to distinguish "not ours/does not exist" from "closed".
  // The authoritative gate is the conditional update below.
  const session = await prisma.diagnosisSession.findFirst({
    where: { id: params.id, userId },
    select: { id: true, status: true },
  });

  if (!session) {
    throw new HttpError(404, 'SESSION_NOT_FOUND', 'Diagnosis session not found');
  }

  if (session.status !== SessionStatus.OPEN) {
    throw new HttpError(409, 'SESSION_CLOSED', 'Diagnosis session is closed');
  }

  const message = await prisma.$transaction(async (tx) => {
    // READ COMMITTED re-evaluates this WHERE after any concurrent lock wait,
    // so a session closed between the read above and here cannot accept a
    // message. Only the request that flips/updates the OPEN row may insert.
    const claimed = await tx.diagnosisSession.updateMany({
      where: { id: session.id, userId, status: SessionStatus.OPEN },
      data: { status: SessionStatus.OPEN },
    });

    if (claimed.count !== 1) {
      throw new HttpError(409, 'SESSION_CLOSED', 'Diagnosis session is closed');
    }

    return tx.message.create({
      data: {
        sessionId: session.id,
        role: MessageRole.USER,
        content: input.content,
      },
      select: messageDtoSelect,
    });
  });

  return toMessageDto(message);
}

// The challenge ID is later matched against server-issued, persisted state.
// A client-supplied verdict is never accepted anywhere in this flow.
export async function confirmFix(
  _userId: string,
  _params: SessionIdParam,
  _input: ConfirmFixInput,
): Promise<unknown> {
  return notImplemented('Fix confirmation');
}

export async function completeSession(
  _userId: string,
  _params: SessionIdParam,
  _input: CompleteSessionInput,
): Promise<unknown> {
  return notImplemented('Session completion');
}
