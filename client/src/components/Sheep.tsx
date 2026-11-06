// Compter les moutons : le petit jeu de celui qui devine, les yeux fermés, pendant que les autres écrivent.
// Les moutons courent vers la barrière ; un appui fait sauter le premier. Rien ici ne touche à la partie.
import { useEffect, useRef, useState } from 'react';
import { vibrate } from '../lib/util';

/** La scène en unités logiques, mise à l'échelle de l'écran. */
const W = 360;
const H = 180;
const GROUND = 150;
const FENCE_X = 236;
const FENCE_HALF = 13;
const FENCE_H = 34;
/** Les moutons sont dessinés un peu plus grands que leurs mesures de base. */
const SIZE = 1.2;
const BODY_HALF = 23 * SIZE;
/** Hauteur d'un saut, et distance parcourue en l'air : à toute vitesse, la fenêtre se resserre. */
const JUMP_H = 76;
const JUMP_LEN = 152;
/** Un peu d'indulgence : frôler la barrière ne compte pas. */
const SLACK = 5;

interface Ewe {
  x: number;
  /** Hauteur des sabots au-dessus du sol. */
  y: number;
  vy: number;
  g: number;
  passed: boolean;
  /** Le moment où il s'est cogné, en secondes de jeu. */
  bumped: number | null;
  phase: number;
}

const speedFor = (jumped: number) => Math.min(118 + jumped * 6, 290);

