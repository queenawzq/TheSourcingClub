const modal = document.querySelector('#waitlistModal');
const openButtons = document.querySelectorAll('.js-open-modal');
const closeButtons = document.querySelectorAll('.js-close-modal');

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
