import { Injectable } from '@nestjs/common';
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto';

export enum PasswordVerificationResult {
  Failed = 0,
  Success = 1,
  SuccessRehashNeeded = 2,
}

// KeyDerivationPrf enum values from Microsoft.AspNetCore.Cryptography.KeyDerivation.
const PRF_DIGEST: Record<number, string> = {
  0: 'sha1',
  1: 'sha256',
  2: 'sha512',
};

const V3_PRF = 1; // HMACSHA256
const V3_ITER_COUNT = 10_000; // Microsoft.AspNetCore.Identity.PasswordHasherOptions default
const V3_SALT_SIZE = 16; // 128 bits
const V3_SUBKEY_LENGTH = 32; // 256 bits

const V2_ITER_COUNT = 1000;
const V2_SALT_SIZE = 16;
const V2_SUBKEY_LENGTH = 32;

/**
 * Node port of Microsoft.AspNetCore.Identity.PasswordHasher<TUser> (IdentityV3 compatibility
 * mode, the default). Byte layout and PBKDF2 params must match exactly for existing user
 * password hashes (migrated from SQL Server) to verify correctly.
 *
 * V3 format: [0x01][prf uint32 BE][iterCount uint32 BE][saltSize uint32 BE][salt][subkey]
 * V2 format (legacy ASP.NET Identity 2.x, kept for verify-only parity): [0x00][salt(16)][subkey(32)], PBKDF2-SHA1, 1000 iterations.
 */
@Injectable()
export class PasswordHasherService {
  hashPassword(password: string): string {
    const salt = randomBytes(V3_SALT_SIZE);
    const subkey = pbkdf2Sync(password, salt, V3_ITER_COUNT, V3_SUBKEY_LENGTH, 'sha256');

    const output = Buffer.alloc(13 + V3_SALT_SIZE + V3_SUBKEY_LENGTH);
    output[0] = 0x01;
    output.writeUInt32BE(V3_PRF, 1);
    output.writeUInt32BE(V3_ITER_COUNT, 5);
    output.writeUInt32BE(V3_SALT_SIZE, 9);
    salt.copy(output, 13);
    subkey.copy(output, 13 + V3_SALT_SIZE);
    return output.toString('base64');
  }

  verifyHashedPassword(hashedPassword: string, providedPassword: string): PasswordVerificationResult {
    let decoded: Buffer;
    try {
      decoded = Buffer.from(hashedPassword, 'base64');
    } catch {
      return PasswordVerificationResult.Failed;
    }
    if (decoded.length === 0) return PasswordVerificationResult.Failed;

    switch (decoded[0]) {
      case 0x00:
        return this.verifyV2(decoded, providedPassword);
      case 0x01:
        return this.verifyV3(decoded, providedPassword);
      default:
        return PasswordVerificationResult.Failed;
    }
  }

  private verifyV2(decoded: Buffer, password: string): PasswordVerificationResult {
    if (decoded.length !== 1 + V2_SALT_SIZE + V2_SUBKEY_LENGTH) return PasswordVerificationResult.Failed;

    const salt = decoded.subarray(1, 1 + V2_SALT_SIZE);
    const expectedSubkey = decoded.subarray(1 + V2_SALT_SIZE);
    const actualSubkey = pbkdf2Sync(password, salt, V2_ITER_COUNT, V2_SUBKEY_LENGTH, 'sha1');

    return timingSafeEqual(actualSubkey, expectedSubkey)
      ? PasswordVerificationResult.SuccessRehashNeeded
      : PasswordVerificationResult.Failed;
  }

  private verifyV3(decoded: Buffer, password: string): PasswordVerificationResult {
    try {
      const prf = decoded.readUInt32BE(1);
      const iterCount = decoded.readUInt32BE(5);
      const saltSize = decoded.readUInt32BE(9);
      const digest = PRF_DIGEST[prf];
      if (!digest || decoded.length < 13 + saltSize) return PasswordVerificationResult.Failed;

      const salt = decoded.subarray(13, 13 + saltSize);
      const expectedSubkey = decoded.subarray(13 + saltSize);
      if (expectedSubkey.length < 1) return PasswordVerificationResult.Failed;

      const actualSubkey = pbkdf2Sync(password, salt, iterCount, expectedSubkey.length, digest);
      if (!timingSafeEqual(actualSubkey, expectedSubkey)) return PasswordVerificationResult.Failed;

      return iterCount < V3_ITER_COUNT ? PasswordVerificationResult.SuccessRehashNeeded : PasswordVerificationResult.Success;
    } catch {
      return PasswordVerificationResult.Failed;
    }
  }
}
