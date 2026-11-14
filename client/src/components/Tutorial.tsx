// « Jamais joué ? » : deux cartes guidées pas à pas, avec trois joueurs scénarisés, Léo, Inès et Sam.
// D'abord tu écris un indice pour Inès, et deux indices pareils s'effacent sous tes yeux. Puis c'est toi
// qui devines, yeux fermés, avec ce qui reste. Tout se passe ici : aucune table n'est créée sur le serveur.
import { ArrowRight, Check, ChevronRight, Eye, Forward, GraduationCap, Plus, Send, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ANSWER_MAX, CLUE_MAX, clueProblem, clueTooClose, closeWords, rightAnswer, type CancelReason } from '../../../shared/protocol';
import { sfx } from '../lib/sound';
import { cls, vibrate } from '../lib/util';
import { createRoom } from '../net';
import { useStore } from '../store';
import { Button, Dot, Easel, WordBoard, markerVar } from './Ui';

type Step = 'intro' | 'write' | 'check' | 'found' | 'night' | 'guess' | 'result' | 'lessons';
const STEPS: Step[] = ['intro', 'write', 'check', 'found', 'night', 'guess', 'result', 'lessons'];
type Tone = 'day' | 'night' | 'found' | 'missed' | 'passed';

const NPCS = [
  { id: 'leo', name: 'Léo', marker: 1 },
  { id: 'ines', name: 'Inès', marker: 2 },
  { id: 'sam', name: 'Sam', marker: 4 },
];
const ME_MARKER = 0;

/** Première carte : Inès devine, toi, Léo et Sam écrivez. */
const WORD1 = 'Plage';
const EXAMPLE1 = 'Serviette';
/** L'idée que Léo et Sam ont eue tous les deux. Si c'est aussi la tienne, ils en ont eu une autre ensemble. */
const SHARED = ['Sable', 'Soleil', 'Vacances', 'Mer'];

/** Deuxième carte : tu devines. Sam a écrit un mot de la même famille que la réponse : l'appli l'a effacé. */
const WORD2 = 'Lune';
const CLUES2: { by: string; text: string; cancelled: CancelReason | null }[] = [
  { by: 'leo', text: 'Croissant', cancelled: null },
  { by: 'sam', text: 'Lunaire', cancelled: 'close' },
  { by: 'ines', text: 'Astronaute', cancelled: null },
];

const TONE_COLOR: Record<Tone, string> = { day: '#2346f5', night: '#0c1238', found: '#07885a', missed: '#d63a30', passed: '#47527a' };

export function Tutorial() {
  const open = useStore((s) => s.tutorialOpen);
  if (!open) return null;
  return createPortal(<TutorialRun />, document.body);
}

function npc(id: string) {
  return NPCS.find((n) => n.id === id)!;
}

