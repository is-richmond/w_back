import fp from 'fastify-plugin';
import { Resend } from 'resend';
import type { FastifyInstance } from 'fastify';
import { env, isProd } from '../config/env.js';
import { renderOtpEmail } from '../lib/email-templates.js';

declare module 'fastify' {
  interface FastifyInstance {
    mailer: {
      sendOtp(to: string, code: string): Promise<void>;
    };
  }
}

/**
 * Initialises the Resend SDK and exposes a thin, typed `mailer` facade so
 * route handlers never touch the SDK directly.
 */
export default fp(async function resendPlugin(app: FastifyInstance) {
  const resend = new Resend(env.RESEND_API_KEY);

  app.decorate('mailer', {
    async sendOtp(to: string, code: string) {
      const { subject, html, text } = renderOtpEmail(code);
      try {
        const { error } = await resend.emails.send({
          from: env.EMAIL_FROM,
          to,
          subject,
          html,
          text,
        });
        if (error) throw error;
      } catch (err) {
        app.log.error({ err, to }, 'Resend failed to send OTP email');
        // In production a delivery failure is fatal — the user can't proceed.
        if (isProd) throw new Error('Failed to dispatch verification email');
        // In development, surface the code in the logs so local testing isn't
        // blocked by an unconfigured Resend key / unverified sending domain.
        app.log.warn(
          `\n📧 [dev] Email delivery failed — OTP for ${to} is: ${code}\n`,
        );
      }
    },
  });
});
