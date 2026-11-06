// La partie : un écran par étape de la carte, et par rôle. Celui qui devine reste dans le noir jusqu'à pouvoir répondre.
import { ArrowRight, BookOpen, Check, ChevronRight, Copy, Forward, LogOut, Menu, Pencil, Send, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CLUE_MAX, ANSWER_MAX, EMOTES, clueProblem, clueTooClose, closeWords, type ClueView, type GameView, type Outcome, type PlayerView, type RoomView, type RoundView } from '../../../shared/protocol';
import { SheepGame } from '../components/Sheep';
import { Button, ConfirmButton, Dot, Easel, Modal, WordBoard, markerVar } from '../components/Ui';
import { sfx } from '../lib/sound';
import { cls, listNames, secondsLeft, shareUrl, useSettled, useThemeColor, useTick, useWakeLock, vibrate } from '../lib/util';
import { leaveRoom, send, socket } from '../net';
import { useStore } from '../store';

/** Le temps que les boutons d'une étape qui vient d'apparaître restent sourds (un peu plus que le serveur, qui en ignore 600 ms). */
const SETTLE_MS = { check: 700, guess: 900, result: 1200 };

/** La durée du remplissage d'un bouton qui attend (voir `.is-settling`). */
const settleVar = (ms: number) => ({ '--settle': `${ms}ms` }) as CSSProperties;

const TONE: Record<string, string> = { day: '#2346f5', night: '#0c1238', found: '#07885a', missed: '#d63a30', passed: '#47527a', empty: '#47527a' };

function usePlayers(view: RoomView) {
  const byId = new Map(view.players.map((p) => [p.id, p]));
  return {
    get: (id: string | null | undefined): PlayerView | undefined => (id ? byId.get(id) : undefined),
    name: (id: string | null | undefined): string => (id ? (byId.get(id)?.name ?? '?') : '?'),
    marker: (id: string | null | undefined): number => (id ? (byId.get(id)?.marker ?? 0) : 0),
  };
}

// ───────────────────────────── La barre du haut ─────────────────────────────

function Pips({ game }: { game: GameView }) {
  return (
    <div className="pips" role="img" aria-label={`${game.found} cartes gagnées, ${game.left} dans la pioche`}>
      {game.pips.map((p, i) => (
        <span key={i} className={cls('pip', `is-${p}`)} />
      ))}
    </div>
  );
}

