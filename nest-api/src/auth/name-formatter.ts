/** Node port of NamingFormatter's "FL" mode (the only mode CreateTokenClaims/LogOut use). */
export function formatFullName(firstName?: string | null, lastName?: string | null): string {
  if (!firstName || !lastName) return '';
  return `${capitalizeFirst(firstName)} ${capitalizeFirst(lastName)}`;
}

function capitalizeFirst(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
