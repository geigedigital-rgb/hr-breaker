/** Seed HTML for admin email template previews (no editor yet). */

export type AdminEmailTemplateDemo = {
  id: string;
  nameKey: string;
  descriptionKey: string;
  /** Full HTML document for iframe srcDoc; may contain {{merge_tags}} for send-time merge. */
  html: string;
};

/** Production app host where /public email assets are served (Resend must load images over HTTPS). */
const DEFAULT_EMAIL_ASSET_ORIGIN_PROD = "https://my.pitchcv.app";

/**
 * Public origin for static email assets (logo; optional hero in legacy templates).
 * 1) VITE_EMAIL_ASSET_ORIGIN — явно при build.
 * 2) Vite dev server (localhost) — по умолчанию прод-оригин, чтобы превью и «Copy URL» не вели на :5173.
 * 3) Иначе — текущий origin (прод-админка на том же хосте, что и SPA).
 */
export function getEmailAssetOrigin(): string {
  const fromEnv = (import.meta.env.VITE_EMAIL_ASSET_ORIGIN as string | undefined)?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (import.meta.env.DEV) return DEFAULT_EMAIL_ASSET_ORIGIN_PROD;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

/**
 * Admin iframe preview: resolve asset merge tags to this origin, other {{tags}} → # for valid hrefs.
 * At send time the API uses EMAIL_PUBLIC_BASE_URL (or FRONTEND_URL). Privacy/Terms in template are fixed links.
 * Keep in sync with `src/hr_breaker/email_templates/*.html` (inline send path when no Resend template id).
 */
export function prepareEmailHtmlForAdminPreview(html: string): string {
  const origin = getEmailAssetOrigin();
  let h = html;
  if (origin) {
    h = h.replace(/\{\{\{LOGO_URL\}\}\}/g, `${origin}/logo-color.svg`);
    h = h.replace(/\{\{\{HERO_IMAGE_URL\}\}\}/g, `${origin}/email/hero-winback.svg`);
    h = h.replace(/\{\{logo_url\}\}/g, `${origin}/logo-color.svg`);
    h = h.replace(/\{\{hero_image_url\}\}/g, `${origin}/email/hero-winback.svg`);
    h = h.replace(/\{\{\{DOWNLOAD_URL\}\}\}/g, "#");
    h = h.replace(/\{\{\{RESUME_URL\}\}\}/g, "#");
    h = h.replace(/\{\{download_url\}\}/g, "#");
    h = h.replace(/\{\{\{UNSUBSCRIBE_LINK\}\}\}/g, `${origin}/api/email/unsubscribe?token=…`);
    h = h.replace(/\{\{unsubscribe_url\}\}/g, `${origin}/api/email/unsubscribe?token=…`);
  } else {
    h = h.replace(/\{\{\{LOGO_URL\}\}\}/g, "about:blank");
    h = h.replace(/\{\{\{HERO_IMAGE_URL\}\}\}/g, "about:blank");
    h = h.replace(/\{\{logo_url\}\}/g, "about:blank");
    h = h.replace(/\{\{hero_image_url\}\}/g, "about:blank");
  }
  h = h.replace(/\{\{[\w]+\}\}/g, "#");
  h = h.replace(/\{\{\{[A-Z0-9_]+\}\}\}/g, "#");
  return h;
}

/** Mirrors `src/hr_breaker/email_templates/reminder_no_download.html` (transactional-style layout). */
const EMAIL_WINBACK_NO_PAY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="x-apple-disable-message-reformatting"/>
  <title>Your resume is ready</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;">

  <!-- Short factual preheader (long promo-style lines often land in Gmail Promotions). -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
    Your tailored resume is available in PitchCV.
  </div>

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;">
    <tr>
      <td style="padding:28px 16px 40px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:520px;margin:0 auto;">
          <tr>
            <td style="padding:0 0 18px 0;">
              <img src="{{logo_url}}" width="120" height="32" alt="PitchCV" style="display:block;height:28px;width:auto;max-width:132px;border:0;outline:none;text-decoration:none;"/>
            </td>
          </tr>
          <tr>
            <td style="padding:0;">
              <p style="margin:0 0 10px 0;font-size:18px;font-weight:600;line-height:1.35;color:#111827;">
                Your resume is ready
              </p>
              <p style="margin:0 0 22px 0;font-size:15px;line-height:1.6;color:#4b5563;">
                Your latest tailored version is saved. Open it below when you are ready to continue.
              </p>
              <p style="margin:0 0 22px 0;">
                <a href="{{download_url}}" style="display:inline-block;padding:12px 22px;background:#1d4ed8;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">
                  View resume
                </a>
              </p>
              <p style="margin:0;font-size:13px;line-height:1.55;color:#6b7280;">
                Link not working? Paste this into your browser:<br/>
                <span style="word-break:break-all;color:#374151;">{{download_url}}</span>
              </p>
              <p style="margin:28px 0 0 0;padding-top:20px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.6;color:#9ca3af;">
                <a href="{{unsubscribe_url}}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>
                &nbsp;·&nbsp;
                <a href="https://www.pitchcv.app/privacy" style="color:#6b7280;text-decoration:underline;">Privacy</a>
                &nbsp;·&nbsp;
                <a href="https://www.pitchcv.app/terms" style="color:#6b7280;text-decoration:underline;">Terms</a>
              </p>
              <p style="margin:10px 0 0 0;font-size:12px;color:#9ca3af;">PitchCV · 71-75 Shelton Street, London WC2H 9FE, United Kingdom</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;

/** Mirrors `src/hr_breaker/email_templates/short_nudge.html`. */
const EMAIL_SHORT_NUDGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PitchCV</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;">

  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
    Your saved resume is still available in PitchCV.
  </div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;">
    <tr>
      <td style="padding:28px 16px 36px 16px;">
        <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;">
          <tr>
            <td>
              <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#374151;">
                Your tailored resume is still saved in your PitchCV account. You can open it whenever you want to pick up where you left off.
              </p>
              <p style="margin:0 0 20px 0;">
                <a href="{{download_url}}" style="color:#1d4ed8;font-size:15px;font-weight:600;text-decoration:underline;">Open PitchCV</a>
              </p>
              <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">
                <a href="{{unsubscribe_url}}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

export const ADMIN_EMAIL_DEMO_TEMPLATES: AdminEmailTemplateDemo[] = [
  {
    id: "reminder-no-download",
    nameKey: "admin.email.templates.demo1Name",
    descriptionKey: "admin.email.templates.demo1Desc",
    html: EMAIL_WINBACK_NO_PAY_HTML,
  },
  {
    id: "short-nudge",
    nameKey: "admin.email.templates.demo2Name",
    descriptionKey: "admin.email.templates.demo2Desc",
    html: EMAIL_SHORT_NUDGE_HTML,
  },
];
