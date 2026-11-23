import { prisma } from '../config/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  applianceDtoSelect,
  toApplianceDto,
  type ApplianceDto,
  type PaginatedApplianceDto,
} from '../types/appliance.dto.js';
import { toPaginatedDto } from '../types/diagnosis.dto.js';
import { HttpError } from '../utils/httpError.js';
import type {
  ApplianceIdParam,
  CreateApplianceInput,
  ListAppliancesQuery,
} from '../validators/appliance.validator.js';

// Zod's transform on the optional text fields makes their inferred keys
// required-but-possibly-undefined. These shapes describe what callers actually
// supply and stay structurally satisfied by the approved validated inputs.
type ApplianceInput = Pick<CreateApplianceInput, 'category' | 'brand'> &
  Partial<Pick<CreateApplianceInput, 'modelNumber' | 'nickname'>>;
type AppliancePatch = Partial<ApplianceInput>;

function applianceNotFound(): HttpError {
  return new HttpError(404, 'APPLIANCE_NOT_FOUND', 'Appliance not found');
}

// A conditional Prisma write reports an ownership or lookup miss as P2025. Map
// it to the same client-safe 404 as a missing row so foreign ids cannot be
// distinguished from nonexistent ones.
function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

export async function createAppliance(userId: string, input: ApplianceInput): Promise<ApplianceDto> {
  // Copy only the validated editable fields. The owner comes from the verified
  // token, never from the request body, and no raw record leaves this service.
  const created = await prisma.appliance.create({
    data: {
      userId,
      category: input.category,
      brand: input.brand,
      modelNumber: input.modelNumber ?? null,
      nickname: input.nickname ?? null,
    },
    select: applianceDtoSelect,
  });

  return toApplianceDto(created);
}

export async function listAppliances(userId: string, query: ListAppliancesQuery): Promise<PaginatedApplianceDto> {
  const { page, limit } = query;
  const skip = (page - 1) * limit;

  const [appliances, total] = await prisma.$transaction(async (tx) => {
    const rows = await tx.appliance.findMany({
      where: { userId },
      select: applianceDtoSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take: limit,
    });
    const count = await tx.appliance.count({ where: { userId } });
    return [rows, count] as const;
  });

  return toPaginatedDto(appliances.map(toApplianceDto), total, page, limit);
}

export async function getApplianceById(userId: string, params: ApplianceIdParam): Promise<ApplianceDto> {
  // A nonexistent id and someone else's appliance share one response so this
  // lookup cannot be used to enumerate other users' appliances.
  const appliance = await prisma.appliance.findFirst({
    where: { id: params.id, userId },
    select: applianceDtoSelect,
  });

  if (!appliance) {
    throw applianceNotFound();
  }

  return toApplianceDto(appliance);
}

export async function updateAppliance(
  userId: string,
  params: ApplianceIdParam,
  input: AppliancePatch,
): Promise<ApplianceDto> {
  // Undefined means "not supplied" and is left out of the write so the column
  // is preserved; null is an explicit clear. Unknown/server-managed keys are
  // never copied, so they cannot reach Prisma even if validation is bypassed.
  const data: AppliancePatch = {};
  if (input.category !== undefined) data.category = input.category;
  if (input.brand !== undefined) data.brand = input.brand;
  if (input.modelNumber !== undefined) data.modelNumber = input.modelNumber;
  if (input.nickname !== undefined) data.nickname = input.nickname;

  try {
    // id is unique and userId is an additional filter on the same conditional
    // write, so the row being updated must already belong to the caller. No
    // separate lookup/transaction is needed to prevent a cross-owner write.
    const updated = await prisma.appliance.update({
      where: { id: params.id, userId },
      data,
      select: applianceDtoSelect,
    });

    return toApplianceDto(updated);
  } catch (error) {
    if (isRecordNotFound(error)) {
      throw applianceNotFound();
    }
    throw error;
  }
}

export async function deleteAppliance(userId: string, params: ApplianceIdParam): Promise<void> {
  try {
    // Hard-delete only the owned Appliance row. The database's ON DELETE SET
    // NULL preserves historical diagnosis sessions and their messages; this
    // service neither simulates that cascade nor touches those tables.
    await prisma.appliance.delete({
      where: { id: params.id, userId },
    });
  } catch (error) {
    if (isRecordNotFound(error)) {
      throw applianceNotFound();
    }
    throw error;
  }
}
