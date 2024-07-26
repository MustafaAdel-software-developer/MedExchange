import { Users } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { boolClaim, EntityType, GUID_EMPTY, isEmptyGuid, Status } from './auth-enums';
import { ClaimTypes } from './claim-types';

/**
 * Node port of the entity / provider / due-diligence / teams portion of
 * AuthService.CreateTokenClaims (MedExchange.DAL). Mutates `claims` in place.
 * UserJurneyStatus is deferred (CAN_WAIT per investigation checklist).
 */
export async function enrichTokenClaims(
  prisma: PrismaService,
  user: Users,
  claims: Record<string, string>,
  entityId: string | null | undefined,
): Promise<void> {
  await applyVerifyProviderClaim(prisma, user, claims);
  await applyIndividualPracticeOwnerClaim(prisma, user, claims);

  if (isEmptyGuid(entityId)) return;

  const entityUser = await prisma.entityUsers.findFirst({
    where: {
      ApplicationUserId: user.Id,
      EntityId: entityId!,
      IsEnabled: true,
      IsCertified: true,
    },
  });
  if (!entityUser) return;

  const entity = await prisma.entity.findUnique({ where: { Id: entityId! } });
  if (!entity) return;

  claims.EntityId = entityId!;
  claims.EntityType = String(entity.EntityType);
  claims.IsOwner = boolClaim(entityUser.IsOwner);

  const identification = await prisma.identifications.findFirst({ where: { EntityId: entityId! } });
  if (identification) claims.IdentifireId = identification.Id;

  const userRole = await prisma.userRoles.findFirst({
    where: { UserId: user.Id, EntityId: entityId! },
    include: { Roles: true },
  });
  if (userRole?.Roles?.Name) {
    claims[ClaimTypes.Role] = userRole.Roles.Name;
  }

  claims.IsEntityApproved = await resolveEntityApprovalStatus(prisma, entityId!, identification?.Id ?? null);
  claims.IsHidden = boolClaim(entity.IsHidden);
  claims.IsRenderingEnabled = boolClaim(entity.IsRenderingEnabled);
  claims.UserTeamHasProvider = await hasTeamsWithProviders(prisma, user.Id, entityId!, userRole?.Roles?.Name);
}

async function applyVerifyProviderClaim(prisma: PrismaService, user: Users, claims: Record<string, string>): Promise<void> {
  const identifierProvider = await prisma.identifications.findFirst({
    where: { ApplicationUserId: user.Id, ModelType: EntityType.Individual },
  });
  if (!identifierProvider) {
    claims.VerifyProvider = 'NULL';
    return;
  }

  const dueDiligence = await prisma.dueDiligenceVerificationQueues.findFirst({
    where: { IdentificationId: identifierProvider.Id, EntityType: EntityType.Individual },
  });
  const isProviderDataCompleted = await prisma.identifications.findFirst({
    where: {
      ModelId: user.Id,
      ModelType: EntityType.Individual,
      SelfieImageId: { not: null },
      IdentityImageId: { not: null },
    },
  });

  if (dueDiligence) {
    if (dueDiligence.Status === Status.Pending) claims.VerifyProvider = 'Pending';
    else if (dueDiligence.Status === Status.Approved) claims.VerifyProvider = 'Approved';
    else if (dueDiligence.Status === Status.Denied) claims.VerifyProvider = 'Denied';
    else claims.VerifyProvider = 'NULL';
  } else if (!isProviderDataCompleted) {
    claims.VerifyProvider = 'InComplete';
  } else {
    claims.VerifyProvider = 'NULL';
  }
}

async function applyIndividualPracticeOwnerClaim(
  prisma: PrismaService,
  user: Users,
  claims: Record<string, string>,
): Promise<void> {
  const owner = await prisma.identifications.findFirst({
    where: {
      ApplicationUserId: user.Id,
      EntityId: { not: null },
      ModelType: EntityType.Individual,
    },
  });
  claims.IndividualPracticeOwner = boolClaim(owner !== null);
}

async function resolveEntityApprovalStatus(
  prisma: PrismaService,
  entityId: string,
  identificationId: string | null,
): Promise<string> {
  const isPracticeDataCompleted = await prisma.identifications.findFirst({
    where: {
      EntityId: entityId,
      ModelType: EntityType.Individual,
      SelfieImageId: { not: null },
      IdentityImageId: { not: null },
    },
  });

  const entityDueDiligence = identificationId
    ? await prisma.dueDiligenceVerificationQueues.findFirst({ where: { IdentificationId: identificationId } })
    : null;

  if (entityDueDiligence) {
    if (entityDueDiligence.Status === Status.Pending) return 'Pending';
    if (entityDueDiligence.Status === Status.Approved) return 'Approved';
    if (entityDueDiligence.Status === Status.Denied) return 'Denied';
  }
  if (!isPracticeDataCompleted) return 'InComplete';
  return 'NULL';
}

/** Node port of GenericService.HasTeamsWithProvidersAsync. */
async function hasTeamsWithProviders(
  prisma: PrismaService,
  userId: string,
  entityId: string,
  entityRoleName: string | null | undefined,
): Promise<string> {
  if (entityRoleName === 'Admin') return 'true';

  const entityUser = await prisma.entityUsers.findFirst({
    where: { EntityId: entityId, ApplicationUserId: userId },
    select: { Id: true },
  });
  if (!entityUser) return 'null';

  const memberships = await prisma.teamsEntityUsers.findMany({
    where: { EntityUserId: entityUser.Id },
    select: { TeamId: true },
  });
  if (memberships.length === 0) return 'null';

  const teams = await prisma.teams.findMany({
    where: { Id: { in: memberships.map((m) => m.TeamId) } },
    select: { ProviderExists: true },
  });
  return teams.some((t) => t.ProviderExists) ? 'true' : 'false';
}
