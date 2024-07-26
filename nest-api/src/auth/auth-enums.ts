/** Mirrors MedExchange.Common.Enums.EntityType. */
export enum EntityType {
  Group = 1,
  Individual = 2,
}

/** Mirrors MedExchange.Common.Enums.Status (due diligence / invitation). */
export enum Status {
  Pending = 1,
  Approved = 2,
  Denied = 3,
  Declined = 4,
  InComplete = 5,
  Null = 6,
}

/** Mirrors MedExchange.Common.Enums.DashboardView. */
export enum DashboardView {
  Rendering = 1,
  Ordering = 2,
}

export const GUID_EMPTY = '00000000-0000-0000-0000-000000000000';

/** C# bool.ToString() — ClientApp compares claim values to "True"/"False". */
export function boolClaim(value: boolean): string {
  return value ? 'True' : 'False';
}

export function isEmptyGuid(id: string | null | undefined): boolean {
  return !id || id === GUID_EMPTY;
}
