// Contrat partagé entre le serveur et le client : réglages, vues de table et règles de comparaison des mots.

export const MIN_PLAYERS = 3;
/** La boîte s'arrête à 7 faute de chevalets ; ici on accueille une plus grande tablée. */
export const MAX_PLAYERS = 10;
export const CLUE_MAX = 24;
export const ANSWER_MAX = 40;

/** La réponse de celui qui devine : dite à voix haute et validée par les autres, ou tapée dans l'appli. */
export type AnswerMode = 'oral' | 'written';
export const CARD_OPTIONS = [13, 7] as const;
export type CardSetting = (typeof CARD_OPTIONS)[number];
export const TIMER_OPTIONS = [0, 45, 90] as const;
export type TimerSetting = (typeof TIMER_OPTIONS)[number];

export const THEMES = [
  { id: 'maison', label: 'Maison', emoji: '🛋️' },
  { id: 'nature', label: 'Nature & animaux', emoji: '🦊' },
  { id: 'cuisine', label: 'À table', emoji: '🍕' },
  { id: 'lieux', label: 'Lieux & voyages', emoji: '✈️' },
  { id: 'gens', label: 'Métiers & gens', emoji: '🧑‍🚒' },
  { id: 'loisirs', label: 'Sports & loisirs', emoji: '⚽' },
  { id: 'science', label: 'Sciences & techno', emoji: '🔬' },
  { id: 'histoire', label: 'Histoire & légendes', emoji: '🐉' },
  { id: 'ecran', label: 'Films, séries & jeux', emoji: '🎬' },
  { id: 'arts', label: 'Musique & arts', emoji: '🎸' },
  { id: 'idees', label: 'Idées & émotions', emoji: '💭' },
] as const;
export type ThemeId = (typeof THEMES)[number]['id'];
export const THEME_IDS = THEMES.map((t) => t.id) as ThemeId[];

export interface Settings {
  answer: AnswerMode;
  /** La longueur de la partie : 13 cartes comme dans la boîte, ou 7 pour aller vite. */
  cards: CardSetting;
  /** Temps pour écrire son indice, en secondes (0 : sans limite). */
  timer: TimerSetting;
  themes: ThemeId[];
}

/** « Idées & émotions » est plus corsé : on l'ajoute si on veut, il n'est pas là d'office. */
export const DEFAULT_SETTINGS: Settings = { answer: 'oral', cards: 13, timer: 0, themes: THEME_IDS.filter((t) => t !== 'idees') };

/** Le feutre de chacun : sa couleur sur les tableaux. */
export const MARKERS = ['#e5262d', '#1f4fe0', '#0b9a4f', '#8a2be2', '#f2720c', '#0a97a8', '#df1f88', '#7a4a21', '#2b2d42', '#a87f00'] as const;

/** Des réactions, le temps de souffler entre deux cartes. */
export const EMOTES = ['😂', '🤯', '🔥', '🙈', '🫡', '👏'] as const;

export type PlayerStatus = 'lobby' | 'playing' | 'spectator';

export interface PlayerView {
  id: string;
  name: string;
  marker: number;
  isHost: boolean;
  connected: boolean;
  /** Parti, ou déconnecté depuis un moment : on ne l'attend plus. */
  away: boolean;
  status: PlayerStatus;
}

/**
 * Une carte : les autres écrivent chacun leur indice, comparent (les doublons s'effacent),
 * puis celui qui devine a droit à une seule réponse.
 */
export type Stage = 'write' | 'check' | 'guess' | 'result';
/** found : trouvé ; missed : raté, perd aussi la carte suivante ; passed : passé ; empty : tous les indices effacés. */
export type Outcome = 'found' | 'missed' | 'passed' | 'empty';
export type Penalty = 'next' | 'success' | null;
export type Pip = 'found' | 'lost' | 'current' | 'left';
/** double : indices identiques ou de même famille ; close : trop proche du mot ; manual : effacé par un joueur. */
export type CancelReason = 'double' | 'close' | 'manual';
export type Role = 'guesser' | 'giver' | 'watcher';

export interface ClueView {
  id: string;
  author: string;
  /** Null quand celui qui devine ne doit pas le voir : un indice effacé reste caché jusqu'au résultat. */
  text: string | null;
  cancelled: CancelReason | null;
}

export interface RoundView {
  n: number;
  stage: Stage;
  seq: number;
  role: Role;
  guesser: string;
  nextGuesser: string | null;
  /** Le mot. Jamais pour celui qui devine avant le résultat. */
  word: string | null;
  /** Combien d'indices par joueur : 2 à trois joueurs. */
  slots: number;
  givers: string[];
  /** Ceux qui ont fini d'écrire, sans dire quoi. */
  written: string[];
  /** Tes indices en cours, que toi seul vois. */
  mine: string[];
  clues: ClueView[];
  ready: string[];
  endsAt: number;
  /** Le mot a changé parce qu'un joueur ne le connaissait pas. */
  swap: { by: string; n: number } | null;
  /** La réponse tapée, en mode écrit. */
  answer: string | null;
  outcome: Outcome | null;
  penalty: Penalty;
}

