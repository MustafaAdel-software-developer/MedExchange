/**
 * MedExchange.DAL's AuthService builds JWT claims with `new JwtSecurityToken(issuer, audience,
 * claims, ...)` directly (not via a ClaimsIdentity + outbound claim-type mapping), so the JSON
 * payload keys are the literal long-form .NET ClaimTypes URIs below, not short JWT names like
 * "sub"/"email". Any claim we add here from Node must use the same literal string as the key
 * for tokens to be interchangeable between the .NET and Nest APIs.
 */
export const ClaimTypes = {
  Email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  NameIdentifier: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier',
  Name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
  Role: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role',
} as const;
