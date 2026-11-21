const page = document.querySelector('.home-page');

function mountReveals(page, motion) {
  if (!('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver(entries => {
    for (const {isIntersecting, target} of entries) {
      if (!isIntersecting) continue;
      observer.unobserve(target);
      if (motion.matches && !target.matches(':focus-within')) {
        target.setAttribute('data-revealing', '');
      }
    }
  }, {rootMargin: `0px 0px -${Math.round(innerHeight * .08)}px`});

  for (const element of page.querySelectorAll('[data-reveal]')) observer.observe(element);

  function finish(event) {
    if (event.animationName === 'home-reveal') event.target.removeAttribute('data-revealing');
  }

  page.addEventListener('animationend', finish);
  page.addEventListener('animationcancel', finish);
  page.addEventListener('focusin', event => {
    if (!event.target.matches(':focus-visible')) return;
    for (let element = event.target; element && element !== page; element = element.parentElement) {
      element.removeAttribute('data-revealing');
    }
  });
}

function mountChapterColor(page, motion) {
  const sections = [...page.querySelectorAll('[data-tone]')];
  if (!sections.length) return;

  const tones = getComputedStyle(page);
  const color = name => tones.getPropertyValue(`--tone-${name}`).trim().match(/\d+/g)?.map(Number) ?? [];
  const base = color('paper');
  if (base.length !== 3) return;
  const chapters = sections.map(section => ({section, tone: color(section.dataset.tone)}))
    .filter(chapter => chapter.tone.length === 3);

  let frame = 0;
  let measure = true;
  let previous;

  function paint() {
    frame = 0;
    const top = scrollY;
    const height = innerHeight;
    if (measure) {
      for (const chapter of chapters) {
        chapter.top = chapter.section.getBoundingClientRect().top + top;
      }
      measure = false;
    }

    let current = base;
    for (const {tone, top: next} of chapters) {
      if (!motion.matches) {
        if (next <= top + height * .5) current = tone;
        continue;
      }
      const fraction = Math.max(0, Math.min(1, (top + height * .78 - next) / (height * .60)));
      if (!fraction) continue;
      if (fraction === 1) {
        current = tone;
        continue;
      }
      const eased = fraction * fraction * (3 - 2 * fraction);
      current = current.map((channel, index) => channel + (tone[index] - channel) * eased);
    }

    const fill = `rgb(${current.map(Math.round).join(' ')})`;
    if (fill !== previous) page.style.setProperty('--home-paper', fill);
    previous = fill;
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(paint);
  }

  function refresh() {
    measure = true;
    schedule();
  }

  addEventListener('scroll', schedule, {passive: true});
  addEventListener('resize', refresh, {passive: true});
  addEventListener('pageshow', refresh);
  motion.addEventListener('change', schedule);
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(refresh);
    observer.observe(page);
    for (const {section} of chapters) observer.observe(section);
  }
  paint();
}

if (page) {
  const motion = matchMedia('(prefers-reduced-motion: no-preference)');
  mountReveals(page, motion);
  mountChapterColor(page, motion);
}
