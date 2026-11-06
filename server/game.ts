// La partie : la pioche, la carte en cours et ses étapes. Aucune connaissance des sockets ni des réglages de la table.
import crypto from 'node:crypto';
import {
  ANSWER_MAX,
  CLUE_MAX,
  cleanText,
  closeWords,
  clueProblem,
  clueTooClose,
  rightAnswer,
  type CancelReason,
  type Outcome,
  type Penalty,
  type Pip,
  type Settings,
  type Stage,
} from '../shared/protocol';

export interface Clue {
  id: string;
  author: string;
  text: string;
  cancelled: CancelReason | null;
}

export interface Card {
  n: number;
  guesser: string;
  word: string;
  givers: string[];
  slots: number;
  stage: Stage;
  /** Les indices en cours d'écriture, par joueur. */
  texts: Map<string, string[]>;
  clues: Clue[];
  ready: Set<string>;
  endsAt: number;
  answer: string | null;
  outcome: Outcome | null;
  penalty: Penalty;
  swap: { by: string; n: number } | null;
  seq: number;
  /** Quand l'étape en cours s'est affichée : un appui trop tôt visait l'écran d'avant. */
  shownAt: number;
  /** Les moutons que celui qui devine a fait sauter, les yeux fermés. */
  sheep: number;
}

export interface CardRecord {
  n: number;
  guesser: string;
  word: string;
  clues: Clue[];
  outcome: Outcome;
  answer: string | null;
  penalty: Penalty;
  sheep: number;
}

/** Au-delà, ce n'est plus un mouton, c'est un téléphone trafiqué. */
const MAX_SHEEP = 999;

export interface GameDeps {
  settings: Settings;
  /** Les joueurs assis et encore à la table, dans l'ordre de la table. */
  seats: () => string[];
  isAway: (id: string) => boolean;
  drawWord: () => string;
  writeMs: number;
  /**
   * Le temps pendant lequel une étape qui vient d'apparaître ignore « Trouvé / Raté » et « Carte suivante ».
   * Deux joueurs touchent presque ensemble : sans ce délai, l'appui du second tombe sur le bouton de l'étape suivante.
   */
  holdMs?: number;
  now?: () => number;
}

function uid(): string {
  return crypto.randomBytes(6).toString('base64url');
}

export class Game {
  readonly total: number;
  card: Card | null = null;
  records: CardRecord[] = [];
  /** La pioche est vide, ou il n'y a plus assez de joueurs : la table conclut. */
  over = false;

  private order: string[] = [];
  private last: string | null = null;
  private seq = 0;

