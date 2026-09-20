import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "email-templates");

const variants = {
  brand: {
    eyebrow: "BRAND ONBOARDING",
    subject: "We’ve received your brand profile",
    preheader: "Your TSC brand profile is now in verification. We’ll email you when it’s ready.",
    title: "Your brand profile is in review.",
    intro: "Thanks for telling us about {{ brand_name }}. Your profile has been submitted and our team is now checking the details you shared.",
    reviewTitle: "What we’re reviewing",
    reviewItems: [
      ["Business details", "Your brand identity and company information"],
      ["Sourcing profile", "Product focus, order volume, and vendor preferences"],
      ["Trust information", "Any registration documents and supporting files"],
    ],
    nextTitle: "What happens next",
    nextCopy: "We’ll email you as soon as verification is complete. You can then sign back in, access your dashboard, and start connecting with vetted vendors.",
    cta: "View submission",
    reward: true,
    footerLine: "You’re receiving this because you submitted a brand profile to The Sourcing Club.",
  },
  factory: {
    eyebrow: "FACTORY ONBOARDING",
    subject: "We’ve received your factory profile",
    preheader: "Your TSC factory profile is now in verification. We’ll email you when it’s ready.",
    title: "Your factory profile is in review.",
    intro: "Thanks for introducing {{ company_name }}. Your factory profile has been submitted and our team is now checking the details you shared.",
    reviewTitle: "What we’re reviewing",
    reviewItems: [
      ["Business verification", "Registration details and submitted documents"],
      ["Production fit", "Categories, capabilities, capacity, and commercial terms"],
      ["Trust signals", "Certifications, references, and walkthrough materials"],
    ],
    nextTitle: "What happens next",
    nextCopy: "We’ll email you as soon as verification is complete. You can then sign back in, access your dashboard, and become discoverable to relevant brands.",
    cta: "View submission",
    reward: false,
    footerLine: "You’re receiving this because you submitted a factory profile to The Sourcing Club.",
  },
  "trading-company": {
    eyebrow: "TRADING COMPANY ONBOARDING",
    subject: "We’ve received your trading company profile",
    preheader: "Your TSC trading company profile is now in verification. We’ll email you when it’s ready.",
    title: "Your company profile is in review.",
    intro: "Thanks for introducing {{ company_name }}. Your trading company profile has been submitted and our team is now checking the details you shared.",
    reviewTitle: "What we’re reviewing",
    reviewItems: [
      ["Business verification", "Registration details and submitted documents"],
      ["Supplier network", "Production programs, sourcing regions, and order fit"],
      ["Oversight capabilities", "Development, quality, compliance, and client references"],
    ],
    nextTitle: "What happens next",
    nextCopy: "We’ll email you as soon as verification is complete. You can then sign back in, access your dashboard, and be matched with brands that fit your network.",
    cta: "View submission",
    reward: false,
    footerLine: "You’re receiving this because you submitted a trading company profile to The Sourcing Club.",
  },
};

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function reviewRows(items) {
  return items.map(([title, copy], index) => `
                    <tr>
                      <td width="32" valign="top" style="padding:${index ? "18px" : "0"} 0 0;">
                        <div style="width:24px;height:24px;line-height:24px;border-radius:12px;background:#EAF4FF;color:#1A4DF2;text-align:center;font-size:12px;font-weight:700;">${index + 1}</div>
                      </td>
                      <td valign="top" style="padding:${index ? "18px" : "0"} 0 0 10px;">
                        <p style="margin:0 0 3px;font-size:14px;line-height:20px;font-weight:700;color:#0B1020;">${escapeHtml(title)}</p>
                        <p style="margin:0;font-size:13px;line-height:19px;color:#5A6B87;">${escapeHtml(copy)}</p>
                      </td>
                    </tr>`).join("");
}

function rewardBlock(enabled) {
  if (!enabled) return "";
  return `
                <tr>
                  <td style="padding:0 40px 24px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0B1020;border-radius:8px;">
                      <tr>
                        <td style="padding:20px 22px;">
                          <p style="margin:0 0 5px;font-size:11px;line-height:16px;font-weight:700;color:#AFC2FF;text-transform:uppercase;">Welcome discount</p>
                          <p style="margin:0 0 5px;font-size:20px;line-height:25px;font-weight:700;color:#FFFFFF;">$50 off an eligible order</p>
                          <p style="margin:0;font-size:13px;line-height:19px;color:#CBD5E1;">It’ll be waiting in your account after verification. Invite another brand to earn another $50 discount.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>`;
}