function MenuModal({ open, onClose, view }: { open: boolean; onClose: () => void; view: RoomView }) {
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const setRulesOpen = useStore((s) => s.setRulesOpen);
  const isHost = view.hostId === view.me;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(view.code));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      useStore.getState().showToast(`Lien : ${shareUrl(view.code)}`, 'info');
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Table ${view.code}`}>
      <div className="menu-list">
        <Button icon={copied ? <Check size={18} /> : <Copy size={18} />} onClick={copy}>
          {copied ? 'Lien copié !' : 'Inviter quelqu’un (copier le lien)'}
        </Button>
        <Button
          icon={<BookOpen size={18} />}
          onClick={() => {
            onClose();
            setRulesOpen(true);
          }}
        >
          Les règles
        </Button>
        <Button icon={prefs.sound ? <Volume2 size={18} /> : <VolumeX size={18} />} onClick={() => setPrefs({ sound: !prefs.sound })}>
          {prefs.sound ? 'Couper le son' : 'Remettre le son'}
        </Button>
        {isHost && (
          <ConfirmButton confirm="Sûr ? Le score s’arrête ici" onConfirm={() => void send('game:finish').then(onClose)}>
            Terminer la partie
          </ConfirmButton>
        )}
        <ConfirmButton icon={<LogOut size={18} />} confirm="Sûr ? Tu quittes la table" onConfirm={() => void leaveRoom()}>
          Quitter la table
        </ConfirmButton>
      </div>
    </Modal>
  );
}

// ───────────────────────────── Celui qui écrit ─────────────────────────────

function TimerBar({ endsAt, total }: { endsAt: number; total: number }) {
  const now = useTick(200);
  if (!endsAt || !total) return null;
  const left = secondsLeft(endsAt, now);
  const part = Math.max(0, Math.min(1, (endsAt - now) / (total * 1000)));
  return (
    <div className={cls('timer', left <= 10 && 'is-low')} role="timer" aria-label={`${left} secondes`}>
      <span className="timer-bar" style={{ transform: `scaleX(${part})` }} />
      <b>{left} s</b>
    </div>
  );
}

function ClueInput({ slot, round, marker, other, autoFocus }: { slot: number; round: RoundView; marker: number; other: string; autoFocus: boolean }) {
  const sent = round.mine[slot] ?? '';
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!sent && autoFocus) input.current?.focus({ preventScroll: true });
  }, [sent, autoFocus]);

  const word = round.word ?? '';
  const text = draft.trim();
  let problem = text ? clueProblem(draft, word) : null;
  if (!problem && text && other && closeWords(other, text)) problem = 'Écris deux indices bien différents.';
  const close = !problem && text ? clueTooClose(draft, word) : false;

  if (sent) {
    return (
      <div className="pen is-sent" style={markerVar(marker)}>
        <span className="pen-text">{sent}</span>
        <button
          type="button"
          className="pen-edit"
          onClick={() => {
            setDraft(sent);
            void send('game:clue', { slot, text: '' });
          }}
        >
          <Pencil size={14} aria-hidden /> Modifier
        </button>
        <span className="pen-foot" />
      </div>
    );
  }

  const submit = async () => {
    if (busy || problem || !text) {
      if (!text) input.current?.focus();
      return;
    }
    setBusy(true);
    const ok = await send('game:clue', { slot, text });
    setBusy(false);
    if (ok) {
      setDraft('');
      sfx.marker();
    }
  };

  return (
    <>
      <form
        className={cls('pen', problem && 'is-bad')}
        style={markerVar(marker)}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          ref={input}
          className="pen-input"
          value={draft}
          placeholder={round.slots > 1 ? `Indice ${slot + 1}…` : 'Ton indice…'}
          aria-label={round.slots > 1 ? `Ton indice ${slot + 1}` : 'Ton indice'}
          aria-invalid={!!problem}
          maxLength={CLUE_MAX}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="pen-send" aria-label="Poser mon indice" disabled={!text || !!problem || busy}>
          <Send size={20} aria-hidden />
        </button>
        <span className="pen-foot" />
      </form>
      {problem ? (
        <p className="pen-hint is-bad" role="alert">
          {problem}
        </p>
      ) : close ? (
        <p className="pen-hint is-warn" role="status">
          Trop proche du mot : il risque d'être effacé.
        </p>
      ) : null}
    </>
  );
}

function WaitingFor({ view, round }: { view: RoomView; round: RoundView }) {
  const players = usePlayers(view);
  const isHost = view.hostId === view.me;
  const missing = round.givers.filter((id) => !round.written.includes(id));
  const someone = round.written.length > 0 || round.mine.some(Boolean);
  const onlyMe = missing.length === 1 && missing[0] === view.me;
  return (
    <div className="writers">
      <div className="writers-dots">
        {round.givers.map((id) => (
          <Dot key={id} name={players.name(id)} marker={players.marker(id)} done={round.written.includes(id)} faded={players.get(id)?.away} />
        ))}
      </div>
      <p className="writers-text">{missing.length === 0 ? 'Tout le monde a écrit !' : onlyMe ? 'On n’attend plus que toi !' : missing.length === 1 ? `${players.name(missing[0])} écrit encore…` : `${missing.length} joueurs écrivent encore…`}</p>
      {isHost && !onlyMe && missing.length > 0 && someone && (
        <ConfirmButton variant="ghost" className="on-color" confirm="Sûr ? On continue sans eux" onConfirm={() => void send('game:force', { stage: round.stage })}>
          Ne plus attendre
        </ConfirmButton>
      )}
    </div>
  );
}

function WriteStage({ view, game }: { view: RoomView; game: GameView }) {
  const r = game.round;
  const players = usePlayers(view);
  const [asking, setAsking] = useState(false);
  const me = players.marker(view.me);
  const allSent = r.mine.length === r.slots && r.mine.every(Boolean);
  const canWrite = r.role === 'giver';
  useEffect(() => setAsking(false), [r.word]);
  return (
    <>
      <p className="whois">
        <Dot name={players.name(r.guesser)} marker={players.marker(r.guesser)} /> <b>{players.name(r.guesser)}</b> devine ce mot
      </p>
      <WordBoard word={r.word ?? ''} />
      {canWrite && (
        <div className="swap">
          {asking ? (
            <div className="swap-confirm">
              <span>On change de mot pour tout le monde ?</span>
              <Button
                className="btn-sm"
                onClick={() => {
                  setAsking(false);
                  void send('game:swap');
                }}
              >
                Oui
              </Button>
              <Button className="btn-sm" variant="ghost" onClick={() => setAsking(false)}>
                Non
              </Button>
            </div>
          ) : (
            <button type="button" className="link on-color" onClick={() => setAsking(true)}>
              Je ne connais pas ce mot
            </button>
          )}
        </div>
      )}
      {canWrite ? (
        <>
          <TimerBar endsAt={r.endsAt} total={view.settings.timer} />
          <div className="pens" key={r.swap?.n ?? 0}>
            {Array.from({ length: r.slots }, (_, slot) => (
              <ClueInput key={slot} slot={slot} round={r} marker={me} other={r.mine[slot === 0 ? 1 : 0] ?? ''} autoFocus={slot === r.mine.findIndex((m) => !m) || (slot === 0 && r.mine.length === 0)} />
            ))}
          </div>
          {!allSent && <p className="rule-line">Un seul mot, sans se concerter. Ni le mot, ni sa famille.</p>}
        </>
      ) : (
        <p className="rule-line">Tu regardes cette carte. Pas un mot !</p>
      )}
      <WaitingFor view={view} round={r} />
    </>
  );
}

// ───────────────────────────── Celui qui devine, dans le noir ─────────────────────────────

function ClosedEye() {
  return (
    <svg className="closed-eye" viewBox="0 0 200 92" aria-hidden>
      <path d="M18 26c26 34 138 34 164 0" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
      <path d="M46 52l-10 20M78 62l-5 22M122 62l5 22M154 52l10 20M100 66v24" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
    </svg>
  );
}

function NightStage({ view, game }: { view: RoomView; game: GameView }) {
  const r = game.round;
  const players = usePlayers(view);
  const isHost = view.hostId === view.me;
  const writing = r.stage === 'write';
  const missing = writing ? r.givers.filter((id) => !r.written.includes(id)) : r.givers.filter((id) => !r.ready.includes(id));
  return (
    <div className="night">
      <ClosedEye />
      <h2 className="night-title">{writing ? 'Yeux fermés !' : 'Ils comparent…'}</h2>
      <p className="night-text">{writing ? 'C’est toi qui devines. Les autres écrivent un indice sur un mot que tout le monde voit, sauf toi.' : 'Les indices pareils s’effacent. Il va te rester ceux qui survivent.'}</p>
      <SheepGame onDone={(count) => void send('game:sheep', { n: r.n, count })} />
      <div className="night-boards">
        {r.givers.map((id) => {
          const done = writing ? r.written.includes(id) : r.ready.includes(id);
          return (
            <div key={id} className={cls('mini', done && 'is-done')} style={markerVar(players.marker(id))}>
              <span className="mini-board">{done && (writing ? <span className="mini-scribble" /> : <Check size={18} strokeWidth={3} aria-hidden />)}</span>
              <span className="mini-name">{players.name(id)}</span>
            </div>
          );
        })}
      </div>
      {isHost && missing.length > 0 && (r.stage === 'check' || r.written.length > 0) && (
        <ConfirmButton variant="ghost" className="on-color" confirm="Sûr ? On continue sans eux" onConfirm={() => void send('game:force', { stage: r.stage })}>
          Ne plus attendre {listNames(missing.map((id) => players.name(id)))}
        </ConfirmButton>
      )}
    </div>
  );
}

// ───────────────────────────── La comparaison ─────────────────────────────

function EaselGrid({ clues, view, onTap, readable, spent }: { clues: ClueView[]; view: RoomView; onTap?: (c: ClueView) => void; readable?: boolean; spent?: boolean }) {
  const players = usePlayers(view);
  return (
    <div className={cls('easels', `n-${Math.min(clues.length, 10)}`)}>
      {clues.map((c) => (
        <Easel key={c.id} text={c.text} author={players.name(c.author)} marker={players.marker(c.author)} cancelled={c.cancelled} readable={readable} spent={spent} onClick={onTap ? () => onTap(c) : undefined} />
      ))}
    </div>
  );
}

function CheckStage({ view, game }: { view: RoomView; game: GameView }) {
  const r = game.round;
  const players = usePlayers(view);
  const isHost = view.hostId === view.me;
  const canAct = r.role === 'giver';
  const ready = r.ready.includes(view.me);
  const waiting = r.givers.filter((id) => !r.ready.includes(id) && !players.get(id)?.away);
  const allGone = r.clues.every((c) => c.cancelled);
  const settled = useSettled(r.n, SETTLE_MS.check);
  return (
    <>
      <WordBoard word={r.word ?? ''} compact label="Le mot" />
      <h2 className="stage-title">Comparez vos indices</h2>
      <p className="stage-text">{canAct ? 'Touche un indice pour l’effacer ou le rétablir : même famille, traduction, mot inventé…' : 'Ceux qui ont écrit vérifient leurs indices.'}</p>
      <EaselGrid
        clues={r.clues}
        view={view}
        readable
        onTap={
          canAct
            ? (c) => {
                sfx.tap();
                void send('game:erase', { clue: c.id });
              }
            : undefined
        }
      />
      <div className="bottom-bar">
        {canAct &&
          (ready ? (
            <p className="bottom-wait" role="status">
              <span className="spinner" /> {waiting.length ? `On attend ${listNames(waiting.map((id) => players.name(id)))}…` : 'C’est parti…'}
            </p>
          ) : (
            <Button variant="primary" className={cls('btn-lg btn-wide', !settled && 'is-settling')} icon={<Check size={22} />} disabled={!settled} style={settleVar(SETTLE_MS.check)} onClick={() => void send('game:ok')}>
              {allGone ? 'Tout est effacé : carte perdue' : `C'est bon, on montre à ${players.name(r.guesser)}`}
            </Button>
          ))}
        {isHost && ready && waiting.length > 0 && (
          <ConfirmButton variant="ghost" className="on-color" confirm="Sûr ? On continue sans eux" onConfirm={() => void send('game:force', { stage: r.stage })}>
            Ne plus attendre
          </ConfirmButton>
        )}
      </div>
    </>
  );
}

