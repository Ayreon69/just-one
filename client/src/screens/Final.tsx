// Fin de partie : le score sur le grand tableau, le clin d'œil, puis toutes les cartes de la partie.
import confetti from 'canvas-confetti';
import { Check, Forward, HeartHandshake, LogOut, Moon, RotateCcw, Settings2, Sparkles, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { MARKERS, MIN_PLAYERS, tierFor, type CardRecap, type Outcome, type RoomView } from '../../../shared/protocol';
import { Button, markerVar } from '../components/Ui';
import { sfx } from '../lib/sound';
import { cls, reducedMotion, useThemeColor } from '../lib/util';
import { leaveRoom, send } from '../net';

const OUTCOME_LABEL: Record<Outcome, string> = { found: 'Trouvé', missed: 'Raté', passed: 'Passé', empty: 'Tout effacé' };

function OutcomeIcon({ outcome }: { outcome: Outcome }) {
  if (outcome === 'found') return <Check size={16} strokeWidth={3.5} aria-hidden />;
  if (outcome === 'missed') return <X size={16} strokeWidth={3.5} aria-hidden />;
  return <Forward size={16} strokeWidth={3} aria-hidden />;
}

function Card({ card }: { card: CardRecap }) {
  return (
    <li className={cls('recap', `is-${card.outcome}`)}>
      <div className="recap-head">
        <span className="recap-mark" title={OUTCOME_LABEL[card.outcome]}>
          <OutcomeIcon outcome={card.outcome} />
          <span className="sr-only">{OUTCOME_LABEL[card.outcome]}</span>
        </span>
        <b className="recap-word">{card.word}</b>
        <span className="recap-who">{card.guesser}</span>
      </div>
      {card.answer && card.outcome !== 'found' && <p className="recap-answer">A répondu : {card.answer}</p>}
      {card.clues.length > 0 && (
        <ul className="recap-clues">
          {card.clues.map((c, i) => (
            <li key={i} className={cls(c.cancelled && 'is-off')} style={markerVar(c.marker)} title={c.author}>
              {c.text}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function Final({ view }: { view: RoomView }) {
  useThemeColor('#2346f5');
  const f = view.final!;
  const isHost = view.hostId === view.me;
  const host = view.players.find((p) => p.id === view.hostId);
  const tier = tierFor(f.found, f.total);
  const good = f.found / Math.max(1, f.total) >= 9 / 13;
  const canReplay = view.players.filter((p) => p.status !== 'spectator' && p.connected).length >= MIN_PLAYERS;

  const played = useRef(false);
  useEffect(() => {
    if (played.current) return;
    played.current = true;
    sfx.finale(good);
    if (good && !reducedMotion()) {
      const perfect = f.found === f.total;
      void confetti({ particleCount: perfect ? 220 : 110, spread: perfect ? 110 : 80, startVelocity: 42, origin: { y: 0.35 }, colors: [...MARKERS.slice(0, 7), '#eaff3d'], disableForReducedMotion: true });
    }
  }, [f, good]);

  return (
    <div className="screen final-screen">
      <div className="final">
        <section className="scoreboard">
          <p className="score-big">
            <b>{f.found}</b>
            <span>/ {f.total}</span>
          </p>
          <h1 className="score-title">
            <span className="highlight">{tier.title}</span>
          </h1>
          <p className="score-line">{tier.line}</p>
        </section>

        {(f.soulmates || f.solo || f.sheep) && (
          <div className="facts">
            {f.soulmates && (
              <p className="fact">
                <HeartHandshake size={20} aria-hidden />
                <span>
                  <b>Âmes sœurs :</b> {f.soulmates.a} et {f.soulmates.b}, {f.soulmates.count} fois la même idée.
                </span>
              </p>
            )}
            {f.solo && (
              <p className="fact">
                <Sparkles size={20} aria-hidden />
                <span>
                  <b>Le coup de maître :</b> « {f.solo} » trouvé avec un seul indice.
                </span>
              </p>
            )}
            {f.sheep && (
              <p className="fact">
                <Moon size={20} aria-hidden />
                <span>
                  <b>Champion des moutons :</b> {f.sheep.name}, {f.sheep.count} {f.sheep.count > 1 ? 'moutons sautés' : 'mouton sauté'} en une seule nuit.
                </span>
              </p>
            )}
          </div>
        )}

        <div className="final-actions">
          {isHost ? (
            <>
              <Button variant="primary" className="btn-lg btn-wide" icon={<RotateCcw size={20} />} disabled={!canReplay} onClick={() => void send('game:start')}>
                {canReplay ? 'Rejouer' : `Il faut ${MIN_PLAYERS} joueurs pour rejouer`}
              </Button>
              <Button variant="ghost" className="on-color" icon={<Settings2 size={18} />} onClick={() => void send('game:lobby')}>
                Changer les réglages
              </Button>
            </>
          ) : (
            <p className="waiting" role="status">
              <span className="spinner" /> {host?.name ?? "L'hôte"} va relancer une partie…
            </p>
          )}
          <Button variant="ghost" className="on-color" icon={<LogOut size={18} />} onClick={() => void leaveRoom()}>
            Quitter la table
          </Button>
        </div>

        <section className="recaps">
          <h2>Vos cartes</h2>
          <ul>
            {f.cards.map((c) => (
              <Card key={c.n} card={c} />
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
