// Briques d'interface communes : boutons, fenêtres, sélecteurs, logo, pastilles de joueur et tableaux blancs.
import { Check, X } from 'lucide-react';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MARKERS, type CancelReason } from '../../../shared/protocol';
import { cls } from '../lib/util';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'good' | 'bad';
  icon?: ReactNode;
}

export function Button({ variant = 'default', icon, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={cls('btn', `btn-${variant}`, className)} {...rest}>
      {icon}
      {children && <span className="btn-label">{children}</span>}
    </button>
  );
}

/** Un bouton lourd de conséquences : le premier appui demande confirmation, le second agit. */
export function ConfirmButton({ confirm, onConfirm, children, ...rest }: ButtonProps & { confirm: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3500);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <Button
      {...rest}
      className={cls(rest.className, armed && 'is-armed')}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirm : children}
    </Button>
  );
}

/** Le titre : « Just » au feutre, « One » surligné au fluo. */
export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className={cls('logo', `logo-${size}`)} role="img" aria-label="Just One">
      <span className="logo-just" aria-hidden>
        Just
      </span>
      <span className="logo-one" aria-hidden>
        One
      </span>
    </div>
  );
}

interface SegmentedOption<T> {
  value: T;
  label: string;
  sub?: string;
}

export function Segmented<T extends string | number | boolean>({ options, value, onChange, disabled, label }: { options: SegmentedOption<T>[]; value: T; onChange: (v: T) => void; disabled?: boolean; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} disabled={disabled} className={cls('seg', o.value === value && 'is-on')} onClick={() => onChange(o.value)}>
          <b>{o.label}</b>
          {o.sub && <small>{o.sub}</small>}
        </button>
      ))}
    </div>
  );
}

/**
 * Une fenêtre. Elle s'ouvre avec un petit mouvement en CSS, dont l'état final est l'état de repos,
 * et se ferme d'un coup : aucune animation de sortie dont dépendrait l'affichage suivant.
 */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => box.current?.querySelector<HTMLElement>('.modal-head button')?.focus({ preventScroll: true }), 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
      before?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  // Rendue à la racine du document : aucun écran ne peut la décaler ni la recouvrir.
  return createPortal(
    <div className="modal-back" onClick={onClose}>
      <div ref={box} className={cls('modal', wide && 'is-wide')} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn on-light" aria-label="Fermer" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function markerVar(marker: number): CSSProperties {
  return { '--m': MARKERS[marker % MARKERS.length] } as CSSProperties;
}

/** La pastille d'un joueur : son initiale, dans la couleur de son feutre. */
export function Dot({ name, marker, done, faded, className }: { name: string; marker: number; done?: boolean; faded?: boolean; className?: string }) {
  return (
    <span className={cls('dot', done && 'is-done', faded && 'is-faded', className)} style={markerVar(marker)} aria-hidden>
      {name.trim().charAt(0).toUpperCase() || '?'}
      {done && (
        <span className="dot-check">
          <Check size={10} strokeWidth={4} />
        </span>
      )}
    </span>
  );
}

export function fit(text: string): string {
  const n = text.length;
  return n <= 7 ? 'fit-xl' : n <= 11 ? 'fit-lg' : n <= 16 ? 'fit-md' : 'fit-sm';
}

function wordFit(word: string): string {
  const longest = Math.max(...word.split(/[\s-]/).map((w) => w.length));
  const n = Math.max(longest, word.length * 0.62);
  return n <= 6 ? 'word-xl' : n <= 9 ? 'word-lg' : n <= 13 ? 'word-md' : 'word-sm';
}

/** Le grand tableau : le mot à faire deviner, surligné au fluo. La clé relance le trait à chaque nouveau mot. */
export function WordBoard({ word, compact, label }: { word: string; compact?: boolean; label?: string }) {
  return (
    <div className={cls('wordboard', compact && 'is-compact')}>
      {label && <span className="wordboard-label">{label}</span>}
      <span key={word} className={cls('wordboard-word', wordFit(word))}>
        <span className="highlight">{word}</span>
      </span>
    </div>
  );
}

const REASON: Record<CancelReason, string> = { double: 'En double', close: 'Trop proche', manual: 'Effacé' };

/**
 * Un petit tableau sur son socle, à la couleur du feutre de son auteur.
 * Effacé, l'indice se brouille sous le passage de l'éponge. `readable` le garde lisible pour ceux qui doivent en juger,
 * et `spent` ne laisse que le mot barré, pour le résultat.
 */
export function Easel({ text, author, marker, cancelled, readable, spent, onClick }: { text: string | null; author?: string; marker: number; cancelled?: CancelReason | null; readable?: boolean; spent?: boolean; onClick?: () => void }) {
  const erased = !!cancelled;
  const body = (
    <>
      <span className="easel-board">
        {text != null && <span className={cls('easel-text', fit(text))}>{text}</span>}
        {erased && !spent && <span className="easel-smear" aria-hidden />}
        {erased && !spent && <span className="easel-sponge" aria-hidden />}
        {erased && !spent && <span className="easel-tag">{REASON[cancelled!]}</span>}
      </span>
      <span className="easel-foot" />
      {author && <span className="easel-author">{author}</span>}
    </>
  );
  const className = cls('easel', erased && 'is-erased', readable && 'is-readable', spent && 'is-spent', onClick && 'is-tappable');
  if (onClick) {
    return (
      <button type="button" className={className} style={markerVar(marker)} onClick={onClick} aria-pressed={erased} aria-label={`${text ?? 'Indice'} de ${author ?? '?'} : ${erased ? 'effacé, toucher pour rétablir' : 'toucher pour effacer'}`}>
        {body}
      </button>
    );
  }
  return (
    <div className={className} style={markerVar(marker)}>
      {body}
    </div>
  );
}