export interface GameView {
  total: number;
  found: number;
  /** Les cartes encore dans la pioche. */
  left: number;
  pips: Pip[];
  round: RoundView;
}

export interface CardRecap {
  n: number;
  word: string;
  guesser: string;
  outcome: Outcome;
  answer: string | null;
  penalty: Penalty;
  clues: { text: string; author: string; marker: number; cancelled: boolean }[];
}

export interface FinalView {
  total: number;
  found: number;
  cards: CardRecap[];
  /** Les deux joueurs qui ont le plus souvent écrit la même chose. */
  soulmates: { a: string; b: string; count: number } | null;
  /** Un mot trouvé grâce à un seul indice. */
  solo: string | null;
}

export interface RoomView {
  code: string;
  phase: 'lobby' | 'playing' | 'finished';
  me: string;
  hostId: string;
  settings: Settings;
  players: PlayerView[];
  game: GameView | null;
  final: FinalView | null;
  serverNow: number;
}

export type Ack<T = unknown> = (res: { ok: boolean; error?: string; data?: T }) => void;

/** Le palier de fin de partie, d'après le barème de la boîte. Une partie courte est ramenée à 13 cartes. */
export function tierFor(found: number, total: number): { title: string; line: string } {
  const score = total === 13 ? found : Math.round((found * 13) / Math.max(1, total));
  if (score >= 13) return { title: 'Score parfait !', line: 'Pas une carte de perdue. Vous partagez un seul cerveau.' };
  if (score === 12) return { title: 'Incroyable !', line: 'Il ne vous manque qu’une carte pour la perfection.' };
  if (score === 11) return { title: 'Excellent !', line: 'Vos amis vont vous détester.' };
  if (score >= 9) return { title: 'Très beau score', line: 'Vous vous comprenez à demi-mot. À un mot, même.' };
  if (score >= 7) return { title: 'Dans la moyenne', line: 'Honorable, et il y a de la marge. Une autre ?' };
  if (score >= 4) return { title: 'Bon début', line: 'Ça commence à venir. Une autre ?' };
  return { title: 'Ça arrive…', line: 'Vous avez tous eu la même idée, c’est déjà beau. On retente ?' };
}

/** Nettoie un texte saisi : une ligne, sans caractères de contrôle. */
export function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const ARTICLES = /^(le|la|les|l|un|une|des|du|de la|de l|d)\s+/;

/** La forme d'un mot pour le comparer : sans accents, majuscules, article, ponctuation ni pluriel simple. */
export function normalize(raw: string): string {
  const base = raw
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(ARTICLES, '');
  return base
    .split(' ')
    .map((w) => (w.length > 3 ? w.replace(/(s|x)$/, '') : w))
    .join(' ');
}

/** La clé de comparaison. Un indice fait d'un symbole (« € ») se compare tel quel. */
function key(raw: string): string {
  return normalize(raw).replace(/ /g, '') || raw.trim();
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

function sharedStart(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * Deux mots que la règle tient pour identiques : le même mot, sa variante (genre, nombre),
 * sa famille ou une faute de frappe. L'appli en efface d'office, et les joueurs peuvent en rétablir :
 * mieux vaut en signaler un de trop que d'en laisser passer un.
 */
export function closeWords(a: string, b: string): boolean {
  const x = key(a);
  const y = key(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.replace(/e$/, '') === y.replace(/e$/, '')) return true;
  const short = Math.min(x.length, y.length);
  const long = Math.max(x.length, y.length);
  if (short < 4) return false;
  const start = sharedStart(x, y);
  // « Prince » et « Princesse », « Roman » et « Romancier », mais pas « Chat » et « Château ».
  if (start === short && short / long >= (short >= 5 ? 0.5 : 0.6)) return true;
  // « Chanter » et « Chanteur ».
  if (start >= 5 && start / long >= 0.7) return true;
  // Une faute de frappe, mais pas « Bateau » et « Gâteau ».
  return short >= 5 && x[0] === y[0] && distance(x, y) <= 1;
}

function wordParts(word: string): string[] {
  return normalize(word)
    .split(' ')
    .filter((w) => w.length > 2);
}

/** Ce qui rend un indice irrecevable, et qu'on signale tout de suite à son auteur. */
export function clueProblem(clue: string, word: string): string | null {
  const text = clue.trim();
  if (!text) return 'Écris ton indice.';
  if (/\s/.test(text)) return 'Un seul mot !';
  if (key(text) === key(word)) return 'C’est le mot à faire deviner !';
  if (wordParts(word).includes(key(text))) return 'Ce mot fait partie de la réponse.';
  return null;
}

/** Trop proche du mot : on prévient l'auteur, et la table décide au moment de comparer. */
export function clueTooClose(clue: string, word: string): boolean {
  const text = clue.trim();
  if (!text) return false;
  return closeWords(text, word) || wordParts(word).some((part) => closeWords(text, part));
}

/** La réponse tapée est-elle la bonne ? Le pluriel, les accents, l'article ou une faute de frappe ne comptent pas. */
export function rightAnswer(answer: string, word: string): boolean {
  const x = key(answer);
  const y = key(word);
  if (!x || !y) return false;
  if (x === y) return true;
  return Math.min(x.length, y.length) >= 5 && distance(x, y) <= 1;
}
