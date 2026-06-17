import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';

/** Generates a cryptographically-random 6-digit OTP, e.g. "048213". */
export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * OTPs are short-lived and low-entropy, so we store a fast SHA-256 hash
 * (not a slow KDF). Constant-time compare guards against timing attacks.
 */
export function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export function verifyOtpHash(code: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashOtp(code), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

/**
 * The 4-digit PIN is a long-lived secret, so it gets a memory-hard Argon2id
 * hash. (4 digits is low entropy — pair this with strict rate limiting.)
 */
export function hashPin(pin: string): Promise<string> {
  return argon2.hash(pin, { type: argon2.argon2id });
}

export function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  return argon2.verify(storedHash, pin);
}
