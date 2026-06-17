import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { isProd } from '../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

/**
 * Instantiates a single PrismaClient for the app lifetime and tears it
 * down gracefully on close.
 */
export default fp(async function prismaPlugin(app: FastifyInstance) {
  const prisma = new PrismaClient({
    log: isProd ? ['error'] : ['warn', 'error'],
  });

  await prisma.$connect();

  app.decorate('prisma', prisma);

  app.addHook('onClose', async (instance) => {
    await instance.prisma.$disconnect();
  });
});
