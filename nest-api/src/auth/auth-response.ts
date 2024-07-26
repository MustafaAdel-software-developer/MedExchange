/**
 * Node port of MedExchange.Common.Identity.AuthResponse's JSON shape (System.Text.Json's default
 * camelCase policy — verified against a real .NET response body). Fields not yet backed by a
 * ported domain (entity/invitation/journey) are always present with their .NET default value so
 * ClientApp's existing deserialization keeps working unchanged.
 */
export interface AuthResponseDto {
  entityExist: boolean;
  message: string | null;
  errors: string | null;
  isAuthenticated: boolean;
  email: string | null;
  isNew: boolean;
  isCompletedRegister: boolean;
  token: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  userJourney: unknown | null;
  isInvitedAsAProvider: boolean;
  registerationReturnLink: string | null;
  entityUserRole: string | null;
  /** DashboardView enum int (1=Rendering, 2=Ordering) when default practice is resolved. */
  lastDashboardView: number | string | null;
}

export function emptyAuthResponse(overrides: Partial<AuthResponseDto>): AuthResponseDto {
  return {
    entityExist: false,
    message: null,
    errors: null,
    isAuthenticated: false,
    email: null,
    isNew: false,
    isCompletedRegister: false,
    token: null,
    refreshToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    userJourney: null,
    isInvitedAsAProvider: false,
    registerationReturnLink: null,
    entityUserRole: null,
    lastDashboardView: null,
    ...overrides,
  };
}
