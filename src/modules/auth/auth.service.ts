import type { PrismaClient, User } from '@prisma/client';
import {
  generateOtp,
  hashOtp,
  verifyOtpHash,
  hashPin,
  verifyPin,
} from '../../lib/crypto.js';

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_OTP_ATTEMPTS = 5;

export class AuthError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Encapsulates all auth persistence + crypto. Routes stay thin and only
 * translate results into HTTP responses / tokens.
 */
export class AuthService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Upsert the user (passwordless onboarding) and return the plaintext OTP. */
  async issueOtp(email: string): Promise<{ user: User; code: string }> {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.upsert({
      where: { email: normalized },
      update: {},
      create: { email: normalized },
    });

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    // Invalidate any earlier outstanding codes, then persist the new one.
    await this.prisma.$transaction([
      this.prisma.authOtp.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.authOtp.create({
        data: { userId: user.id, codeHash: hashOtp(code), expiresAt },
      }),
    ]);

    return { user, code };
  }

  /** Verify an OTP; on success consume it and return the user. */
  async verifyOtp(email: string, code: string): Promise<User> {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (!user) throw new AuthError(400, 'Invalid or expired code');

    const otp = await this.prisma.authOtp.findFirst({
      where: { userId: user.id, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new AuthError(400, 'Invalid or expired code');

    if (otp.expiresAt.getTime() < Date.now()) {
      throw new AuthError(400, 'Invalid or expired code');
    }
    if (otp.attempts >= MAX_OTP_ATTEMPTS) {
      throw new AuthError(429, 'Too many attempts, request a new code');
    }

    if (!verifyOtpHash(code, otp.codeHash)) {
      await this.prisma.authOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new AuthError(400, 'Invalid or expired code');
    }

    await this.prisma.authOtp.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });
    return user;
  }

  /** Hash and persist the PIN for a user that has a valid initiation token. */
  async setPin(userId: string, pin: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { pinHash: await hashPin(pin) },
    });
  }

  /** Verify a PIN for an existing user. */
  async verifyPinForLogin(email: string, pin: string): Promise<User> {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    // Same generic error whether the user or PIN is wrong (no enumeration).
    if (!user?.pinHash) throw new AuthError(401, 'Invalid credentials');

    const ok = await verifyPin(pin, user.pinHash);
    if (!ok) throw new AuthError(401, 'Invalid credentials');
    return user;
  }

  getUser(userId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }
}
