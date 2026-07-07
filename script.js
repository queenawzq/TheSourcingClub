const modal = document.querySelector('#waitlistModal');
const openButtons = document.querySelectorAll('.js-open-modal');
const closeButtons = document.querySelectorAll('.js-close-modal');
const motionTargets = document.querySelectorAll(
  '.stats div, .problem-title, .calculator, .issue-card, .how-copy, .steps article, .level-card, .standard-copy, .comparison-section h2, .comparison, .pricing-copy, .price-card, .faq-copy, .faq-grid article, .final-copy, .closing-people'
);

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

document.body.classList.add('motion-ready');

motionTargets.forEach((target, index) => {
  target.classList.add('reveal');
  target.style.setProperty('--reveal-delay', `${Math.min(index % 4, 3) * 80}ms`);
});

if (prefersReducedMotion) {
  motionTargets.forEach((target) => target.classList.add('is-visible'));
} else if ('IntersectionObserver' in window) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.14 }
  );

  motionTargets.forEach((target) => revealObserver.observe(target));
} else {
  motionTargets.forEach((target) => target.classList.add('is-visible'));
}

function openModal() {
  modal?.classList.add('is-open');
  modal?.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  modal?.querySelector('input')?.focus();
}

function closeModal() {
  modal?.classList.remove('is-open');
  modal?.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}

openButtons.forEach((button) => button.addEventListener('click', openModal));
closeButtons.forEach((button) => button.addEventListener('click', closeModal));

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal();
});

document.querySelectorAll('form').forEach((form) => {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    if (submit) {
      submit.textContent = 'You are on the list';
      submit.disabled = true;
    }
  });
});
