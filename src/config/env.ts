import 'dotenv/config';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

/**
 * Centralised, validated environment configuration.
 * Fails fast at boot if anything required is missing or malformed.
 */
const EnvSchema = Type.Object({
  NODE_ENV: Type.Union(
    [Type.Literal('development'), Type.Literal('production'), Type.Literal('test')],
    { default: 'development' },
  ),
  PORT: Type.Integer({ default: 3000 }),
  HOST: Type.String({ default: '0.0.0.0' }),
  CORS_ORIGIN: Type.String({ default: 'http://localhost:5173' }),

  DATABASE_URL: Type.String({ minLength: 1 }),

  JWT_ACCESS_SECRET: Type.String({ minLength: 32 }),
  JWT_REFRESH_SECRET: Type.String({ minLength: 32 }),
  JWT_INITIATION_SECRET: Type.String({ minLength: 32 }),

  RESEND_API_KEY: Type.String({ minLength: 1 }),
  EMAIL_FROM: Type.String({ minLength: 1 }),

  // Groq (Llama inference). Optional: AI features 503 until a key is set,
  // the rest of the app keeps working.
  GROQ_API_KEY: Type.Optional(Type.String()),
  GROQ_MODEL: Type.String({ default: 'llama-3.1-8b-instant' }),
});

// Fill in schema defaults for vars the host doesn't set (e.g. HOST), then
// coerce strings → numbers where the schema expects them. (Convert alone does
// not apply defaults, so missing-but-defaulted vars would fail validation.)
const withDefaults = Value.Default(EnvSchema, { ...process.env }) as Record<
  string,
  unknown
>;
const raw = Value.Convert(EnvSchema, withDefaults);

if (!Value.Check(EnvSchema, raw)) {
  const errors = [...Value.Errors(EnvSchema, raw)]
    .map((e) => `  • ${e.path || '(root)'}: ${e.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`❌ Invalid environment configuration:\n${errors}`);
  process.exit(1);
}

export const env = raw as {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  HOST: string;
  CORS_ORIGIN: string;
  DATABASE_URL: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_INITIATION_SECRET: string;
  RESEND_API_KEY: string;
  EMAIL_FROM: string;
  GROQ_API_KEY?: string;
  GROQ_MODEL: string;
};

export const isProd = env.NODE_ENV === 'production';

// Token lifetimes — kept in one place so policy is obvious.
export const TOKEN_TTL = {
  /** Short-lived token issued after OTP verification, only valid for set-pin. */
  initiation: '10m',
  /** Access token returned in JSON to the SPA. */
  access: '15m',
  /** Refresh token stored in an HttpOnly cookie. */
  refresh: '30d',
} as const;

/** Refresh cookie lifetime in seconds (30 days), mirrors TOKEN_TTL.refresh. */
export const REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
export const REFRESH_COOKIE_NAME = 'wc_refresh';
