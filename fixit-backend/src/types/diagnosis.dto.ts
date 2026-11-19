// Explicit DTO boundary for diagnosis responses. Prisma records are never
// returned directly: these mappers choose the exact client-visible fields, so
// ownership, error-code linkage and confirmation state cannot leak through a
// later schema addition.


// A DTO is an object that defines exactly what data we allow to send from our backend to the frontend or from one part of an application to another.

import type { DiagnosisSession, Message } from '../generated/prisma/client.js';

// Responses select only these columns. Unrelated fields are not even loaded
// for a response query.
export const sessionDtoSelect = {
  id: true,
  applianceId: true,
  symptom: true,
  status: true,
  verdict: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const messageDtoSelect = {
  id: true,
  sessionId: true,
  role: true,
  content: true,
  createdAt: true,
} as const;

type SessionRecord = Pick<DiagnosisSession, keyof typeof sessionDtoSelect>;
type MessageRecord = Pick<Message, keyof typeof messageDtoSelect>;

export type SessionDto = {
  id: string;
  applianceId: string | null;
  symptom: string | null;
  status: DiagnosisSession['status'];
  verdict: DiagnosisSession['verdict'];
  createdAt: Date;
  updatedAt: Date;
};

export type MessageDto = {
  id: string;
  sessionId: string;
  role: Message['role'];
  content: string;
  createdAt: Date;
};

export type PaginatedDto<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export function toSessionDto(session: SessionRecord): SessionDto {
  return {
    id: session.id,
    applianceId: session.applianceId,
    symptom: session.symptom,
    status: session.status,
    verdict: session.verdict,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export function toMessageDto(message: MessageRecord): MessageDto {
  return {
    id: message.id,
    sessionId: message.sessionId,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  };
}

export function toPaginatedDto<T>(items: T[], total: number, page: number, limit: number): PaginatedDto<T> {
  return {
    items,
    page,
    limit,
    total,
    totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
  };
}