// ───────────────────────────── La réponse ─────────────────────────────

/** Les paupières s'ouvrent : le seul moment où celui qui devine découvre ce qu'il reste. */
function Eyelids() {
  return (
    <div className="eyelids" aria-hidden>
      <span className="lid is-top" />
      <span className="lid is-bottom" />
    </div>
  );
}

function AnswerForm() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);
  const submit = async () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    await send('game:answer', { text });
    setBusy(false);
  };
  return (
    <form
      className="answer"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input ref={input} className="input input-lg" value={text} placeholder="Ta réponse…" aria-label="Ta réponse" maxLength={ANSWER_MAX} autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="send" onChange={(e) => setText(e.target.value)} />
      <Button type="submit" variant="primary" icon={<Send size={20} />} disabled={!text.trim() || busy} aria-label="Répondre">
        Répondre
      </Button>
    </form>
  );
}

function GuessStage({ view, game }: { view: RoomView; game: GameView }) {
  const r = game.round;
  const players = usePlayers(view);
  const oral = view.settings.answer === 'oral';
  const guesser = players.name(r.guesser);
  const sorted = [...r.clues].sort((a, b) => Number(!!a.cancelled) - Number(!!b.cancelled));
  const settled = useSettled(r.seq, SETTLE_MS.guess);

  if (r.role === 'guesser') {
    return (
      <>
        <Eyelids />
        <h2 className="stage-title is-big">À toi !</h2>
        <p className="stage-text">{oral ? 'Une seule réponse. Dis-la à voix haute : les autres valideront.' : 'Une seule réponse.'}</p>
        <EaselGrid clues={sorted} view={view} />
        <div className="bottom-bar">
          {!oral && <AnswerForm />}
          <ConfirmButton variant="ghost" className="on-color" icon={<Forward size={18} />} confirm="Sûr ? Tu perds cette carte" onConfirm={() => void send('game:pass')}>
            Je passe
          </ConfirmButton>
        </div>
      </>
    );
  }

  return (
    <>
      <WordBoard word={r.word ?? ''} compact label="Le mot" />
      <h2 className="stage-title">{oral ? `Chut, ${guesser} réfléchit…` : `${guesser} écrit sa réponse…`}</h2>
      <EaselGrid clues={sorted} view={view} readable />
      {oral && (
        <div className="bottom-bar">
          <div className="verdict">
            <Button variant="bad" className={cls('btn-lg', !settled && 'is-settling')} icon={<X size={22} />} disabled={!settled} style={settleVar(SETTLE_MS.guess)} onClick={() => void send('game:verdict', { outcome: 'missed', seq: r.seq })}>
              Raté
            </Button>
            <Button variant="good" className={cls('btn-lg', !settled && 'is-settling')} icon={<Check size={22} />} disabled={!settled} style={settleVar(SETTLE_MS.guess)} onClick={() => void send('game:verdict', { outcome: 'found', seq: r.seq })}>
              Trouvé !
            </Button>
          </div>
          <ConfirmButton variant="ghost" className="on-color" disabled={!settled} confirm={`Sûr ? ${guesser} passe`} onConfirm={() => void send('game:verdict', { outcome: 'passed', seq: r.seq })}>
            {guesser} passe
          </ConfirmButton>
        </div>
      )}
    </>
  );
}

