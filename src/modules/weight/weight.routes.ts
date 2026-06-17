import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';

const IsoDate = Type.String({
  format: 'date',
  description: 'Calendar day, YYYY-MM-DD',
});

const WeightEntry = Type.Object({
  id: Type.String({ format: 'uuid' }),
  weightKg: Type.Number(),
  loggedFor: Type.String(),
  note: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
});

const CreateWeightBody = Type.Object({
  weightKg: Type.Number({ minimum: 2, maximum: 600 }),
  loggedFor: Type.Optional(IsoDate),
  note: Type.Optional(Type.String({ maxLength: 280 })),
});

const ListWeightQuery = Type.Object({
  from: Type.Optional(IsoDate),
  to: Type.Optional(IsoDate),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 365, default: 90 })),
});

/** Normalises an ISO date (or "now") to a UTC midnight Date. */
function toDay(value?: string): Date {
  const d = value ? new Date(`${value}T00:00:00.000Z`) : new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const weightRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.addHook('onRequest', app.authenticate);

  // ── POST /weight — upsert a measurement for a day ──────────────────
  app.post(
    '/',
    { schema: { body: CreateWeightBody, response: { 201: WeightEntry } } },
    async (req, reply) => {
      const loggedFor = toDay(req.body.loggedFor);
      const entry = await app.prisma.weightLog.upsert({
        where: { userId_loggedFor: { userId: req.userId, loggedFor } },
        update: { weightKg: req.body.weightKg, note: req.body.note ?? null },
        create: {
          userId: req.userId,
          weightKg: req.body.weightKg,
          loggedFor,
          note: req.body.note ?? null,
        },
      });
      return reply.code(201).send({
        id: entry.id,
        weightKg: Number(entry.weightKg),
        loggedFor: entry.loggedFor.toISOString().slice(0, 10),
        note: entry.note,
        createdAt: entry.createdAt.toISOString(),
      });
    },
  );

  // ── GET /weight — history sorted ascending by date ─────────────────
  app.get(
    '/',
    { schema: { querystring: ListWeightQuery, response: { 200: Type.Array(WeightEntry) } } },
    async (req, reply) => {
      const { from, to, limit = 90 } = req.query;
      const logs = await app.prisma.weightLog.findMany({
        where: {
          userId: req.userId,
          loggedFor: {
            ...(from ? { gte: toDay(from) } : {}),
            ...(to ? { lte: toDay(to) } : {}),
          },
        },
        orderBy: { loggedFor: 'asc' },
        take: limit,
      });
      return reply.send(
        logs.map((l) => ({
          id: l.id,
          weightKg: Number(l.weightKg),
          loggedFor: l.loggedFor.toISOString().slice(0, 10),
          note: l.note,
          createdAt: l.createdAt.toISOString(),
        })),
      );
    },
  );
};

export default weightRoutes;
