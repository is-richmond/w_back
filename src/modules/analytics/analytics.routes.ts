import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { Prisma } from '@prisma/client';

const DashboardQuery = Type.Object({
  days: Type.Optional(Type.Integer({ minimum: 7, maximum: 365, default: 30 })),
});

const RecommendationResponse = Type.Object({
  recommendation: Type.String(),
  totals: Type.Object({
    calories: Type.Number(),
    proteins: Type.Number(),
    fats: Type.Number(),
    carbs: Type.Number(),
  }),
});

const DailyPoint = Type.Object({
  date: Type.String(),
  calories: Type.Number(),
  proteins: Type.Number(),
  fats: Type.Number(),
  carbs: Type.Number(),
  weightKg: Type.Union([Type.Number(), Type.Null()]),
});

const DashboardResponse = Type.Object({
  rangeDays: Type.Integer(),
  dailyCalorieGoal: Type.Union([Type.Integer(), Type.Null()]),
  series: Type.Array(DailyPoint),
  summary: Type.Object({
    avgCalories: Type.Number(),
    latestWeightKg: Type.Union([Type.Number(), Type.Null()]),
    weightChangeKg: Type.Union([Type.Number(), Type.Null()]),
    daysLogged: Type.Integer(),
  }),
});

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const analyticsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.addHook('onRequest', app.authenticate);

  // ── GET /analytics/dashboard ───────────────────────────────────────
  app.get(
    '/dashboard',
    { schema: { querystring: DashboardQuery, response: { 200: DashboardResponse } } },
    async (req, reply) => {
      const days = req.query.days ?? 30;
      const now = new Date();
      const start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)),
      );

      // Aggregate calories/macros per day in the database (set-based, fast).
      const nutrition = await app.prisma.$queryRaw<
        Array<{
          day: Date;
          calories: number;
          proteins: number;
          fats: number;
          carbs: number;
        }>
      >(Prisma.sql`
        SELECT m.logged_for AS day,
               COALESCE(SUM(mi.calories), 0)::float8 AS calories,
               COALESCE(SUM(mi.proteins), 0)::float8 AS proteins,
               COALESCE(SUM(mi.fats), 0)::float8     AS fats,
               COALESCE(SUM(mi.carbs), 0)::float8    AS carbs
        FROM meals m
        JOIN meal_items mi ON mi.meal_id = m.id
        WHERE m.user_id = ${req.userId}::uuid
          AND m.logged_for >= ${start}
        GROUP BY m.logged_for
        ORDER BY m.logged_for ASC
      `);

      const weights = await app.prisma.weightLog.findMany({
        where: { userId: req.userId, loggedFor: { gte: start } },
        orderBy: { loggedFor: 'asc' },
        select: { loggedFor: true, weightKg: true },
      });

      const nutritionByDay = new Map(nutrition.map((n) => [dayKey(n.day), n]));
      const weightByDay = new Map(
        weights.map((w) => [dayKey(w.loggedFor), Number(w.weightKg)]),
      );

      // Emit a continuous daily series so charts have no gaps.
      const series = Array.from({ length: days }, (_, i) => {
        const d = new Date(start);
        d.setUTCDate(start.getUTCDate() + i);
        const key = dayKey(d);
        const n = nutritionByDay.get(key);
        return {
          date: key,
          calories: n ? Math.round(n.calories) : 0,
          proteins: n ? Math.round(n.proteins) : 0,
          fats: n ? Math.round(n.fats) : 0,
          carbs: n ? Math.round(n.carbs) : 0,
          weightKg: weightByDay.get(key) ?? null,
        };
      });

      const user = await app.prisma.user.findUnique({
        where: { id: req.userId },
        select: { dailyCalorieGoal: true },
      });

      const loggedDays = series.filter((s) => s.calories > 0);
      const avgCalories = loggedDays.length
        ? Math.round(loggedDays.reduce((a, s) => a + s.calories, 0) / loggedDays.length)
        : 0;

      const firstWeight = weights.length ? Number(weights[0]!.weightKg) : null;
      const latestWeight = weights.length
        ? Number(weights[weights.length - 1]!.weightKg)
        : null;
      const weightChange =
        firstWeight != null && latestWeight != null
          ? Math.round((latestWeight - firstWeight) * 100) / 100
          : null;

      return reply.send({
        rangeDays: days,
        dailyCalorieGoal: user?.dailyCalorieGoal ?? null,
        series,
        summary: {
          avgCalories,
          latestWeightKg: latestWeight,
          weightChangeKg: weightChange,
          daysLogged: loggedDays.length,
        },
      });
    },
  );

  // ── GET /analytics/recommendation — AI advice from today's totals ──
  app.get(
    '/recommendation',
    {
      schema: {
        querystring: Type.Object({ date: Type.Optional(Type.String({ format: 'date' })) }),
        response: { 200: RecommendationResponse },
      },
    },
    async (req, reply) => {
      const day = req.query.date
        ? new Date(`${req.query.date}T00:00:00.000Z`)
        : new Date();
      const today = new Date(
        Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()),
      );

      const meals = await app.prisma.meal.findMany({
        where: { userId: req.userId, loggedFor: today },
        include: { items: true },
      });
      const totals = meals
        .flatMap((m) => m.items)
        .reduce(
          (acc, i) => ({
            calories: acc.calories + Number(i.calories),
            proteins: acc.proteins + Number(i.proteins),
            fats: acc.fats + Number(i.fats),
            carbs: acc.carbs + Number(i.carbs),
          }),
          { calories: 0, proteins: 0, fats: 0, carbs: 0 },
        );

      const user = await app.prisma.user.findUnique({
        where: { id: req.userId },
        select: {
          goalType: true,
          dailyCalorieGoal: true,
          proteinTargetG: true,
          fatTargetG: true,
          carbTargetG: true,
        },
      });

      const r = (n: number) => Math.round(n);
      const goal = user?.goalType ?? 'поддержание формы';
      const target =
        user?.dailyCalorieGoal != null
          ? `${user.dailyCalorieGoal} ккал (Б: ${user.proteinTargetG ?? '—'}г, Ж: ${user.fatTargetG ?? '—'}г, У: ${user.carbTargetG ?? '—'}г)`
          : 'норма не задана';

      const userMsg = `Пользователь за день съел: всего ${r(totals.calories)} ккал (Белки: ${r(totals.proteins)}г, Жиры: ${r(totals.fats)}г, Углеводы: ${r(totals.carbs)}г). Цель пользователя: ${goal}, ${target}. Дай краткую рекомендацию на завтра в 3-4 предложениях. Напиши, чего не хватило и что добавить.`;

      const recommendation = await app.groq.recommend(
        'Ты — дружелюбный нутрициолог. Отвечай по-русски, тёплым тоном, кратко (3-4 предложения), без markdown и без списков.',
        userMsg,
      );

      return reply.send({
        recommendation,
        totals: {
          calories: r(totals.calories),
          proteins: r(totals.proteins),
          fats: r(totals.fats),
          carbs: r(totals.carbs),
        },
      });
    },
  );
};

export default analyticsRoutes;