// ───────────────────────────── Le résultat ─────────────────────────────

const HEADLINE: Record<Outcome, string> = { found: 'Trouvé !', missed: 'Raté…', passed: 'Passé', empty: 'Tout effacé !' };

function penaltyLine(r: RoundView): string | null {
  if (r.outcome === 'missed') return r.penalty === 'next' ? 'Cette carte et la suivante sont perdues.' : r.penalty === 'success' ? 'Dernière carte : une carte déjà gagnée s’en va aussi.' : 'Cette carte est perdue.';
  if (r.outcome === 'passed') return 'Seule cette carte est perdue.';
  if (r.outcome === 'empty') return r.clues.length ? 'Plus aucun indice : seule cette carte est perdue.' : 'Personne n’a écrit à temps : seule cette carte est perdue.';
  return null;
}

function Reactions() {
  return (
    <div className="reactions" role="group" aria-label="Réagir">
      {EMOTES.map((e) => (
        <button key={e} type="button" className="reaction" onClick={() => socket.emit('emote', { emoji: e })}>
          {e}
        </button>
      ))}
    </div>
  );
}

function ResultStage({ view, game }: { view: RoomView; game: GameView }) {
  const r = game.round;
  const players = usePlayers(view);
  const outcome = r.outcome ?? 'passed';
  const isHost = view.hostId === view.me;
  const over = game.left <= 0;
  const canCorrect = (outcome === 'found' || outcome === 'missed') && (r.role !== 'guesser' || isHost);
  const next = r.nextGuesser;
  const line = penaltyLine(r);
  const settled = useSettled(r.seq, SETTLE_MS.result);
  return (
    <>
      <h2 className="headline" key={outcome}>
        {HEADLINE[outcome]}
      </h2>
      <WordBoard word={r.word ?? ''} />
      {r.answer && (
        <p className="result-answer">
          {players.name(r.guesser)} a répondu : <b>{r.answer}</b>
        </p>
      )}
      {line && <p className="result-line">{line}</p>}
      {r.sheep > 0 && (
        <p className="result-sheep">
          Pendant ce temps, {r.role === 'guesser' ? 'tu as' : `${players.name(r.guesser)} a`} fait sauter <b>{r.sheep}</b> {r.sheep > 1 ? 'moutons' : 'mouton'}.
        </p>
      )}
      {canCorrect && (
        <button type="button" className="link on-color" disabled={!settled} onClick={() => void send('game:correct', { outcome: outcome === 'found' ? 'missed' : 'found', seq: r.seq })}>
          {outcome === 'found' ? 'Oups : en fait, c’était raté' : 'Oups : en fait, c’était bon'}
        </button>
      )}
      {r.clues.length > 0 && <EaselGrid clues={r.clues} view={view} spent />}
      <Reactions />
      <div className="bottom-bar">
        <Button variant="primary" className={cls('btn-lg btn-wide', !settled && 'is-settling')} icon={over ? undefined : <ArrowRight size={22} />} disabled={!settled} style={settleVar(SETTLE_MS.result)} onClick={() => void send('game:next', { seq: r.seq })}>
          {over ? 'Voir le score' : 'Carte suivante'}
        </Button>
        {!over && next && <p className="bottom-note">{next === view.me ? 'C’est toi qui devines ensuite.' : `${players.name(next)} devine ensuite.`}</p>}
      </div>
    </>
  );
}

