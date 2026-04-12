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

/** Mirrors `src/hr_breaker/email_templates/reminder_no_download.html`. */
const EMAIL_WINBACK_NO_PAY_HTML = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="x-apple-disable-message-reformatting"/>
  <title>Your resume is ready</title>
  <style type="text/css">
    body { margin:0; padding:0; background-color:#f3f4f6; }
    table { border-collapse:collapse; }
    @media only screen and (max-width:560px) {
      .hero-title .hero-line { display:block !important; }
      .hero-title { font-size:19px !important; line-height:1.22 !important; }
      .hero-outer { padding:24px !important; }
      .hero-logo-img { height:28px !important; max-width:104px !important; width:auto !important; }
      .hero-wordmark { font-size:14px !important; }
      .hero-logo-row { padding:6px 14px 8px 14px !important; }
      .hero-inner { display:block !important; width:100% !important; max-width:100% !important; box-sizing:border-box !important; padding:4px 14px 2px 14px !important; text-align:left !important; }
      .hero-illus-cell { display:block !important; width:100% !important; max-width:100% !important; box-sizing:border-box !important; text-align:right !important; vertical-align:bottom !important; padding:4px 0 0 0 !important; }
      .hero-illus-cell .illus { margin-left:auto !important; margin-right:0 !important; display:block !important; }
      .illus { width:150px !important; max-width:55vw !important; }
      .body-cell { padding:24px !important; }
      .footer-cell { padding:20px 24px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">

  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Your tailored resume is ready in PitchCV.</div>

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;">

          <!-- HERO: white outer + rounded #F8F9FF slab + illustration -->
          <tr>
            <td class="hero-outer" style="background-color:#ffffff;padding:22px 36px;border:0.5px solid #e5e7eb;border-radius:16px 16px 0 0;border-bottom:none;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td class="hero-slab" style="background-color:#F8F9FF;border-radius:12px;padding:0;overflow:hidden;">
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      <tr>
                        <td class="hero-logo-row" colspan="2" style="padding:8px 18px 10px 18px;text-align:left;vertical-align:top;">
                          <table cellpadding="0" cellspacing="0" role="presentation">
                            <tr>
                              <td style="padding:0 8px 0 0;vertical-align:middle;">
                                <img class="hero-logo-img" src="{{logo_url}}" width="132" height="132" alt="" style="display:block;height:36px;width:auto;max-width:140px;border:0;outline:none;text-decoration:none;" />
                              </td>
                              <td style="vertical-align:middle;padding:0;">
                                <span class="hero-wordmark" style="font-size:16px;font-weight:700;color:#1a1f36;letter-spacing:-0.02em;line-height:1.1;">PitchCV</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td class="hero-inner" style="padding:10px 14px 10px 18px;vertical-align:middle;width:52%;text-align:left;">

                          <p class="hero-title" style="margin:0;font-size:26px;font-weight:600;line-height:1.18;color:#2d3348;">
                            <span class="hero-line" style="display:block;">You've built a</span>
                            <span class="hero-line" style="display:block;">strong resume —</span>
                            <span class="hero-line" style="display:block;">now use it</span>
                          </p>

                        </td>

                        <td class="hero-illus-cell" align="right" style="width:48%;vertical-align:middle;padding:0 12px 0 0;text-align:right;line-height:0;">
                          <img class="illus" src="{{hero_image_url}}" width="175" alt="" style="display:block;width:175px;max-width:100%;height:auto;margin-left:auto;" />
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td class="body-cell" style="background-color:#ffffff;padding:36px;border:0.5px solid #e5e7eb;border-top:none;">

              <p style="margin:0 0 16px 0;font-size:16px;line-height:1.7;color:#6b7280;">
                Your resume is now stronger, clearer, and aligned with your target role — <strong style="font-weight:700;color:#1f2937;">ready to send</strong>.
              </p>

              <p style="margin:0 0 32px 0;font-size:16px;line-height:1.7;color:#6b7280;">
                Don't leave it sitting here.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td align="center" style="padding:0;">
                    <a href="{{download_url}}" style="display:inline-block;padding:14px 28px;background-color:#1D4ED8;color:#ffffff;text-align:center;border-radius:10px;font-size:15px;font-weight:600;text-decoration:none;">
                      View your resume
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:28px 0 0 0;font-size:15px;line-height:1.65;color:#4b5563;">
                With best wishes,<br/>
                <span style="font-weight:600;color:#1f2937;">Anna</span><br/>
                <span style="font-size:14px;color:#6b7280;">The PitchCV team</span>
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:32px 0;">
                <tr><td style="height:1px;background-color:#e5e7eb;font-size:0;line-height:0;">&nbsp;</td></tr>
              </table>

              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
                This result is saved for your current session. Once it expires, you'll need to start over.
              </p>

            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td class="footer-cell" style="background-color:#f9fafb;border-radius:0 0 16px 16px;padding:24px 36px;border:0.5px solid #e5e7eb;border-top:none;">
              <p style="margin:0 0 10px 0;font-size:12px;color:#9ca3af;">
                <a href="{{unsubscribe_url}}" style="color:#9ca3af;text-decoration:none;margin-right:20px;">Unsubscribe</a>
                <a href="https://www.pitchcv.app/privacy" style="color:#9ca3af;text-decoration:none;margin-right:20px;">Privacy</a>
                <a href="https://www.pitchcv.app/terms" style="color:#9ca3af;text-decoration:none;">Terms</a>
              </p>
              <p style="margin:0;font-size:12px;color:#9ca3af;">PitchCV · 71-75 Shelton Street, London WC2H 9FE, United Kingdom</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>
`;
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