  constructor(private readonly deps: GameDeps) {
    this.total = deps.settings.cards;
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  /** L'étape vient d'apparaître : un appui maintenant visait celle d'avant. */
  private tooSoon(c: Card): boolean {
    return this.now() - c.shownAt < (this.deps.holdMs ?? 0);
  }

  // ───────────────────────────── Le décompte ─────────────────────────────

  /**
   * Refait le compte depuis le début à chaque fois : une correction après coup (« c'était bon ! ») reste juste.
   * Une erreur perd aussi la carte suivante, ou une carte déjà gagnée s'il n'en reste plus.
   */
  tally(): { found: number; left: number; pips: Pip[] } {
    let left = this.total;
    const pips: Pip[] = [];
    for (const r of this.records) {
      left--;
      r.penalty = null;
      if (r.outcome === 'found') {
        pips.push('found');
        continue;
      }
      pips.push('lost');
      if (r.outcome !== 'missed') continue;
      if (left > 0) {
        left--;
        pips.push('lost');
        r.penalty = 'next';
      } else {
        const i = pips.lastIndexOf('found');
        if (i >= 0) {
          pips[i] = 'lost';
          r.penalty = 'success';
        }
      }
    }
    const inPlay = this.card && this.card.stage !== 'result' ? 1 : 0;
    if (inPlay) pips.push('current');
    const remaining = Math.max(0, left - inPlay);
    for (let i = 0; i < remaining; i++) pips.push('left');
    return { found: pips.filter((p) => p === 'found').length, left: remaining, pips };
  }

  // ───────────────────────────── Distribution ─────────────────────────────

  /** Qui devine ensuite : au tour du voisin, en sautant ceux qui ne sont plus là. */
  peekGuesser(): string | null {
    const seats = this.deps.seats();
    const all = [...this.order, ...seats.filter((id) => !this.order.includes(id))];
    if (all.length === 0) return null;
    const from = this.last ? all.indexOf(this.last) : -1;
    let fallback: string | null = null;
    for (let i = 1; i <= all.length; i++) {
      const id = all[(from + i) % all.length];
      if (!seats.includes(id)) continue;
      if (!this.deps.isAway(id)) return id;
      fallback ??= id;
    }
    return fallback;
  }

  /** Une nouvelle carte. On n'y écrit plus l'étape précédente : tout repart de zéro. */
  deal(): void {
    const seats = this.deps.seats();
    const { left } = this.tally();
    const remaining = left + (this.card && this.card.stage !== 'result' ? 1 : 0);
    if (seats.length < 2 || remaining <= 0) {
      this.over = true;
      return;
    }
    for (const id of seats) if (!this.order.includes(id)) this.order.push(id);
    const guesser = this.peekGuesser() ?? seats[0];
    this.last = guesser;
    // À trois, chacun écrit deux indices : sinon il n'en resterait presque jamais après les doublons.
    const slots = seats.filter((id) => !this.deps.isAway(id)).length <= 3 ? 2 : 1;
    this.card = {
      n: this.records.length + 1,
      guesser,
      word: this.deps.drawWord(),
      givers: seats.filter((id) => id !== guesser),
      slots,
      stage: 'write',
      texts: new Map(),
      clues: [],
      ready: new Set(),
      endsAt: this.deps.writeMs > 0 ? this.now() + this.deps.writeMs : 0,
      answer: null,
      outcome: null,
      penalty: null,
      swap: null,
      seq: ++this.seq,
      shownAt: this.now(),
      sheep: 0,
    };
  }

  /** Un retardataire écrit dès cette carte s'il en est encore temps, sinon il regarde jusqu'à la suivante. */
  join(id: string): void {
    const c = this.card;
    if (c && c.stage === 'write' && id !== c.guesser && !c.givers.includes(id)) c.givers.push(id);
  }

  // ───────────────────────────── Écriture ─────────────────────────────

  write(by: string, slot: unknown, text: unknown): string | undefined {
    const c = this.card;
    if (!c || c.stage !== 'write') return 'Trop tard : les indices sont déjà comparés.';
    if (!c.givers.includes(by)) return "Ce n'est pas à toi d'écrire sur cette carte.";
    const s = Number(slot);
    if (!Number.isInteger(s) || s < 0 || s >= c.slots) return 'Indice inconnu.';
    const mine = c.texts.get(by) ?? Array.from({ length: c.slots }, () => '');
    const clue = cleanText(text, CLUE_MAX);
    if (clue) {
      const problem = clueProblem(clue, c.word);
      if (problem) return problem;
      if (mine.some((other, i) => i !== s && other && closeWords(other, clue))) return 'Écris deux indices bien différents.';
    }
    mine[s] = clue;
    c.texts.set(by, mine);
    return undefined;
  }

  hasWritten(c: Card, id: string): boolean {
    const mine = c.texts.get(id);
    return !!mine && mine.length === c.slots && mine.every(Boolean);
  }

  /** « Je ne connais pas ce mot » : un autre mot pour tout le monde, et on efface tout. */
  swapWord(by: string): string | undefined {
    const c = this.card;
    if (!c || c.stage !== 'write') return 'Trop tard pour changer de mot.';
    if (!c.givers.includes(by)) return 'Seuls ceux qui écrivent peuvent changer de mot.';
    c.word = this.deps.drawWord();
    c.texts.clear();
    c.swap = { by, n: (c.swap?.n ?? 0) + 1 };
    c.endsAt = this.deps.writeMs > 0 ? this.now() + this.deps.writeMs : 0;
    c.seq = ++this.seq;
    return undefined;
  }

  /** On pose les tableaux : les doublons et les indices trop proches du mot s'effacent d'office. */
  private toCheck(): void {
    const c = this.card!;
    const clues: Clue[] = [];
    for (const id of c.givers) {
      for (const text of c.texts.get(id) ?? []) if (text) clues.push({ id: uid(), author: id, text, cancelled: null });
    }
    for (const clue of clues) if (clueTooClose(clue.text, c.word)) clue.cancelled = 'close';
    for (let i = 0; i < clues.length; i++) {
      for (let j = i + 1; j < clues.length; j++) {
        if (closeWords(clues[i].text, clues[j].text)) {
          clues[i].cancelled ??= 'double';
          clues[j].cancelled ??= 'double';
        }
      }
    }
    c.clues = clues;
    c.endsAt = 0;
    c.ready.clear();
    if (clues.length === 0) return this.finish('empty');
    c.stage = 'check';
    c.seq = ++this.seq;
  }

  // ───────────────────────────── Comparaison ─────────────────────────────

  erase(by: string, clueId: unknown): string | undefined {
    const c = this.card;
    if (!c || c.stage !== 'check') return undefined;
    if (!c.givers.includes(by)) return 'Seuls ceux qui ont écrit comparent les indices.';
    const clue = c.clues.find((x) => x.id === clueId);
    if (!clue) return 'Indice introuvable.';
    clue.cancelled = clue.cancelled ? null : 'manual';
    // Le tableau a changé : chacun doit le revoir.
    c.ready.clear();
    return undefined;
  }

  ok(by: string): string | undefined {
    const c = this.card;
    if (!c || c.stage !== 'check') return undefined;
    if (!c.givers.includes(by)) return 'Seuls ceux qui ont écrit comparent les indices.';
    c.ready.add(by);
    return undefined;
  }

  private afterCheck(): void {
    const c = this.card!;
    if (c.clues.every((x) => x.cancelled)) return this.finish('empty');
    c.stage = 'guess';
    c.seq = ++this.seq;
    c.shownAt = this.now();
  }

  /** L'hôte n'attend plus un joueur distrait. */
  force(stage?: unknown): string | undefined {
    const c = this.card;
    // L'écran de l'hôte montrait une autre étape : son appui est arrivé trop tard.
    if (!c || (stage !== undefined && stage !== c.stage)) return undefined;
    if (c.stage === 'write') {
      if (![...c.texts.values()].some((mine) => mine.some(Boolean))) return "Personne n'a encore écrit.";
      this.toCheck();
    } else if (c.stage === 'check') this.afterCheck();
    return undefined;
  }

  // ───────────────────────────── Réponse ─────────────────────────────

  /** À voix haute : ceux qui connaissent le mot disent si c'est juste. */
  verdict(by: string, outcome: unknown, seq: unknown): string | undefined {
    const c = this.card;
    if (!c || c.stage !== 'guess' || seq !== c.seq || this.tooSoon(c)) return undefined;
    if (by === c.guesser) return 'Ce sont les autres qui valident ta réponse.';
    if (this.deps.settings.answer !== 'oral') return 'La réponse se tape dans l’appli.';
    if (outcome !== 'found' && outcome !== 'missed' && outcome !== 'passed') return 'Verdict inconnu.';
    this.finish(outcome);
    return undefined;
  }

  answer(by: string, text: unknown): string | undefined {
    const c = this.card;
    if (!c || c.stage !== 'guess') return undefined;
    if (by !== c.guesser) return "Ce n'est pas à toi de répondre.";
    const answer = cleanText(text, ANSWER_MAX);
    if (!answer) return 'Écris ta réponse.';
    c.answer = answer;
    this.finish(rightAnswer(answer, c.word) ? 'found' : 'missed');
    return undefined;
  }

  pass(by: string): string | undefined {
    const c = this.card;
    if (!c || c.stage !== 'guess') return undefined;
    if (by !== c.guesser) return "Ce n'est pas à toi de passer.";
    this.finish('passed');
    return undefined;
  }

  private finish(outcome: Outcome): void {
    const c = this.card!;
    c.stage = 'result';
    c.outcome = outcome;
    c.seq = ++this.seq;
    c.shownAt = this.now();
    this.records.push({ n: c.n, guesser: c.guesser, word: c.word, clues: c.clues, outcome, answer: c.answer, penalty: null, sheep: c.sheep });
    this.syncPenalty();
  }

  private syncPenalty(): void {
    this.tally();
    const c = this.card;
    const rec = this.records[this.records.length - 1];
    if (c && rec) c.penalty = rec.penalty;
  }

  /** La réponse a été mal jugée (« c'est le même mot ! ») : on rectifie avant de passer à la suite. */
  correct(by: string, isHost: boolean, outcome: unknown, seq?: unknown): string | undefined {
    const c = this.card;
    if (!c || c.stage !== 'result' || (seq !== undefined && seq !== c.seq)) return undefined;
    if (by === c.guesser && !isHost) return 'Ce sont les autres qui valident ta réponse.';
    if (outcome !== 'found' && outcome !== 'missed') return 'Verdict inconnu.';
    if (c.outcome !== 'found' && c.outcome !== 'missed') return 'Cette carte ne se rectifie pas.';
    c.outcome = outcome;
    this.records[this.records.length - 1].outcome = outcome;
    this.syncPenalty();
    return undefined;
  }

  /** Les yeux se rouvrent : celui qui devine dit combien de moutons il a fait sauter. Ça ne change rien au jeu. */
  sheep(by: string, n: unknown, count: unknown): string | undefined {
    const c = this.card;
    if (!c || c.n !== n || by !== c.guesser) return undefined;
    if (typeof count !== 'number' || !Number.isFinite(count)) return undefined;
    c.sheep = Math.max(0, Math.min(MAX_SHEEP, Math.floor(count)));
    const rec = this.records.find((r) => r.n === c.n);
    if (rec) rec.sheep = c.sheep;
    return undefined;
  }

  next(seq: unknown): string | undefined {
    const c = this.card;
    if (!c || c.stage !== 'result' || seq !== c.seq || this.tooSoon(c)) return undefined;
    this.deal();
    return undefined;
  }

  // ───────────────────────────── Remise d'aplomb ─────────────────────────────

  /** Après chaque événement : les étapes qui peuvent avancer avancent. */
  settle(): void {
    const c = this.card;
    if (!c || this.over) return;
    const seats = this.deps.seats();
    if (seats.length < 2) {
      this.over = true;
      return;
    }
    // Celui qui devine a quitté la table : la carte passe au suivant, sans pénalité.
    if (c.stage !== 'result' && !seats.includes(c.guesser)) return this.deal();
    if (c.stage === 'write') {
      const present = c.givers.filter((id) => !this.deps.isAway(id));
      const timeUp = c.endsAt > 0 && this.now() >= c.endsAt;
      if (timeUp || (present.length > 0 && present.every((id) => this.hasWritten(c, id)))) this.toCheck();
      return;
    }
    if (c.stage === 'check') {
      const present = c.givers.filter((id) => !this.deps.isAway(id));
      if (present.length > 0 && present.every((id) => c.ready.has(id))) this.afterCheck();
    }
  }
}
