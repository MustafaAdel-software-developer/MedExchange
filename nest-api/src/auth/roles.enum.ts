/** Mirrors MedExchange.Common.Enums.Roles (stored as Identity role Name; DTO serializes as int). */
export enum AppRoles {
  None = 1,
  SystemAdministrator = 2,
  Admin = 3,
  Staff = 4,
  OrderingOnlyStaff = 5,
}

const ROLE_NAME_TO_ENUM: Record<string, AppRoles> = {
  None: AppRoles.None,
  SystemAdministrator: AppRoles.SystemAdministrator,
  Admin: AppRoles.Admin,
  Staff: AppRoles.Staff,
  OrderingOnlyStaff: AppRoles.OrderingOnlyStaff,
};

export function roleNameToEnum(name: string | null | undefined): AppRoles | null {
  if (!name) return null;
  return ROLE_NAME_TO_ENUM[name] ?? null;
}

export const ENTITY_DATA_ALLOWED_ROLES = new Set([
  AppRoles.Admin,
  AppRoles.Staff,
  AppRoles.OrderingOnlyStaff,
]);
