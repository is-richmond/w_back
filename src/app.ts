import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import { env, isProd } from './config/env.js';
import prismaPlugin from './plugins/prisma.js';
import authPlugin from './plugins/auth.js';
import resendPlugin from './plugins/resend.js';
import { AuthError } from './modules/auth/auth.service.js';
import authRoutes from './modules/auth/auth.routes.js';
import weightRoutes from './modules/weight/weight.routes.js';
import mealsRoutes from './modules/meals/meals.routes.js';
import analyticsRoutes from './modules/analytics/analytics.routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isProd
      ? true
      : { transport: { target: 'pino-pretty', options: { colorize: true } } },
    trustProxy: isProd,
    ajv: { customOptions: { removeAdditional: 'all', coerceTypes: true } },
  }).withTypeProvider<TypeBoxTypeProvider>();

  // ── Cross-cutting plugins ──────────────────────────────────────────
  await app.register(sensible);
  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true, // required so the browser sends the refresh cookie
  });
  await app.register(rateLimit, { global: false, max: 100, timeWindow: '1 minute' });

  await app.register(prismaPlugin);
  await app.register(authPlugin);
  await app.register(resendPlugin);

  // ── Centralised error handling ─────────────────────────────────────
  app.setErrorHandler((error: FastifyError, req, reply) => {
    if (error instanceof AuthError) {
      return reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        error: 'AuthError',
        message: error.message,
      });
    }
    // Fastify validation + sensible httpErrors already carry statusCode.
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.name,
        message: error.message,
      });
    }
    req.log.error({ err: error }, 'Unhandled error');
    return reply.code(500).send({
      statusCode: 500,
      error: 'InternalServerError',
      message: 'Something went wrong',
    });
  });

  // ── Health check ───────────────────────────────────────────────────
  app.get('/health', async () => ({ status: 'ok' }));

  // ── Versioned API ──────────────────────────────────────────────────
  await app.register(
    async (v1) => {
      await v1.register(authRoutes, { prefix: '/auth' });
      await v1.register(weightRoutes, { prefix: '/weight' });
      await v1.register(mealsRoutes, { prefix: '/meals' });
      await v1.register(analyticsRoutes, { prefix: '/analytics' });
    },
    { prefix: '/api/v1' },
  );

  return app;
}
