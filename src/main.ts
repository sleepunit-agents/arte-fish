import './styles/reset.css';
import './styles/tokens.css';
import './styles/typography.css';
import './styles/layout.css';

import { prefersReducedMotion } from './motion';
import { applyStaticFallback } from './fallback';
import { createCrossCanvas } from './canvas/cross-canvas';
import { createReactionDiffusion } from './canvas/reaction-diffusion';

function init() {
  const canvas = document.getElementById('bg-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;

  if (prefersReducedMotion()) {
    applyStaticFallback(canvas);
    return;
  }

  // Try the cross face first: live Gray-Scott field driven by presence /state.
  // Falls back to the idle reaction-diffusion if WebGL2 is unavailable.
  const fxCanvas = document.getElementById('fx-canvas') as HTMLCanvasElement | null;
  const crossFace = fxCanvas
    ? createCrossCanvas(canvas, fxCanvas, { stateUrl: 'https://presence.one.sleepunit.com' })
    : null;

  if (crossFace) {
    const hero = canvas.closest('.hero');
    if (!hero || typeof IntersectionObserver === 'undefined') {
      crossFace.start();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) crossFace.start();
          else crossFace.stop();
        }
      },
      { threshold: 0.01 },
    );
    observer.observe(hero);
    return;
  }

  // Fallback: idle Gray-Scott (WebGL1, no presence) — same as the previous canvas.
  const rd = createReactionDiffusion(canvas);
  if (!rd) {
    applyStaticFallback(canvas);
    return;
  }

  const hero = canvas.closest('.hero');
  if (!hero || typeof IntersectionObserver === 'undefined') {
    rd.start();
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) rd.start();
        else rd.stop();
      }
    },
    { threshold: 0.01 },
  );
  observer.observe(hero);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
