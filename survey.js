/**
 * Dual-host survey submission.
 *
 * On Netlify the form posts natively and is captured by Netlify Forms, so this
 * script deliberately does nothing. Anywhere else (Vercel, any static host)
 * Netlify Forms does not exist, so the submission is intercepted and sent to the
 * same Google Apps Script endpoint the marketing signup forms already use.
 *
 * `__DEPLOY_TARGET__` is replaced at build time from the host's own CI env vars
 * (see vite.config.js). The hostname check is a fallback for builds produced
 * outside either CI, e.g. a local build uploaded by hand.
 */
const BUILD_TARGET = __DEPLOY_TARGET__;
const googleSheetsUrl =
  'https://script.google.com/macros/s/AKfycbx9IDJRjpskLHrM2ry7nEiPxeXXyDUmlCswojA1p7nEheM5cXNtFwJIth1-N7DC2lRU/exec';

function detectDeployTarget() {
  if (BUILD_TARGET === 'netlify' || BUILD_TARGET === 'vercel') return BUILD_TARGET;

  const host = window.location.hostname;
  if (host.endsWith('.netlify.app') || host.endsWith('.netlify.com')) return 'netlify';
  if (host.endsWith('.vercel.app')) return 'vercel';
  return BUILD_TARGET;
}

const deployTarget = detectDeployTarget();
const form = document.querySelector('[data-survey-form]');

// Netlify Forms handles the native POST. Leave the form completely alone.
if (form && deployTarget !== 'netlify') {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const submit = form.querySelector('button[type="submit"]');
    const originalText = submit?.textContent || '';
    const thankYouUrl = form.getAttribute('action') || '/factory-survey-thank-you.html';

    // Honeypot: mimic a successful submit without recording anything.
    if (form.querySelector('[name="bot-field"]')?.value) {
      window.location.href = thankYouUrl;
      return;
    }

    if (submit) {
      submit.disabled = true;
      submit.textContent = '提交中...';
    }

    const formData = new FormData(form);
    formData.delete('bot-field');
    formData.append('source', 'factory-prototype-survey');
    formData.append('page', window.location.pathname);
    formData.append('submittedAt', new Date().toISOString());

    try {
      await fetch(googleSheetsUrl, {
        method: 'POST',
        body: formData,
        mode: 'no-cors'
      });
      window.location.href = thankYouUrl;
    } catch (error) {
      if (submit) {
        submit.disabled = false;
        submit.textContent = originalText;
      }
      form.querySelector('[data-survey-error]')?.removeAttribute('hidden');
    }
  });
}
