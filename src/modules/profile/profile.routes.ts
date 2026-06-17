import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';

const ProfileOut = Type.Object({
  id: Type.String({ format: 'uuid' }),
  email: Type.String(),
  displayName: Type.Union([Type.String(), Type.Null()]),
  goalType: Type.Union([Type.String(), Type.Null()]),
  dailyCalorieGoal: Type.Union([Type.Integer(), Type.Null()]),
  proteinTargetG: Type.Union([Type.Integer(), Type.Null()]),
  fatTargetG: Type.Union([Type.Integer(), Type.Null()]),
  carbTargetG: Type.Union([Type.Integer(), Type.Null()]),
});

const UpdateProfileBody = Type.Object({
  displayName: Type.Optional(Type.String({ maxLength: 80 })),
  goalType: Type.Optional(Type.String({ maxLength: 80 })),
  dailyCalorieGoal: Type.Optional(Type.Integer({ minimum: 0, maximum: 20000 })),
  proteinTargetG: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000 })),
  fatTargetG: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000 })),
  carbTargetG: Type.Optional(Type.Integer({ minimum: 0, maximum: 2000 })),
});

const SELECT = {
  id: true,
  email: true,
  displayName: true,
  goalType: true,
  dailyCalorieGoal: true,
  proteinTargetG: true,
  fatTargetG: true,
  carbTargetG: true,
} as const;

const profileRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.addHook('onRequest', app.authenticate);

  // ── GET /profile ───────────────────────────────────────────────────
  app.get('/', { schema: { response: { 200: ProfileOut } } }, async (req, reply) => {
    const user = await app.prisma.user.findUniqueOrThrow({
      where: { id: req.userId },
      select: SELECT,
    });
    return reply.send(user);
  });

  // ── PUT /profile — update goals / display name ─────────────────────
  app.put(
    '/',
    { schema: { body: UpdateProfileBody, response: { 200: ProfileOut } } },
    async (req, reply) => {
      const user = await app.prisma.user.update({
        where: { id: req.userId },
        data: req.body,
        select: SELECT,
      });
      return reply.send(user);
    },
  );
};

export default profileRoutes;
