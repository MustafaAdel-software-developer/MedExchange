import { Users } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { boolClaim } from './auth-enums';
import { enrichTokenClaims } from './build-entity-claims';
import { ClaimTypes } from './claim-types';
import { formatFullName } from './name-formatter';

export interface TokenClaimsOptions {
  isNew: boolean;
  isCompletedRegister: boolean;
  /** Guid.Empty / omitted → no entity-scoped claims (login without default practice). */
  entityId?: string | null;
  /** Admin user id when impersonating; omitted → "NULL". */
  impersonatedBy?: string | null;
}

/**
 * Node port of AuthService.CreateTokenClaims (MedExchange.DAL) — core identity claims plus
 * entity/provider enrichment via enrichTokenClaims. Bool claim values use C# ToString() casing
 * ("True"/"False") because ClientApp compares them as strings.
 */
export async function buildTokenClaims(
  prisma: PrismaService,
  user: Users,
  { isNew, isCompletedRegister, entityId, impersonatedBy }: TokenClaimsOptions,
): Promise<Record<string, string>> {
  const hasExternalLogin = (await prisma.userLogins.count({ where: { UserId: user.Id } })) > 0 && user.PasswordHash === null;

  const claims: Record<string, string> = {
    [ClaimTypes.Email]: user.Email ?? '',
    [ClaimTypes.NameIdentifier]: user.Id,
    [ClaimTypes.Name]: formatFullName(user.FirstName, user.LastName),
    IsNew: boolClaim(isNew),
    HasPin: boolClaim(user.PinCode !== null),
    IsPhoneVerified: boolClaim(user.PhoneNumberConfirmed),
    ProfilePicture: '',
    ImpersonatedBy: impersonatedBy && impersonatedBy !== 'NULL' ? impersonatedBy : 'NULL',
    IsExternalLogin: boolClaim(hasExternalLogin),
  };

  if (user.FirstName) claims.FirstName = user.FirstName;

  if (user.IsAdmin) {
    claims[ClaimTypes.Role] = 'SystemAdministrator';
  } else {
    claims.IsCompletedRegister = boolClaim(isCompletedRegister);
  }

  if (user.LastName) claims.LastName = user.LastName;
  if (user.PhoneNumber) claims.PhoneNumber = user.PhoneNumber;

  await enrichTokenClaims(prisma, user, claims, entityId);
  return claims;
}

/** @deprecated Use buildTokenClaims — kept for any leftover imports during the cutover. */
export async function buildCoreClaims(
  prisma: PrismaService,
  user: Users,
  opts: { isNew: boolean; isCompletedRegister: boolean },
): Promise<Record<string, string>> {
  return buildTokenClaims(prisma, user, opts);
}