/** Le compte des moutons sautés ; `onDone` le reçoit quand l'écran se ferme (les yeux se rouvrent). */
export function SheepGame({ onDone }: { onDone: (count: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [count, setCount] = useState(0);
  const [started, setStarted] = useState(false);
  const counted = useRef(0);
  const done = useRef(onDone);
  done.current = onDone;
  const jump = useRef<() => void>(() => {});

  useEffect(() => {
    return () => {
      if (counted.current > 0) done.current(counted.current);
    };
  }, []);

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const flock: Ewe[] = [];
    const stars = Array.from({ length: 22 }, (_, i) => ({ x: (i * 97) % W, y: 8 + ((i * 53) % 92), r: 0.8 + ((i * 7) % 3) * 0.5, t: i }));
    let time = 0;
    let last = performance.now();
    let gap = 0;
    let raf = 0;
    let scale = 1;
    const hand = getComputedStyle(cv).getPropertyValue('--hand').trim() || 'cursive';

    const fit = () => {
      const w = cv.clientWidth || W;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      scale = w / W;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(H * scale * dpr);
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(cv);

    jump.current = () => {
      const front = flock.filter((e) => e.bumped === null && e.y === 0 && e.x < FENCE_X).sort((a, b) => b.x - a.x)[0];
      if (!front) return;
      const v = speedFor(counted.current);
      const t = JUMP_LEN / v;
      front.g = (8 * JUMP_H) / (t * t);
      front.vy = front.g * (t / 2);
    };

    const step = (dt: number) => {
      time += dt;
      const v = speedFor(counted.current);
      const lastOne = flock[flock.length - 1];
      if (!lastOne || lastOne.x > gap) {
        flock.push({ x: -BODY_HALF - 4, y: 0, vy: 0, g: 0, passed: false, bumped: null, phase: Math.random() * 6 });
        gap = 200 + Math.random() * 130 - BODY_HALF;
      }
      for (const e of flock) {
        if (e.bumped !== null) continue;
        e.x += v * dt;
        e.phase += dt * v * 0.09;
        if (e.vy !== 0 || e.y > 0) {
          e.y += e.vy * dt;
          e.vy -= e.g * dt;
          if (e.y <= 0) {
            e.y = 0;
            e.vy = 0;
          }
        }
        const over = Math.abs(e.x - FENCE_X) < FENCE_HALF + BODY_HALF - SLACK;
        if (over && e.y < FENCE_H - SLACK) {
          e.bumped = time;
          vibrate(25);
        } else if (!e.passed && e.x - BODY_HALF > FENCE_X + FENCE_HALF) {
          e.passed = true;
          counted.current++;
          setCount(counted.current);
        }
      }
      for (let i = flock.length - 1; i >= 0; i--) {
        const e = flock[i];
        if (e.x > W + 40 || (e.bumped !== null && time - e.bumped > 0.9)) flock.splice(i, 1);
      }
    };

    const line = (pts: [number, number][]) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    };

    const drawEwe = (e: Ewe) => {
      const dazed = e.bumped !== null ? time - e.bumped : null;
      const bob = e.y === 0 && dazed === null ? Math.abs(Math.sin(e.phase)) * 2 : 0;
      ctx.save();
      ctx.translate(e.x, GROUND - e.y - 16 * SIZE - bob);
      if (dazed !== null) {
        ctx.globalAlpha = Math.max(0, 1 - dazed / 0.9);
        ctx.translate(-dazed * 30, 0);
        ctx.rotate(-0.5 * Math.min(1, dazed * 4));
      }
      ctx.scale(SIZE, SIZE);
      // Les pattes : elles trottent au sol, se replient en l'air.
      ctx.strokeStyle = '#2a2e5c';
      ctx.lineWidth = 3.4;
      ctx.lineCap = 'round';
      const air = e.y > 0;
      const swing = air ? 0 : Math.sin(e.phase) * 4;
      for (const [lx, s] of [[-13, 1], [-6, -1], [8, 1], [14, -1]] as const) {
        if (air) line([[lx, 8], [lx + (lx < 0 ? -6 : 6), 13]]);
        else line([[lx, 8], [lx + swing * s, 17 + bob]]);
      }
      // La toison : des boucles blanches, cernées comme au feutre.
      ctx.fillStyle = '#fffefa';
      ctx.strokeStyle = '#c9cfee';
      ctx.lineWidth = 1.6;
      const puffs: [number, number, number][] = [[-14, 0, 9], [-5, -7, 10], [6, -6, 10], [14, 0, 8], [4, 4, 9], [-8, 4, 9]];
      for (const [px, py, r] of puffs) {
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      for (const [px, py, r] of puffs) {
        ctx.beginPath();
        ctx.arc(px, py, r - 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      // La tête, l'oreille et l'œil (en croix quand il s'est cogné).
      ctx.fillStyle = '#2a2e5c';
      ctx.beginPath();
      ctx.ellipse(23, -4, 7.5, 9, 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(17, -11, 5, 2.6, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fffefa';
      ctx.fillStyle = '#fffefa';
      ctx.lineWidth = 1.6;
      if (dazed !== null) {
        line([[23, -8], [27, -4]]);
        line([[27, -8], [23, -4]]);
      } else {
        ctx.beginPath();
        ctx.arc(25.5, -6, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      if (dazed !== null) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - dazed / 0.9);
        ctx.fillStyle = '#fffefa';
        ctx.font = `800 15px ${hand}`;
        ctx.textAlign = 'center';
        ctx.fillText('bêê !', e.x - dazed * 30, GROUND - FENCE_H - 30 - dazed * 18);
        ctx.restore();
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      // Les étoiles, qui scintillent doucement.
      for (const s of stars) {
        ctx.globalAlpha = 0.35 + 0.35 * Math.sin(time * 1.4 + s.t);
        ctx.fillStyle = '#fffefa';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // La lune : un croissant découpé dans le ciel.
      ctx.save();
      ctx.beginPath();
      ctx.arc(318, 34, 17, 0, Math.PI * 2);
      ctx.fillStyle = '#f6f3c4';
      ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(309, 28, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Le sol, tracé à main levée.
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      line(Array.from({ length: 19 }, (_, i) => [i * 20, GROUND + 3 + Math.sin(i * 1.7) * 1.4] as [number, number]));
      // La barrière.
      ctx.strokeStyle = '#fffefa';
      ctx.lineWidth = 4;
      line([[FENCE_X - FENCE_HALF + 2, GROUND + 2], [FENCE_X - FENCE_HALF + 1, GROUND - FENCE_H - 6]]);
      line([[FENCE_X + FENCE_HALF - 2, GROUND + 2], [FENCE_X + FENCE_HALF - 1, GROUND - FENCE_H - 4]]);
      ctx.lineWidth = 3.4;
      line([[FENCE_X - FENCE_HALF - 5, GROUND - FENCE_H + 2], [FENCE_X + FENCE_HALF + 5, GROUND - FENCE_H]]);
      line([[FENCE_X - FENCE_HALF - 4, GROUND - FENCE_H / 2 + 2], [FENCE_X + FENCE_HALF + 4, GROUND - FENCE_H / 2 + 1]]);
      for (const e of flock) drawEwe(e);
    };

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      step(dt);
      draw();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const tap = () => {
    setStarted(true);
    jump.current();
  };

  return (
    <div
      className="sheep"
      role="button"
      tabIndex={0}
      aria-label="Faire sauter le mouton"
      onPointerDown={(e) => {
        e.preventDefault();
        tap();
      }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          tap();
        }
      }}
    >
      <canvas ref={canvas} className="sheep-scene" />
      <p className="sheep-count" aria-live="off">
        <b>{count}</b> {count > 1 ? 'moutons' : 'mouton'}
      </p>
      {!started && <p className="sheep-hint">Touche pour faire sauter les moutons</p>}
    </div>
  );
}
