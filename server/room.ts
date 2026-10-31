// Une table de Just One : salon, réglages, partie, minuteries et vue personnalisée de chacun.
import crypto from 'node:crypto';
import {
  CARD_OPTIONS,
  DEFAULT_SETTINGS,
  MARKERS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  THEME_IDS,
  TIMER_OPTIONS,
  closeWords,
  type CardSetting,
  type ClueView,
  type FinalView,
  type GameView,
  type PlayerStatus,
  type Role,
  type RoomView,
  type RoundView,
  type Settings,
  type ThemeId,
  type TimerSetting,
} from '../shared/protocol';
import { Game, type Card, type CardRecord } from './game';
import { WORDS } from './words';

const MAX_MEMBERS = 16;
/** Mode accéléré pour les tests locaux (JO_FAST=1). */
const FAST = process.env.JO_FAST === '1';
/** Délai laissé à un joueur déconnecté avant qu'on ne l'attende plus. */
const GRACE_MS = FAST ? 600 : 20_000;

export interface Player {
  id: string;
  token: string;
  name: string;
  marker: number;
  sockets: Set<string>;
  connected: boolean;
  disconnectedAt: number;
  left: boolean;
  status: PlayerStatus;
}

function uid(): string {
  return crypto.randomBytes(9).toString('base64url');
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class Room {
  readonly code: string;
  hostId = '';
  phase: 'lobby' | 'playing' | 'finished' = 'lobby';
  settings: Settings = { ...DEFAULT_SETTINGS, themes: [...DEFAULT_SETTINGS.themes] };
  players: Player[] = [];
  game: Game | null = null;
  final: FinalView | null = null;
  /** Les mots déjà sortis à cette table : on ne les revoit pas avant d'avoir fait le tour de la liste. */
  private readonly usedWords = new Set<string>();
  lastActive = Date.now();
  onChange: () => void = () => {};

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(code: string) {
    this.code = code;
  }

  // ───────────────────────────── Membres ─────────────────────────────

  get(id: string | undefined): Player | undefined {
    return id ? this.players.find((p) => p.id === id) : undefined;
  }

  findByToken(playerId: unknown, token: unknown): Player | undefined {
    if (typeof playerId !== 'string' || typeof token !== 'string') return undefined;
    const p = this.get(playerId);
    return p && p.token === token ? p : undefined;
  }

  get seated(): Player[] {
    return this.players.filter((p) => p.status !== 'spectator');
  }

  get humansOnline(): number {
    return this.players.filter((p) => p.connected).length;
  }

  touch(): void {
    this.lastActive = Date.now();
  }

  isAway(p: Player | undefined): boolean {
    return !p || p.left || (!p.connected && Date.now() - p.disconnectedAt >= GRACE_MS);
  }

  private uniqueName(name: string): string {
    const taken = new Set(this.players.map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; i < 99; i++) {
      const candidate = `${name.slice(0, 13)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return name;
  }

  private freeMarker(after = -1): number {
    const taken = new Set(this.players.filter((p) => !p.left).map((p) => p.marker));
    for (let i = 1; i <= MARKERS.length; i++) {
      const m = (after + i) % MARKERS.length;
      if (!taken.has(m)) return m;
    }
    return (after + 1) % MARKERS.length;
  }

  addHuman(name: string): Player | string {
    if (this.players.length >= MAX_MEMBERS) return 'Cette table est pleine.';
    const seats = this.seated.filter((p) => !p.left).length;
    if (this.phase === 'lobby' && seats >= MAX_PLAYERS) return `La table est complète (${MAX_PLAYERS} joueurs maximum).`;
    // En cours de partie, on s'assoit tout de suite : on écrit dès cette carte s'il en est encore temps.
    const status: PlayerStatus = this.phase === 'lobby' ? 'lobby' : seats < MAX_PLAYERS ? 'playing' : 'spectator';
    const p: Player = {
      id: uid(),
      token: uid() + uid(),
      name: this.uniqueName(name),
      marker: this.freeMarker(),
      sockets: new Set(),
      connected: false,
      disconnectedAt: Date.now(),
      left: false,
      status,
    };
    this.players.push(p);
    if (!this.hostId) this.hostId = p.id;
    if (status === 'playing' && this.phase === 'playing') this.game?.join(p.id);
    return p;
  }

  /** Touche ton feutre : tu prends la prochaine couleur libre. */
  changeMarker(by: string): string | undefined {
    const p = this.get(by);
    if (!p) return 'Tu as quitté la table.';
    p.marker = this.freeMarker(p.marker);
    return undefined;
  }

  kick(by: string, target: string): { sockets: string[] } | string {
    if (by !== this.hostId) return "Seul l'hôte peut retirer un joueur.";
    if (this.phase !== 'lobby') return 'On ne peut retirer un joueur que dans le salon.';
    const p = this.get(target);
    if (!p || p.id === by) return 'Joueur introuvable.';
    this.players = this.players.filter((x) => x.id !== p.id);
    return { sockets: [...p.sockets] };
  }

  leave(id: string): void {
    const p = this.get(id);
    if (!p) return;
    p.sockets.clear();
    p.connected = false;
    p.disconnectedAt = Date.now();
    // En partie, sa place reste : ses indices servent encore au récapitulatif, et on ne l'attend plus.
    if (this.phase === 'lobby' || p.status === 'spectator') this.players = this.players.filter((x) => x.id !== id);
    else p.left = true;
    if (this.hostId === id) this.transferHost();
  }

  private transferHost(): void {
    const next = this.players.find((p) => !p.left && p.connected) ?? this.players.find((p) => !p.left);
    this.hostId = next?.id ?? '';
  }

  connect(p: Player, socketId: string): void {
    p.sockets.add(socketId);
    p.connected = true;
    p.left = false;
    if (!this.hostId || !this.get(this.hostId) || this.get(this.hostId)?.left) this.hostId = p.id;
  }

  disconnect(id: string | undefined, socketId: string): void {
    const p = this.get(id);
    if (!p) return;
    p.sockets.delete(socketId);
    if (p.sockets.size === 0) {
      p.connected = false;
      p.disconnectedAt = Date.now();
    }
  }

  updateSettings(by: string, payload: Record<string, unknown>): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut changer les réglages.";
    if (this.phase !== 'lobby') return 'Les réglages se changent dans le salon.';
    if (payload.answer === 'oral' || payload.answer === 'written') this.settings.answer = payload.answer;
    if ((CARD_OPTIONS as readonly unknown[]).includes(payload.cards)) this.settings.cards = payload.cards as CardSetting;
    if ((TIMER_OPTIONS as readonly unknown[]).includes(payload.timer)) this.settings.timer = payload.timer as TimerSetting;
    if (Array.isArray(payload.themes)) {
      const themes = THEME_IDS.filter((t) => (payload.themes as unknown[]).includes(t));
      if (themes.length === 0) return 'Garde au moins un thème.';
      this.settings.themes = themes as ThemeId[];
    }
    return undefined;
  }

  // ───────────────────────────── Partie ─────────────────────────────

  private drawWord(): string {
    const pool = this.settings.themes.flatMap((t) => WORDS[t]);
    let fresh = pool.filter((w) => !this.usedWords.has(w));
    if (fresh.length === 0) {
      this.usedWords.clear();
      fresh = pool;
    }
    const word = fresh[crypto.randomInt(fresh.length)];
    this.usedWords.add(word);
    return word;
  }

  start(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut lancer la partie.";
    if (this.phase === 'playing') return 'La partie est déjà lancée.';
    this.players = this.players.filter((p) => !p.left);
    let seats = 0;
    for (const p of this.players) {
      p.status = seats < MAX_PLAYERS ? 'playing' : 'spectator';
      if (p.status === 'playing') seats++;
    }
    if (seats < MIN_PLAYERS) {
      for (const p of this.players) p.status = 'lobby';
      return `Il faut au moins ${MIN_PLAYERS} joueurs.`;
    }
    // Le premier à deviner est tiré au sort, puis on suit l'ordre de la table.
    const seated = shuffle(this.players.filter((p) => p.status === 'playing'));
    this.players = [...seated, ...this.players.filter((p) => p.status !== 'playing')];
    const t = this.settings.timer;
    this.game = new Game({
      settings: { ...this.settings },
      seats: () => this.players.filter((p) => p.status === 'playing' && !p.left).map((p) => p.id),
      isAway: (id) => this.isAway(this.get(id)),
      drawWord: () => this.drawWord(),
      writeMs: FAST && t ? 1_500 : t * 1000,
    });
    this.final = null;
    this.game.deal();
    this.phase = 'playing';
    return undefined;
  }

  /** Retour au salon, pour changer les réglages ou attendre du monde. */
  toLobby(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut revenir au salon.";
    if (this.phase === 'lobby') return undefined;
    this.clearTimer();
    this.players = this.players.filter((p) => !p.left);
    let seats = 0;
    for (const p of this.players) {
      p.status = seats < MAX_PLAYERS ? 'lobby' : 'spectator';
      if (p.status === 'lobby') seats++;
    }
    this.phase = 'lobby';
    this.game = null;
    this.final = null;
    return undefined;
  }

  /** Fin de partie : le score, s'il y a au moins une carte jouée ; sinon retour au salon. */
  finish(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut terminer la partie.";
    if (this.phase !== 'playing') return undefined;
    if (!this.game || this.game.records.length === 0) return this.toLobby(by);
    this.conclude();
    return undefined;
  }

  private conclude(): void {
    const g = this.game;
    if (!g) return;
    const name = (id: string) => this.get(id)?.name ?? '?';
    const { found } = g.tally();
    this.final = {
      total: g.total,
      found,
      cards: g.records.map((r) => ({
        n: r.n,
        word: r.word,
        guesser: name(r.guesser),
        outcome: r.outcome,
        answer: r.answer,
        penalty: r.penalty,
        clues: r.clues.map((c) => ({ text: c.text, author: name(c.author), marker: this.get(c.author)?.marker ?? 0, cancelled: !!c.cancelled })),
      })),
      soulmates: this.soulmates(g.records, name),
      solo: g.records.find((r) => r.outcome === 'found' && r.clues.length > 1 && r.clues.filter((c) => !c.cancelled).length === 1)?.word ?? null,
    };
    this.phase = 'finished';
    this.clearTimer();
  }

  /** Les deux joueurs qui ont le plus souvent écrit la même chose : le clin d'œil de fin de partie. */
  private soulmates(records: CardRecord[], name: (id: string) => string): FinalView['soulmates'] {
    const counts = new Map<string, number>();
    for (const r of records) {
      const doubles = r.clues.filter((c) => c.cancelled === 'double');
      for (let i = 0; i < doubles.length; i++) {
        for (let j = i + 1; j < doubles.length; j++) {
          const [a, b] = [doubles[i], doubles[j]];
          if (a.author === b.author || !closeWords(a.text, b.text)) continue;
          const pair = [a.author, b.author].sort().join('|');
          counts.set(pair, (counts.get(pair) ?? 0) + 1);
        }
      }
    }
    const best = [...counts].sort((x, y) => y[1] - x[1])[0];
    if (!best || best[1] < 2) return null;
    const [a, b] = best[0].split('|');
    return { a: name(a), b: name(b), count: best[1] };
  }

  /**
   * Une action de jeu : renvoie l'erreur à afficher, le cas échéant.
   * Sans partie en cours, le geste est simplement arrivé trop tard (deux joueurs touchent « Voir le score » ensemble) : ce n'est pas une erreur.
   */
  act(fn: (g: Game) => string | undefined): string | undefined {
    if (this.phase !== 'playing' || !this.game) return undefined;
    return fn(this.game);
  }

  force(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut ne plus attendre.";
    return this.act((g) => g.force());
  }

  /** L'hôte passe la carte au suivant : celui qui devine n'est plus là. Aucune carte n'est perdue. */
  skip(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut passer la main.";
    return this.act((g) => {
      if (g.card?.stage !== 'result') g.deal();
      return undefined;
    });
  }

  // ───────────────────────────── Minuteries ─────────────────────────────

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** À appeler après chaque changement : remet la carte d'aplomb, planifie la prochaine échéance, puis diffuse. */
  commit(): void {
    if (this.phase === 'playing' && this.game) {
      if (this.isAway(this.get(this.hostId))) {
        const next = this.players.find((p) => p.status === 'playing' && !this.isAway(p));
        if (next) this.hostId = next.id;
      }
      this.game.settle();
      if (this.game.over) this.conclude();
    }
    this.reschedule();
    this.onChange();
  }

  /** La prochaine échéance : la fin du chrono, ou le moment où un absent cessera d'être attendu. */
  private reschedule(): void {
    this.clearTimer();
    const c = this.game?.card;
    if (this.phase !== 'playing' || !c) return;
    let due = c.endsAt > 0 ? c.endsAt : Infinity;
    for (const p of this.players) {
      if (p.status === 'playing' && !p.connected && !p.left && !this.isAway(p)) due = Math.min(due, p.disconnectedAt + GRACE_MS + 5);
    }
    if (!Number.isFinite(due)) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.commit();
      } catch (e) {
        console.error(`[room ${this.code}]`, e);
      }
    }, Math.max(0, Math.min(due - Date.now(), 2_147_000_000)));
  }

  dispose(): void {
    this.clearTimer();
  }

  // ───────────────────────────── Vue personnalisée ─────────────────────────────

  /**
   * Le secret du jeu. Celui qui devine ne reçoit ni le mot ni aucun indice avant que la comparaison soit finie,
   * et jamais le texte d'un indice effacé avant le résultat. Les autres ne voient les indices qu'une fois tous écrits.
   */
  private cluesFor(c: Card, role: Role): ClueView[] {
    if (c.stage === 'write') return [];
    if (role === 'guesser') {
      if (c.stage === 'check') return [];
      if (c.stage === 'guess') {
        return c.clues.map((x) => ({ id: x.id, author: x.author, text: x.cancelled ? null : x.text, cancelled: x.cancelled ? 'manual' : null }));
      }
    }
    return c.clues.map((x) => ({ id: x.id, author: x.author, text: x.text, cancelled: x.cancelled }));
  }

  private roundView(g: Game, viewer: string): RoundView {
    const c = g.card!;
    const role: Role = viewer === c.guesser ? 'guesser' : c.givers.includes(viewer) ? 'giver' : 'watcher';
    const end = c.stage === 'result';
    return {
      n: c.n,
      stage: c.stage,
      seq: c.seq,
      role,
      guesser: c.guesser,
      nextGuesser: end ? g.peekGuesser() : null,
      word: role === 'guesser' && !end ? null : c.word,
      slots: c.slots,
      givers: [...c.givers],
      written: c.stage === 'write' ? c.givers.filter((id) => g.hasWritten(c, id)) : [...c.givers],
      mine: c.stage === 'write' ? [...(c.texts.get(viewer) ?? [])] : [],
      clues: this.cluesFor(c, role),
      ready: [...c.ready],
      endsAt: c.endsAt,
      swap: c.swap ? { ...c.swap } : null,
      answer: c.answer,
      outcome: c.outcome,
      penalty: c.penalty,
    };
  }

  private gameView(g: Game, viewer: string): GameView {
    const { found, left, pips } = g.tally();
    return { total: g.total, found, left, pips, round: this.roundView(g, viewer) };
  }

  viewFor(viewerId: string): RoomView {
    const g = this.phase === 'playing' && this.game?.card ? this.game : null;
    return {
      code: this.code,
      phase: this.phase,
      me: viewerId,
      hostId: this.hostId,
      settings: { ...this.settings, themes: [...this.settings.themes] },
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        marker: p.marker,
        isHost: p.id === this.hostId,
        connected: p.connected,
        away: this.phase === 'playing' && p.status === 'playing' && this.isAway(p),
        status: p.status,
      })),
      game: g ? this.gameView(g, viewerId) : null,
      final: this.final,
      serverNow: Date.now(),
    };
  }
}
