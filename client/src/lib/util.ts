import { useEffect, useState } from 'react';
import { serverNow } from '../store';

export function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${Math.abs(n) > 1 ? 's' : ''}`;
}

/** « Léa », « Léa et Max », « Léa, Max et Zino ». */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
}

/** Force un rendu régulier (comptes à rebours). */
export function useTick(ms = 250): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function secondsLeft(endsAt: number, now: number): number {
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

export function shareUrl(code: string): string {
  return `${window.location.origin}/t/${code}`;
}

export function vibrate(pattern: number | number[]): void {
  try {
    // Le navigateur refuse de vibrer tant que le joueur n'a rien touché dans la page.
    if (navigator.userActivation?.hasBeenActive === false) return;
    navigator.vibrate?.(pattern);
  } catch {
    /* non supporté */
  }
}

/** L'utilisateur a demandé moins d'animations. */
export function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** La barre du navigateur prend la couleur de l'écran. */
export function useThemeColor(color: string): void {
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
    document.body.style.backgroundColor = color;
  }, [color]);
}

/** Pendant une partie, l'écran reste allumé : on ne rate pas le moment de répondre. */
export function useWakeLock(): void {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    let gone = false;
    const ask = async () => {
      try {
        const nav = navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
        if (document.visibilityState !== 'visible' || !nav.wakeLock) return;
        const got = await nav.wakeLock.request('screen');
        if (gone) void got.release();
        else lock = got;
      } catch {
        /* refusé, ou batterie faible : l'écran s'éteindra normalement */
      }
    };
    void ask();
    document.addEventListener('visibilitychange', ask);
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', ask);
      void lock?.release().catch(() => undefined);
    };
  }, []);
}