function emailHtml(key, data) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${escapeHtml(data.subject)}</title>
    <style>
      @media only screen and (max-width: 620px) {
        .email-shell { width: 100% !important; }
        .email-pad { padding-left: 22px !important; padding-right: 22px !important; }
        .email-title { font-size: 27px !important; line-height: 32px !important; }
        .email-footer { padding-left: 22px !important; padding-right: 22px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#F1F4F8;color:#0B1020;font-family:'Satoshi',Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(data.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F1F4F8;">
      <tr>
        <td align="center" style="padding:36px 14px;">
          <table class="email-shell" role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;">
            <tr>
              <td style="padding:0 0 16px 4px;">
                <p style="margin:0;font-size:12px;line-height:16px;font-weight:800;color:#0B1020;letter-spacing:.04em;text-transform:uppercase;">THE SOURCING CLUB<span style="color:#1A4DF2;">.</span></p>
              </td>
            </tr>
            <tr>
              <td style="background:#FFFFFF;border:1px solid #D7E0EA;border-radius:8px;overflow:hidden;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr><td style="height:4px;line-height:4px;background:#1A4DF2;font-size:0;">&nbsp;</td></tr>
                  <tr>
                    <td class="email-pad" style="padding:38px 40px 24px;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="padding:6px 10px;background:#EAF4FF;border:1px solid #8DB7FF;border-radius:5px;color:#1A4DF2;font-size:11px;line-height:14px;font-weight:700;">SUBMITTED · IN REVIEW</td>
                        </tr>
                      </table>
                      <p style="margin:22px 0 10px;font-size:12px;line-height:16px;font-weight:700;color:#5A6B87;text-transform:uppercase;">${escapeHtml(data.eyebrow)}</p>
                      <h1 class="email-title" style="margin:0 0 14px;font-size:34px;line-height:39px;font-weight:800;color:#0B1020;">${escapeHtml(data.title)}</h1>
                      <p style="margin:0;font-size:15px;line-height:23px;color:#5A6B87;">${data.intro}</p>
                    </td>
                  </tr>
                  <tr>
                    <td class="email-pad" style="padding:0 40px 24px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F8FAFC;border:1px solid #D7E0EA;border-radius:8px;">
                        <tr>
                          <td style="padding:22px;">
                            <p style="margin:0 0 18px;font-size:17px;line-height:22px;font-weight:700;color:#0B1020;">${escapeHtml(data.reviewTitle)}</p>
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${reviewRows(data.reviewItems)}
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>${rewardBlock(data.reward)}
                  <tr>
                    <td class="email-pad" style="padding:0 40px 38px;">
                      <h2 style="margin:0 0 8px;font-size:17px;line-height:22px;font-weight:700;color:#0B1020;">${escapeHtml(data.nextTitle)}</h2>
                      <p style="margin:0 0 22px;font-size:14px;line-height:21px;color:#5A6B87;">${escapeHtml(data.nextCopy)}</p>
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td align="center" bgcolor="#1A4DF2" style="border-radius:34px;">
                            <a href="{{ dashboard_url }}" style="display:inline-block;padding:11px 20px;color:#FFFFFF;text-decoration:none;font-size:13px;line-height:18px;font-weight:700;">${escapeHtml(data.cta)}</a>
                          </td>
                        </tr>
                      </table>
                      <p style="margin:18px 0 0;font-size:12px;line-height:18px;color:#5A6B87;">No action is needed right now. If we need anything else, we’ll email you with clear next steps.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="email-footer" style="padding:20px 4px 0;color:#5A6B87;">
                <p style="margin:0 0 6px;font-size:12px;line-height:18px;">Questions? Reply to this email or contact <a href="mailto:{{ support_email }}" style="color:#1A4DF2;text-decoration:none;">{{ support_email }}</a>.</p>
                <p style="margin:0;font-size:11px;line-height:17px;">${escapeHtml(data.footerLine)}<br>The Sourcing Club · {{ company_address }}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function previewHtml() {
  const buttons = Object.entries(variants).map(([key, data], index) => `
          <button class="tab${index === 0 ? " active" : ""}" data-template="${key}" type="button" role="tab" aria-selected="${index === 0 ? "true" : "false"}">
            <span>${key === "trading-company" ? "Trading company" : key[0].toUpperCase() + key.slice(1)}</span>
            <small>${data.subject}</small>
          </button>`).join("");
  const frames = Object.keys(variants).map((key, index) => `
        <iframe class="email-frame${index === 0 ? " active" : ""}" data-frame="${key}" src="./onboarding-complete-${key}.html" title="${key} onboarding completion email"></iframe>`).join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>TSC onboarding emails</title>
    <style>
      @font-face{font-family:Satoshi;src:url(../assets/fonts/Satoshi-Regular.otf)}
      @font-face{font-family:Satoshi;src:url(../assets/fonts/Satoshi-Bold.otf);font-weight:700}
      @font-face{font-family:Satoshi;src:url(../assets/fonts/Satoshi-Black.otf);font-weight:900}
      *{box-sizing:border-box}body{margin:0;background:#0B1020;color:#fff;font-family:Satoshi,Arial,sans-serif}.shell{max-width:1120px;margin:0 auto;padding:48px 28px 64px}.kicker{margin:0 0 12px;color:#8DB7FF;font-size:12px;font-weight:700}.heading{max-width:760px;margin:0;font-size:38px;line-height:44px;font-weight:900}.intro{max-width:700px;margin:12px 0 30px;color:#B8C4D6;font-size:15px;line-height:23px}.tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px}.tab{appearance:none;border:1px solid #33415B;border-radius:8px;background:#141C2D;color:#fff;padding:16px;text-align:left;font:inherit;cursor:pointer}.tab span{display:block;font-size:14px;font-weight:700}.tab small{display:block;margin-top:4px;color:#91A0B8;font-size:11px;line-height:15px}.tab.active{background:#1A4DF2;border-color:#8DB7FF}.tab.active small{color:#DCE6FF}.stage{padding:24px;background:#E5EAF1;border-radius:12px;box-shadow:0 28px 80px rgba(0,0,0,.3)}.email-frame{display:none;width:100%;height:1020px;border:0;border-radius:8px;background:#F1F4F8}.email-frame.active{display:block}.note{margin:18px 4px 0;color:#91A0B8;font-size:12px;line-height:18px}@media(max-width:720px){.shell{padding:30px 14px}.heading{font-size:30px;line-height:35px}.tabs{grid-template-columns:1fr}.stage{padding:8px}.email-frame{height:1100px}}
    </style>
  </head>
  <body>
    <main class="shell">
      <p class="kicker">TSC · TRANSACTIONAL EMAIL SYSTEM</p>
      <h1 class="heading">Onboarding submission confirmation</h1>
      <p class="intro">Three audience-specific designs built from the same TSC components and the final onboarding state. Select a recipient type to review the send-ready email.</p>
      <div class="tabs" role="tablist" aria-label="Email recipient type">${buttons}
      </div>
      <section class="stage">${frames}
      </section>
      <p class="note">Template variables: recipient/company name, dashboard URL, support email, and company address. All production templates use table layout and inline styles for broad email-client support.</p>
    </main>
    <script>
      const tabs = [...document.querySelectorAll('.tab')];
      const frames = [...document.querySelectorAll('.email-frame')];
      const demoNames = { brand: 'Maison Rue', factory: 'Golden Thread Manufacturing', 'trading-company': 'Pacific Source Partners' };
      frames.forEach((frame) => frame.addEventListener('load', () => {
        const html = frame.contentDocument.body.innerHTML
          .replaceAll('{{ brand_name }}', demoNames.brand)
          .replaceAll('{{ company_name }}', demoNames[frame.dataset.frame])
          .replaceAll('{{ support_email }}', 'operations@thesourcingclub.com')
          .replaceAll('{{ company_address }}', 'New York, USA');
        frame.contentDocument.body.innerHTML = html;
      }));
      tabs.forEach((tab) => tab.addEventListener('click', () => {
        tabs.forEach((item) => item.classList.toggle('active', item === tab));
        tabs.forEach((item) => item.setAttribute('aria-selected', item === tab ? 'true' : 'false'));
        frames.forEach((frame) => frame.classList.toggle('active', frame.dataset.frame === tab.dataset.template));
      }));
    </script>
  </body>
</html>`;
}

await mkdir(outputDir, { recursive: true });
for (const [key, data] of Object.entries(variants)) {
  await writeFile(path.join(outputDir, `onboarding-complete-${key}.html`), emailHtml(key, data));
}
await writeFile(path.join(outputDir, "preview.html"), previewHtml());

console.log(`Generated ${Object.keys(variants).length} onboarding emails in ${outputDir}`);
