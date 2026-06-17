/**
 * Responsive, dark-mode-friendly transactional email for the login OTP.
 * Inline styles only — most email clients strip <style> blocks.
 */
export function renderOtpEmail(code: string): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `${code} is your WeightCalc verification code`;

  const text = [
    'Your WeightCalc verification code is:',
    '',
    `    ${code}`,
    '',
    'This code expires in 5 minutes. If you did not request it, you can ignore this email.',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;width:100%;background-color:#1e293b;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 8px;text-align:center;">
                <div style="font-size:22px;font-weight:700;color:#f8fafc;letter-spacing:-0.5px;">WeightCalc</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px;text-align:center;">
                <p style="margin:0;color:#cbd5e1;font-size:15px;line-height:1.5;">
                  Use the code below to finish signing in. It expires in
                  <strong style="color:#f8fafc;">5 minutes</strong>.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px;text-align:center;">
                <div style="display:inline-block;background-color:#0f172a;border:1px solid #334155;border-radius:12px;padding:18px 28px;">
                  <span style="font-size:34px;font-weight:700;letter-spacing:10px;color:#38bdf8;font-family:'SFMono-Regular',Consolas,monospace;">${code}</span>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 32px;text-align:center;">
                <p style="margin:0;color:#64748b;font-size:13px;line-height:1.5;">
                  If you didn't request this, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;color:#475569;font-size:12px;">© WeightCalc</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}