// ───────────────────────────── L'écran de jeu ─────────────────────────────

function Emotes({ view }: { view: RoomView }) {
  const emotes = useStore((s) => s.emotes);
  const players = usePlayers(view);
  return (
    <div className="emotes" aria-hidden>
      {emotes.map((e, i) => (
        <span key={e.id} className="emote" style={{ left: `${12 + ((i * 37 + e.id * 13) % 70)}%` }}>
          <span className="emote-face">{e.emoji}</span>
          <small>{players.name(e.playerId)}</small>
        </span>
      ))}
    </div>
  );
}

export function Table({ view }: { view: RoomView }) {
  const game = view.game!;
  const r = game.round;
  const players = usePlayers(view);
  const [menu, setMenu] = useState(false);
  const isHost = view.hostId === view.me;
  const night = r.role === 'guesser' && (r.stage === 'write' || r.stage === 'check');
  const tone = r.stage === 'result' ? (r.outcome ?? 'passed') : night ? 'night' : 'day';
  useThemeColor(TONE[tone]);
  useWakeLock();

  // Les sons et vibrations suivent les changements d'étape, pas le chargement de la page.
  const seen = useRef<{ n: number; stage: string } | null>(null);
  const hadErased = r.clues.some((c) => c.cancelled);
  useEffect(() => {
    const before = seen.current;
    seen.current = { n: r.n, stage: r.stage };
    if (!before || (before.n === r.n && before.stage === r.stage)) return;
    if (r.stage === 'write' && r.role === 'guesser') {
      sfx.turn();
      vibrate(40);
    } else if (r.stage === 'check' && hadErased) sfx.erase();
    else if (r.stage === 'guess' && r.role === 'guesser') {
      sfx.eye();
      vibrate([30, 60, 30]);
    } else if (r.stage === 'result') {
      if (r.outcome === 'found') {
        sfx.found();
        vibrate(60);
      } else if (r.outcome === 'missed') {
        sfx.missed();
        vibrate([80, 60, 80]);
      } else sfx.passed();
    }
  }, [r.n, r.stage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Quand un joueur ne connaît pas le mot, les autres doivent comprendre pourquoi il vient de changer.
  const swapSeen = useRef(r.swap?.n ?? 0);
  useEffect(() => {
    const n = r.swap?.n ?? 0;
    if (n > swapSeen.current && r.swap && r.swap.by !== view.me) {
      useStore.getState().showToast(r.role === 'guesser' ? `${players.name(r.swap.by)} a demandé un autre mot.` : `${players.name(r.swap.by)} ne connaissait pas le mot : nouveau mot !`, 'info');
    }
    swapSeen.current = n;
  }, [r.swap?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const guesserAway = r.stage !== 'result' && players.get(r.guesser)?.away;

  return (
    <div className={cls('screen', 'table', `tone-${tone}`, `stage-${r.stage}`)}>
      <header className="topbar">
        <Pips game={game} />
        <span className="score" aria-hidden>
          {game.found}
        </span>
        <button type="button" className="icon-btn" aria-label="Menu" onClick={() => setMenu(true)}>
          <Menu size={22} />
        </button>
      </header>
      {guesserAway && (
        <div className="away-banner" role="status">
          <span>{players.name(r.guesser)} ne répond plus.</span>
          {isHost && (
            <Button className="btn-sm" icon={<ChevronRight size={16} />} onClick={() => void send('game:skip', { n: r.n })}>
              Passer au suivant
            </Button>
          )}
        </div>
      )}
      <main className="table-main">
        {/* Une seule nuit de l'écriture à la comparaison : les moutons continuent de sauter. */}
        {night && <NightStage key={r.n} view={view} game={game} />}
        {r.stage === 'write' && r.role !== 'guesser' && <WriteStage view={view} game={game} />}
        {r.stage === 'check' && r.role !== 'guesser' && <CheckStage view={view} game={game} />}
        {r.stage === 'guess' && <GuessStage key={r.seq} view={view} game={game} />}
        {r.stage === 'result' && <ResultStage view={view} game={game} />}
      </main>
      <Emotes view={view} />
      <MenuModal open={menu} onClose={() => setMenu(false)} view={view} />
    </div>
  );
}
