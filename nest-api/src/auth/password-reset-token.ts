import { createHmac, timingSafeEqual } from 'crypto';

const RESET_TTL_MS = 24 * 60 * 60 * 1000;

/** Nest-owned password-reset tokens (not ASP.NET Identity format — Nest-issued emails only). */
export function createPasswordResetToken(userId: string, securityStamp: string | null, secret: string): string {
  const exp = Date.now() + RESET_TTL_MS;
  const payload = `${userId}.${exp}`;
  const sig = createHmac('sha256', secret).update(`${payload}.${securityStamp ?? ''}`).digest('base64url');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

export function verifyPasswordResetToken(
  token: string,
  userId: string,
  securityStamp: string | null,
  secret: string,
): boolean {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split('.');
    if (parts.length !== 3) return false;
    const [uid, expStr, sig] = parts;
    if (uid !== userId) return false;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || Date.now() > exp) return false;
    const expected = createHmac('sha256', secret).update(`${uid}.${exp}.${securityStamp ?? ''}`).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
