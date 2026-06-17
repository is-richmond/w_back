import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { REFRESH_COOKIE_NAME } from '../../config/env.js';
import { AuthService, AuthError } from './auth.service.js';
import {
  RequestOtpBody,
  VerifyOtpBody,
  SetPinBody,
  VerifyPinBody,
  InitiationResponse,
  SessionResponse,
  MessageResponse,
} from './auth.schemas.js';

const authRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const service = new AuthService(app.prisma);

  const sessionPayload = (user: {
    id: string;
    email: string;
    displayName: string | null;
  }) => ({
    accessToken: app.tokens.signAccess(user.id),
    user: { id: user.id, email: user.email, displayName: user.displayName },
  });

  // Tight rate limit on the dispatch endpoint to prevent email-bombing.
  const otpRateLimit = {
    config: {
      rateLimit: { max: 5, timeWindow: '15 minutes' },
    },
  };

  // ── POST /request-otp ──────────────────────────────────────────────
  app.post(
    '/request-otp',
    {
      ...otpRateLimit,
      schema: {
        body: RequestOtpBody,
        response: { 200: MessageResponse },
      },
    },
    async (req, reply) => {
      const { user, code } = await service.issueOtp(req.body.email);
      await app.mailer.sendOtp(user.email, code);
      return reply.send({ message: 'If the email is valid, a code has been sent.' });
    },
  );

  // ── POST /verify-otp ───────────────────────────────────────────────
  app.post(
    '/verify-otp',
    {
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
      schema: {
        body: VerifyOtpBody,
        response: { 200: InitiationResponse },
      },
    },
    async (req, reply) => {
      const user = await service.verifyOtp(req.body.email, req.body.code);
      return reply.send({
        initiationToken: app.tokens.signInitiation(user.id),
        pinAlreadySet: user.pinHash != null,
      });
    },
  );

  // ── POST /set-pin (requires a valid initiation token) ──────────────
  app.post(
    '/set-pin',
    {
      schema: {
        body: SetPinBody,
        response: { 200: SessionResponse },
      },
    },
    async (req, reply) => {
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ')) throw new AuthError(401, 'Missing initiation token');
      let userId: string;
      try {
        const claims = app.tokens.verifyInitiation(header.slice(7));
        if (claims.typ !== 'initiation') throw new Error('wrong type');
        userId = claims.sub;
      } catch {
        throw new AuthError(401, 'Invalid or expired initiation token');
      }

      const user = await service.setPin(userId, req.body.pin);
      app.setRefreshCookie(reply, app.tokens.signRefresh(user.id));
      return reply.send(sessionPayload(user));
    },
  );

  // ── POST /verify-pin (subsequent logins) ───────────────────────────
  app.post(
    '/verify-pin',
    {
      config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
      schema: {
        body: VerifyPinBody,
        response: { 200: SessionResponse },
      },
    },
    async (req, reply) => {
      const user = await service.verifyPinForLogin(req.body.email, req.body.pin);
      app.setRefreshCookie(reply, app.tokens.signRefresh(user.id));
      return reply.send(sessionPayload(user));
    },
  );

  // ── POST /refresh (rotate access token from the refresh cookie) ────
  app.post(
    '/refresh',
    { schema: { response: { 200: SessionResponse } } },
    async (req, reply) => {
      const token = req.cookies[REFRESH_COOKIE_NAME];
      if (!token) throw new AuthError(401, 'Missing refresh token');
      let userId: string;
      try {
        const claims = app.tokens.verifyRefresh(token);
        if (claims.typ !== 'refresh') throw new Error('wrong type');
        userId = claims.sub;
      } catch {
        throw new AuthError(401, 'Invalid or expired refresh token');
      }

      const user = await service.getUser(userId);
      if (!user) throw new AuthError(401, 'User no longer exists');

      // Sliding session: re-issue a fresh refresh cookie on every refresh.
      app.setRefreshCookie(reply, app.tokens.signRefresh(user.id));
      return reply.send(sessionPayload(user));
    },
  );

  // ── POST /logout ────────────────────────────────────────────────────
  app.post(
    '/logout',
    { schema: { response: { 200: MessageResponse } } },
    async (_req, reply) => {
      app.clearRefreshCookie(reply);
      return reply.send({ message: 'Logged out' });
    },
  );
};

export default authRoutes;