function TutorialRun() {
  const setOpen = useStore((s) => s.setTutorialOpen);
  const profile = useStore((s) => s.profile);
  const inRoom = useStore((s) => !!s.view);
  const myName = profile.name.trim() || 'Toi';
  const [step, setStep] = useState<Step>('intro');
  const [clue, setClue] = useState('');
  const [draft, setDraft] = useState('');
  const [written, setWritten] = useState(0);
  const [answer, setAnswer] = useState('');
  const [outcome, setOutcome] = useState<'found' | 'missed' | 'passed' | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const idx = STEPS.indexOf(step);
  const close = () => setOpen(false);
  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, idx + 1)]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
    if (step === 'check') window.setTimeout(() => sfx.erase(), 350);
    if (step === 'found') sfx.found();
    if (step === 'night') {
      sfx.turn();
      vibrate(40);
    }
    if (step === 'guess') {
      sfx.eye();
      vibrate([30, 60, 30]);
    }
  }, [step]);
  // Yeux fermés : les trois autres écrivent, un tableau après l'autre.
  useEffect(() => {
    if (step !== 'night' || written >= NPCS.length + 1) return;
    const t = window.setTimeout(() => setWritten((n) => n + 1), written === 0 ? 900 : 1100);
    return () => window.clearTimeout(t);
  }, [step, written]);

  // La barre du navigateur suit la couleur de l'écran, comme pendant une vraie carte.
  const tone: Tone = step === 'night' ? 'night' : step === 'found' ? 'found' : step === 'result' ? (outcome ?? 'passed') : 'day';
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) return;
    const before = meta.content;
    meta.content = TONE_COLOR[tone];
    return () => {
      meta.content = before;
    };
  }, [tone]);

  const shared = SHARED.find((w) => !closeWords(w, clue)) ?? SHARED[0];
  const clues1 = [
    { by: 'leo', name: 'Léo', marker: npc('leo').marker, text: shared, cancelled: 'double' as CancelReason },
    { by: 'moi', name: myName, marker: ME_MARKER, text: clue || EXAMPLE1, cancelled: null },
    { by: 'sam', name: 'Sam', marker: npc('sam').marker, text: shared, cancelled: 'double' as CancelReason },
  ];

  let content: ReactNode = null;
  let action: ReactNode = null;

  if (step === 'intro') {
    content = (
      <div className="tuto-intro">
        <span className="tuto-badge">
          <GraduationCap size={18} aria-hidden /> Partie d’essai
        </span>
        <h2>Tous dans la même équipe</h2>
        <p>
          À chaque carte, un joueur devine un mot que tous les autres voient. Chacun lui écrit <b>un indice d’un seul mot</b>, sans se concerter… et deux indices pareils s’effacent.
        </p>
        <div className="tuto-cast">
          <span className="tuto-person">
            <Dot name={myName} marker={ME_MARKER} className="tuto-dot-big" />
            {myName}
          </span>
          {NPCS.map((n) => (
            <span key={n.id} className="tuto-person">
              <Dot name={n.name} marker={n.marker} className="tuto-dot-big" />
              {n.name}
            </span>
          ))}
        </div>
        <p className="tuto-small">Deux cartes, trois minutes, avec Léo, Inès et Sam. Rien n’est enregistré.</p>
      </div>
    );
    action = (
      <Button variant="primary" className="btn-lg btn-wide" icon={<ChevronRight size={22} />} onClick={next}>
        C’est parti
      </Button>
    );
  } else if (step === 'write') {
    const text = draft.trim();
    const problem = text ? clueProblem(draft, WORD1) : null;
    const tooClose = !problem && text ? clueTooClose(draft, WORD1) : false;
    const ok = !!text && !problem && !tooClose;
    const submit = () => {
      if (!ok) return;
      sfx.marker();
      vibrate(15);
      setClue(text.charAt(0).toUpperCase() + text.slice(1));
      next();
    };
    content = (
      <>
        <p className="whois">
          <Dot name="Inès" marker={npc('ines').marker} /> <b>Inès</b> devine ce mot
        </p>
        <WordBoard word={WORD1} />
        <p className="tuto-say">Tout le monde voit le mot, sauf Inès. Écris-lui un indice d’un seul mot, sans le mot lui-même.</p>
        <form
          className={cls('pen', problem && 'is-bad')}
          style={markerVar(ME_MARKER)}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            className="pen-input"
            value={draft}
            placeholder="Ton indice…"
            aria-label="Ton indice"
            aria-invalid={!!problem}
            maxLength={CLUE_MAX}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="send"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="pen-send" aria-label="Poser mon indice" disabled={!ok}>
            <Send size={20} aria-hidden />
          </button>
          <span className="pen-foot" />
        </form>
        {problem ? (
          <p className="pen-hint is-bad" role="alert">
            {problem}
          </p>
        ) : tooClose ? (
          <p className="pen-hint is-warn" role="status">
            Trop proche du mot&nbsp;: il serait effacé. Essaie un autre mot.
          </p>
        ) : null}
        <div className="tuto-example">
          <Button variant="ghost" className="on-color" icon={<Sparkles size={16} />} onClick={() => setDraft(EXAMPLE1)}>
            Pas d’idée&nbsp;? Prendre un exemple
          </Button>
        </div>
      </>
    );
    action = (
      <Button variant="primary" className="btn-lg btn-wide" icon={<Check size={22} />} disabled={!ok} onClick={submit}>
        {ok ? `J’écris « ${text} »` : 'Écris ton indice'}
      </Button>
    );
  } else if (step === 'check') {
    content = (
      <>
        <WordBoard word={WORD1} compact label="Le mot" />
        <h2 className="stage-title">On compare les indices</h2>
        <p className="tuto-say">
          Léo et Sam ont eu la même idée&nbsp;: <b>{shared}</b>. Leurs deux indices s’effacent, Inès ne les verra pas. Il ne lui reste que le tien.
        </p>
        <div className="easels n-3 tuto-easels">
          {clues1.map((c) => (
            <Easel key={c.by} text={c.text} author={c.name} marker={c.marker} cancelled={c.cancelled} readable />
          ))}
        </div>
        <p className="tuto-small center">Dans une vraie partie, l’appli efface les doublons toute seule, et vous pouvez toucher un indice pour l’effacer ou le rétablir.</p>
      </>
    );
    action = (
      <Button variant="primary" className="btn-lg btn-wide" icon={<Eye size={22} />} onClick={next}>
        On montre à Inès
      </Button>
    );
  } else if (step === 'found') {
    content = (
      <>
        <h2 className="headline">Trouvé&nbsp;!</h2>
        <WordBoard word={WORD1} />
        <p className="result-answer">
          Inès a répondu&nbsp;: <b>Plage</b>
        </p>
        <p className="tuto-say">
          Avec un seul indice, «&nbsp;{clue}&nbsp;», elle a trouvé&nbsp;: la carte est gagnée pour toute la table. Le bon indice, c’est celui que les autres n’auront pas.
        </p>
        <div className="easels n-3 tuto-easels">
          {clues1.map((c) => (
            <Easel key={c.by} text={c.text} author={c.name} marker={c.marker} cancelled={c.cancelled} spent />
          ))}
        </div>
      </>
    );
    action = (
      <Button variant="primary" className="btn-lg btn-wide" icon={<ArrowRight size={22} />} onClick={next}>
        Carte suivante&nbsp;: à toi de deviner
      </Button>
    );
  } else if (step === 'night') {
    const done = written > NPCS.length;
    content = (
      <div className="night">
        <ClosedEye />
        <h2 className="night-title">{done ? 'Ils ont comparé' : 'Yeux fermés !'}</h2>
        <p className="night-text">{done ? 'Les indices en trop sont effacés. Ouvre les yeux pour voir ceux qui restent.' : 'C’est toi qui devines : tout le monde voit le mot, sauf toi. Léo, Inès et Sam écrivent…'}</p>
        <div className="night-boards">
          {CLUES2.map((c, i) => {
            const n = npc(c.by);
            const ready = written > i;
            return (
              <div key={c.by} className={cls('mini', ready && 'is-done')} style={markerVar(n.marker)}>
                <span className="mini-board">{ready && (done ? <Check size={18} strokeWidth={3} aria-hidden /> : <span className="mini-scribble" />)}</span>
                <span className="mini-name">{n.name}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
    action = (
      <Button variant="primary" className="btn-lg btn-wide" icon={<Eye size={22} />} disabled={!done} onClick={next}>
        {done ? 'J’ouvre les yeux' : 'Ils écrivent…'}
      </Button>
    );
  } else if (step === 'guess') {
    const sorted = [...CLUES2].sort((a, b) => Number(!!a.cancelled) - Number(!!b.cancelled));
    const submit = () => {
      if (!answer.trim()) return;
      const found = rightAnswer(answer, WORD2);
      setOutcome(found ? 'found' : 'missed');
      if (found) sfx.found();
      else sfx.missed();
      vibrate(found ? 60 : [80, 60, 80]);
      setStep('result');
    };
    content = (
      <>
        <Eyelids />
        <h2 className="stage-title is-big">À toi&nbsp;!</h2>
        <p className="tuto-say">
          Sam avait écrit un mot de la même famille que la réponse&nbsp;: l’appli l’a effacé, tu ne sauras pas lequel. Avec les deux autres, quel est le mot&nbsp;? <b>Une seule réponse.</b>
        </p>
        <div className="easels n-3 tuto-easels">
          {sorted.map((c) => {
            const n = npc(c.by);
            return <Easel key={c.by} text={c.cancelled ? null : c.text} author={n.name} marker={n.marker} cancelled={c.cancelled} />;
          })}
        </div>
        <form
          className="answer"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input className="input input-lg" value={answer} placeholder="Ta réponse…" aria-label="Ta réponse" maxLength={ANSWER_MAX} autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="send" onChange={(e) => setAnswer(e.target.value)} />
          <Button type="submit" variant="primary" icon={<Send size={20} />} disabled={!answer.trim()} aria-label="Répondre">
            Répondre
          </Button>
        </form>
        <p className="tuto-small center">À une vraie table, tu peux aussi répondre à voix haute&nbsp;: les autres valident sur leur écran.</p>
      </>
    );
    action = (
      <Button
        variant="ghost"
        className="on-color"
        icon={<Forward size={18} />}
        onClick={() => {
          setOutcome('passed');
          sfx.passed();
          setStep('result');
        }}
      >
        Je passe
      </Button>
    );
  } else if (step === 'result') {
    const head = outcome === 'found' ? 'Trouvé !' : outcome === 'missed' ? 'Raté…' : 'Passé';
    content = (
      <>
        <h2 className="headline">{head}</h2>
        <WordBoard word={WORD2} />
        {outcome !== 'passed' && answer.trim() && (
          <p className="result-answer">
            Tu as répondu&nbsp;: <b>{answer.trim()}</b>
          </p>
        )}
        <p className="tuto-say">
          {outcome === 'found'
            ? 'Bravo, deuxième carte gagnée ! Tu as deviné avec les seuls indices qui ont survécu.'
            : outcome === 'missed'
              ? 'Une mauvaise réponse coûte cher : cette carte et la suivante sont perdues. Dans le doute, mieux vaut passer.'
              : 'Passer ne coûte que cette carte. Une mauvaise réponse, elle, en coûte deux.'}
        </p>
        <div className="easels n-3 tuto-easels">
          {CLUES2.map((c) => {
            const n = npc(c.by);
            return <Easel key={c.by} text={c.text} author={n.name} marker={n.marker} cancelled={c.cancelled} spent />;
          })}
        </div>
      </>
    );
    action = (
      <Button variant="primary" className="btn-lg btn-wide" icon={<ChevronRight size={22} />} onClick={next}>
        Ce qu’il faut retenir
      </Button>
    );
  } else {
    content = (
      <div className="tuto-lessons">
        <h2>À vous de jouer pour de vrai</h2>
        <ul>
          <li>
            <b>Un seul mot</b> par indice, sans le mot à deviner ni un mot de sa famille.
          </li>
          <li>
            <b>Deux indices pareils s’effacent.</b> Évite l’idée évidente que tout le monde aura.
          </li>
          <li>
            <b>Une seule réponse.</b> Raté, c’est deux cartes perdues&nbsp;; passer n’en coûte qu’une.
          </li>
          <li>
            <b>Le score</b>, c’est le nombre de cartes gagnées sur 13, ensemble.
          </li>
        </ul>
        <p className="tuto-small">À 3 joueurs, chacun écrit deux indices. Et pendant qu’on écrit, personne ne parle&nbsp;!</p>
      </div>
    );
    action = (
      <div className="tuto-end">
        {!inRoom && (
          <Button
            variant="primary"
            className="btn-lg btn-wide"
            icon={<Plus size={22} />}
            onClick={async () => {
              if (!profile.name.trim()) {
                close();
                useStore.getState().showToast('Il nous faut d’abord ton prénom.', 'info');
                window.setTimeout(() => document.getElementById('pseudo')?.focus(), 50);
                return;
              }
              if (await createRoom()) close();
            }}
          >
            Créer une table
          </Button>
        )}
        <Button variant={inRoom ? 'primary' : 'ghost'} className={cls(inRoom ? 'btn-lg btn-wide' : 'on-color')} onClick={close}>
          {inRoom ? 'Retour à la table' : 'Fermer'}
        </Button>
      </div>
    );
  }

  return (
    <div className="tutorial" role="dialog" aria-modal="true" aria-label="Partie d’essai">
      <div className={cls('screen', 'table', 'tuto-screen', `tone-${tone}`)}>
        <header className="topbar tuto-top">
          <span className="tuto-progress" aria-label={`Étape ${idx + 1} sur ${STEPS.length}`}>
            {STEPS.map((s, i) => (
              <span key={s} className={cls('pip', i < idx ? 'is-found' : i === idx ? 'is-current' : '')} />
            ))}
          </span>
          <button type="button" className="icon-btn" aria-label="Fermer la partie d’essai" onClick={close}>
            <X size={22} />
          </button>
        </header>
        <div ref={body} className="tuto-body">
          <main key={step} className="table-main tuto-step">
            {content}
            {action && <div className="bottom-bar tuto-actions">{action}</div>}
          </main>
        </div>
      </div>
    </div>
  );
}

function ClosedEye() {
  return (
    <svg className="closed-eye" viewBox="0 0 200 92" aria-hidden>
      <path d="M18 26c26 34 138 34 164 0" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
      <path d="M46 52l-10 20M78 62l-5 22M122 62l5 22M154 52l10 20M100 66v24" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
    </svg>
  );
}

function Eyelids() {
  return (
    <div className="eyelids" aria-hidden>
      <span className="lid is-top" />
      <span className="lid is-bottom" />
    </div>
  );
}
