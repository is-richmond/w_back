import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { AuthError } from '../auth/auth.service.js';

const IsoDate = Type.String({ format: 'date', description: 'YYYY-MM-DD' });
const MealTypeEnum = Type.Union([
  Type.Literal('BREAKFAST'),
  Type.Literal('LUNCH'),
  Type.Literal('DINNER'),
  Type.Literal('SNACK'),
  Type.Literal('OTHER'),
]);

const NonNegative = Type.Number({ minimum: 0 });

const MealItemInput = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  grams: NonNegative,
  calories: NonNegative,
  proteins: NonNegative,
  fats: NonNegative,
  carbs: NonNegative,
});

const MealItemOut = Type.Composite([
  Type.Object({ id: Type.String({ format: 'uuid' }) }),
  MealItemInput,
]);

const MealOut = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  mealType: MealTypeEnum,
  loggedFor: Type.String(),
  createdAt: Type.String(),
  items: Type.Array(MealItemOut),
  totals: Type.Object({
    calories: Type.Number(),
    proteins: Type.Number(),
    fats: Type.Number(),
    carbs: Type.Number(),
  }),
});

// On create the user only supplies a name and (optionally) a weight — the AI
// computes the macros. A missing weight means "assume a standard portion".
const CreateItemInput = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  grams: Type.Optional(Type.Number({ minimum: 0, maximum: 5000 })),
});

const CreateMealBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  mealType: Type.Optional(MealTypeEnum),
  loggedFor: Type.Optional(IsoDate),
  items: Type.Array(CreateItemInput, { minItems: 1, maxItems: 30 }),
});

const RepeatMealBody = Type.Object({
  mealId: Type.String({ format: 'uuid' }),
  targetDate: IsoDate,
});

const ListMealsQuery = Type.Object({ date: Type.Optional(IsoDate) });

function toDay(value?: string): Date {
  const d = value ? new Date(`${value}T00:00:00.000Z`) : new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

type ItemRow = {
  id: string;
  name: string;
  grams: unknown;
  calories: unknown;
  proteins: unknown;
  fats: unknown;
  carbs: unknown;
};

function serializeMeal(meal: {
  id: string;
  name: string;
  mealType: string;
  loggedFor: Date;
  createdAt: Date;
  items: ItemRow[];
}) {
  const items = meal.items.map((i) => ({
    id: i.id,
    name: i.name,
    grams: Number(i.grams),
    calories: Number(i.calories),
    proteins: Number(i.proteins),
    fats: Number(i.fats),
    carbs: Number(i.carbs),
  }));
  const totals = items.reduce(
    (acc, i) => ({
      calories: acc.calories + i.calories,
      proteins: acc.proteins + i.proteins,
      fats: acc.fats + i.fats,
      carbs: acc.carbs + i.carbs,
    }),
    { calories: 0, proteins: 0, fats: 0, carbs: 0 },
  );
  return {
    id: meal.id,
    name: meal.name,
    mealType: meal.mealType as (typeof MealTypeEnum)['static'],
    loggedFor: meal.loggedFor.toISOString().slice(0, 10),
    createdAt: meal.createdAt.toISOString(),
    items,
    totals,
  };
}

const mealsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.addHook('onRequest', app.authenticate);

  // ── POST /meals — log a meal; AI computes KБЖУ from name + weight ──
  app.post(
    '/',
    { schema: { body: CreateMealBody, response: { 201: MealOut } } },
    async (req, reply) => {
      // Ask Llama (via Groq) to turn "name + optional weight" into macros.
      const analyzed = await app.groq.analyzeFood(req.body.items);

      const meal = await app.prisma.meal.create({
        data: {
          userId: req.userId,
          name: req.body.name,
          mealType: req.body.mealType ?? 'OTHER',
          loggedFor: toDay(req.body.loggedFor),
          items: {
            create: analyzed.map((a) => ({
              name: a.name,
              grams: a.grams,
              calories: a.calories,
              proteins: a.proteins,
              fats: a.fats,
              carbs: a.carbs,
            })),
          },
        },
        include: { items: true },
      });
      return reply.code(201).send(serializeMeal(meal));
    },
  );

  // ── GET /meals?date= — the daily food diary ────────────────────────
  app.get(
    '/',
    { schema: { querystring: ListMealsQuery, response: { 200: Type.Array(MealOut) } } },
    async (req, reply) => {
      const meals = await app.prisma.meal.findMany({
        where: { userId: req.userId, loggedFor: toDay(req.query.date) },
        orderBy: { createdAt: 'asc' },
        include: { items: true },
      });
      return reply.send(meals.map(serializeMeal));
    },
  );

  // ── POST /meals/repeat — clone a past meal onto a target date ──────
  app.post(
    '/repeat',
    { schema: { body: RepeatMealBody, response: { 201: MealOut } } },
    async (req, reply) => {
      const source = await app.prisma.meal.findFirst({
        // Ownership check baked into the query — users can't clone others' meals.
        where: { id: req.body.mealId, userId: req.userId },
        include: { items: true },
      });
      if (!source) throw new AuthError(404, 'Meal not found');

      const clone = await app.prisma.meal.create({
        data: {
          userId: req.userId,
          name: source.name,
          mealType: source.mealType,
          loggedFor: toDay(req.body.targetDate),
          items: {
            create: source.items.map((i) => ({
              name: i.name,
              grams: i.grams,
              calories: i.calories,
              proteins: i.proteins,
              fats: i.fats,
              carbs: i.carbs,
            })),
          },
        },
        include: { items: true },
      });
      return reply.code(201).send(serializeMeal(clone));
    },
  );
};

export default mealsRoutes;
