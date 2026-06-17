import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  env,
  isProd,
  REFRESH_COOKIE_MAX_AGE,
  REFRESH_COOKIE_NAME,
} from '../config/env.js';

/** Claims carried by every token type. */
export interface AccessClaims {
  sub: string; // user id
  typ: 'access';
}
export interface RefreshClaims {
  sub: string;
  typ: 'refresh';
}
export interface InitiationClaims {
  sub: string;
  typ: 'initiation';
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Guards a route, requiring a valid Access token. Sets request.userId. */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Sign/verify helpers for each token kind. */
    tokens: {
      signAccess(userId: string): string;
      signRefresh(userId: string): string;
      signInitiation(userId: string): string;
      verifyAccess(token: string): AccessClaims;
      verifyRefresh(token: string): RefreshClaims;
      verifyInitiation(token: string): InitiationClaims;
    };
    setRefreshCookie(reply: FastifyReply, token: string): void;
    clearRefreshCookie(reply: FastifyReply): void;
  }
  interface FastifyRequest {
    userId: string;
  }
}

/**
 * Registers three independently-keyed JWT namespaces (access / refresh /
 * initiation), the refresh cookie helpers, and the `authenticate` guard.
 *
 * We register @fastify/jwt three times under named namespaces so each token
 * class is signed and verified with its own secret — a leaked access secret
 * can never mint refresh tokens.
 */
export default fp(async function authPlugin(app: FastifyInstance) {
  await app.register(cookie);

  await app.register(jwt, {
    namespace: 'access',
    secret: env.JWT_ACCESS_SECRET,
    sign: { expiresIn: '15m' },
  });
  await app.register(jwt, {
    namespace: 'refresh',
    secret: env.JWT_REFRESH_SECRET,
    sign: { expiresIn: '30d' },
  });
  await app.register(jwt, {
    namespace: 'initiation',
    secret: env.JWT_INITIATION_SECRET,
    sign: { expiresIn: '10m' },
  });

  // In @fastify/jwt v10, namespaced instances live on `app.jwt[namespace]`
  // (v9 used `app.<namespace>Jwt`). Type the accessor explicitly.
  const ns = app.jwt as unknown as {
    access: import('@fastify/jwt').JWT;
    refresh: import('@fastify/jwt').JWT;
    initiation: import('@fastify/jwt').JWT;
  };

  app.decorate('tokens', {
    signAccess: (sub: string) =>
      ns.access.sign({ sub, typ: 'access' } satisfies AccessClaims),
    signRefresh: (sub: string) =>
      ns.refresh.sign({ sub, typ: 'refresh' } satisfies RefreshClaims),
    signInitiation: (sub: string) =>
      ns.initiation.sign({ sub, typ: 'initiation' } satisfies InitiationClaims),
    verifyAccess: (token: string) => ns.access.verify<AccessClaims>(token),
    verifyRefresh: (token: string) => ns.refresh.verify<RefreshClaims>(token),
    verifyInitiation: (token: string) =>
      ns.initiation.verify<InitiationClaims>(token),
  });

  app.decorate('setRefreshCookie', (reply: FastifyReply, token: string) => {
    reply.setCookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: REFRESH_COOKIE_MAX_AGE,
    });
  });

  app.decorate('clearRefreshCookie', (reply: FastifyReply) => {
    reply.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/v1/auth' });
  });

  app.decorate(
    'authenticate',
    async function (req: FastifyRequest, reply: FastifyReply) {
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ')) {
        return reply.unauthorized('Missing bearer token');
      }
      try {
        const claims = app.tokens.verifyAccess(header.slice(7));
        if (claims.typ !== 'access') throw new Error('wrong token type');
        req.userId = claims.sub;
      } catch {
        return reply.unauthorized('Invalid or expired access token');
      }
    },
  );
});
