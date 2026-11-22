const moods = {
  street: {color: '191,187,244', light: '196,163,252', count: 64, fall: 0.34},
  cocoa: {color: '255,198,135', light: '255,185,117', count: 34, fall: -0.036},
  stage: {color: '225,187,250', light: '217,146,250', count: 45, fall: -0.018}
};

export function mountAtmosphere(opening, motion) {
  const canvas = opening.querySelector('.atmosphere');
  const context = canvas.getContext('2d');
  if (!context) return () => {};

  const art = canvas.parentElement;
  const print = art.querySelector('.print-window');
  const toggle = opening.querySelector('.motion-toggle');
  const hover = matchMedia('(hover: hover) and (pointer: fine)');
  let mood = moods.street;
  let paused = false, visible = true, frame = 0, previousTime = 0;
  let targetX = 0.72, targetY = 0.5, lightX = targetX, lightY = targetY;
  let offsetX = 0, offsetY = 0;
  let particles = [];

  function populate() {
    const count = canvas.width < 540 ? Math.ceil(mood.count / 2) : mood.count;
    particles = Array.from({length: count}, () => ({
      x: Math.random(), y: Math.random(), scale: Math.random(), offset: Math.random() * Math.PI * 2
    }));
  }

  function rescale() {
    const {clientWidth: width, clientHeight: height} = art;
    const scale = Math.min(0.9, 760 / width);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    populate();
  }

  function render(time) {
    frame = requestAnimationFrame(render);
    if (time - previousTime < 32) return;
    const dt = Math.min(0.05, (time - previousTime) / 1000);
    previousTime = time;
    const {width, height} = canvas;
    if (!width || !height) return;

    lightX += (targetX - lightX) * 0.18;
    lightY += (targetY - lightY) * 0.18;
    const clock = time / 1000;
    const dx = Math.round((lightX - 0.72) * 140) / 10;
    const dy = Math.round((lightY - 0.5) * 100) / 10;
    if (dx !== offsetX || dy !== offsetY) {
      print.style.transform = dx || dy ? `translate3d(${dx}px, ${dy}px, 0)` : '';
      offsetX = dx;
      offsetY = dy;
    }
    context.clearRect(0, 0, width, height);

    const gx = (lightX + 0.033 * Math.sin(clock * 0.6)) * width;
    const gy = (lightY + 0.06 * Math.cos(clock * 0.44)) * height;
    const glow = context.createRadialGradient(gx, gy, 0, gx, gy, Math.max(1, width * 0.30));
    glow.addColorStop(0, 'rgba(' + mood.light + ',0.18)');
    glow.addColorStop(1, 'rgba(' + mood.light + ',0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);

    for (const particle of particles) {
      const {x, scale, offset} = particle;
      particle.y = (particle.y + dt * mood.fall * (0.4 + scale) + 1) % 1;
      const left = mood === moods.stage ? 0.50 + particle.y * 0.10 : 0.22;
      const px = (left + (0.995 - left) * x + 0.012 * Math.sin(clock + offset)) * width;
      const py = particle.y * height;
      const distance = Math.hypot(px / width - lightX, py / height - lightY);
      const alpha = Math.max(0.10, 0.44 - distance * 0.5) * (0.35 + scale * 0.65);
      const pigment = 'rgba(' + mood.color + ',' + alpha.toFixed(3) + ')';
      context.beginPath();
      if (mood === moods.street) {
        const length = 2 + scale * 13;
        context.strokeStyle = pigment;
        context.lineWidth = 0.5 + scale;
        context.moveTo(px, py);
        context.lineTo(px - 0.17 * length, py + length);
        context.stroke();
      } else {
        context.fillStyle = pigment;
        context.arc(px, py, 0.65 + (mood === moods.cocoa ? 3.2 : 1.85) * scale, 0, Math.PI * 2);
        context.fill();
      }
    }
  }

  function update() {
    toggle.hidden = !motion.matches;
    toggle.setAttribute('aria-pressed', String(paused));
    const playing = motion.matches && !paused && visible && !document.hidden;
    if (playing && !frame) {
      previousTime = 0;
      frame = requestAnimationFrame(render);
    } else if (!playing && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    if (!motion.matches) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      print.style.removeProperty('transform');
      offsetX = offsetY = 0;
      lightX = targetX = 0.72;
      lightY = targetY = 0.5;
    }
  }

  art.addEventListener('pointermove', event => {
    if (!frame || !hover.matches || event.pointerType !== 'mouse') return;
    const bounds = art.getBoundingClientRect();
    targetX = Math.min(0.94, Math.max(0.35, (event.clientX - bounds.left) / bounds.width));
    targetY = (event.clientY - bounds.top) / bounds.height;
  });
  art.addEventListener('pointerleave', () => { targetX = 0.72; targetY = 0.5; });
  toggle.addEventListener('click', () => { paused = !paused; update(); });
  motion.addEventListener('change', update);
  document.addEventListener('visibilitychange', update);
  const viewport = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); });
  viewport.observe(art);
  const size = new ResizeObserver(rescale);
  size.observe(art);
  rescale();
  update();
  return name => {
    mood = moods[name];
    populate();
    if (!frame) context.clearRect(0, 0, canvas.width, canvas.height);
  };
}
