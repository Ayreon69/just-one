// Accueil : le titre, une petite scène qui montre le principe, un prénom, et on crée ou on rejoint une table.
import { ArrowRight, BookOpen, House, MessageSquare, LogIn, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Easel, Logo } from '../components/Ui';
import { cls, reducedMotion, useThemeColor } from '../lib/util';
import { codeFromUrl, createRoom, joinRoom } from '../net';
import { useStore } from '../store';

const DEMOS = [
  { word: 'Chat', clues: ['Miaou', 'Griffes', 'Miaou'], guess: 'Chat !' },
  { word: 'Pizza', clues: ['Italie', 'Four', 'Italie'], guess: 'Pizza !' },
  { word: 'Plage', clues: ['Sable', 'Serviette', 'Sable'], guess: 'Plage !' },
  { word: 'Batman', clues: ['Gotham', 'Cape', 'Gotham'], guess: 'Batman !' },
];

const CAPTIONS = ['Chacun écrit un indice…', 'Deux indices pareils ? Ils s’effacent.', 'Et il faut deviner avec ce qui reste.'];

/** Le principe en six secondes : trois tableaux, deux qui s'annulent, un mot trouvé quand même. */
function Demo() {
  const [i, setI] = useState(0);
  const [step, setStep] = useState(reducedMotion() ? 2 : 0);
  const demo = DEMOS[i];
  useEffect(() => {
    if (reducedMotion()) return;
    setStep(0);
    const timers = [window.setTimeout(() => setStep(1), 1900), window.setTimeout(() => setStep(2), 3500), window.setTimeout(() => setI((x) => (x + 1) % DEMOS.length), 6200)];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [i]);

  return (
    <div className="demo" aria-hidden>
      <p className="demo-word">
        Le mot : <b className="highlight">{demo.word}</b>
      </p>
      <div className="demo-boards" key={i}>
        {demo.clues.map((clue, k) => (
          <div key={k} className="demo-board" style={{ animationDelay: `${k * 0.32}s` }}>
            <Easel text={clue} marker={[0, 2, 3][k]} cancelled={step >= 1 && k !== 1 ? 'double' : null} />
          </div>
        ))}
      </div>
      <p className="demo-caption" key={`c${step}`}>
        {step === 2 ? <b className="demo-guess">{demo.guess} ✓</b> : CAPTIONS[step]}
      </p>
    </div>
  );
}

export function Home() {
  useThemeColor('#2346f5');
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const setRulesOpen = useStore((s) => s.setRulesOpen);
  const conn = useStore((s) => s.conn);
  const [invited, setInvited] = useState(codeFromUrl);
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const nameOk = profile.name.trim().length > 0;

  useEffect(() => {
    const sync = () => setInvited(codeFromUrl());
    window.addEventListener('jo:url', sync);
    return () => window.removeEventListener('jo:url', sync);
  }, []);
  // Invité par un lien : il ne reste qu'à donner son prénom.
  useEffect(() => {
    if (invited && !profile.name) nameInput.current?.focus({ preventScroll: true });
  }, [invited]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (key: string, fn: () => Promise<boolean>) => {
    if (busy) return;
    if (!nameOk) {
      useStore.getState().showToast('Il nous faut d’abord ton prénom.', 'info');
      nameInput.current?.focus();
      return;
    }
    setBusy(key);
    await fn();
    setBusy(null);
  };

  const cleanCode = code.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4);

  return (
    <div className="screen home">
      <div className="home-inner">
        <div className="home-links">
          <a className="all-games" href="https://akhis-games.onrender.com">
            <House size={16} aria-hidden /> Tous les jeux
          </a>
          <a className="all-games" href="https://akhis-games.onrender.com/feedback.html?jeu=justone">
            <MessageSquare size={16} aria-hidden /> Feedback
          </a>
        </div>
        <div className="home-grid">
          <header className="home-hero">
            <Logo size="lg" />
            <p className="tagline">Un mot à faire deviner. Un indice chacun. Sans avoir la même idée que les autres.</p>
            <Demo />
          </header>

          <section className="home-panel">
            {invited && (
              <p className="invite-banner">
                Table <b>{invited}</b> : on n'attend plus que toi !
              </p>
            )}
            <label className="field-label" htmlFor="pseudo">
              Ton prénom
            </label>
            <input
              id="pseudo"
              ref={nameInput}
              className="input input-lg"
              placeholder="Ex. Léa"
              value={profile.name}
              maxLength={16}
              autoComplete="given-name"
              enterKeyHint="go"
              onChange={(e) => setProfile({ name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                if (invited) void run('join', () => joinRoom(invited));
                else if (joining && cleanCode.length === 4) void run('join', () => joinRoom(cleanCode));
                else if (!joining) void run('create', () => createRoom());
              }}
            />

            {invited ? (
              <div className="home-actions">
                <Button variant="primary" className="btn-lg" icon={<ArrowRight size={22} />} disabled={!!busy} onClick={() => run('join', () => joinRoom(invited))}>
                  {busy === 'join' ? 'Connexion…' : 'Rejoindre la table'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    window.history.replaceState(null, '', '/');
                    setInvited(null);
                  }}
                >
                  Créer ma propre table à la place
                </Button>
              </div>
            ) : (
              <div className="home-actions">
                <Button variant="primary" className="btn-lg" icon={<Plus size={22} />} disabled={!!busy} onClick={() => run('create', () => createRoom())}>
                  {busy === 'create' ? 'Création…' : 'Créer une table'}
                </Button>
                {joining ? (
                  <div className="join-row">
                    <input
                      className="input code-input"
                      placeholder="CODE"
                      value={cleanCode}
                      maxLength={4}
                      aria-label="Code de la table"
                      autoCapitalize="characters"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      autoFocus
                      enterKeyHint="go"
                      onChange={(e) => {
                        const next = e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4);
                        setCode(next);
                        // Le quatrième caractère suffit : pas besoin d'un bouton de plus.
                        if (next.length === 4 && nameOk) void run('join', () => joinRoom(next));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && cleanCode.length === 4) void run('join', () => joinRoom(cleanCode));
                      }}
                    />
                    <Button icon={<LogIn size={18} />} disabled={cleanCode.length !== 4 || !!busy} onClick={() => run('join', () => joinRoom(cleanCode))}>
                      Rejoindre
                    </Button>
                  </div>
                ) : (
                  <Button icon={<LogIn size={20} />} className="btn-lg" onClick={() => setJoining(true)}>
                    J'ai un code
                  </Button>
                )}
              </div>
            )}
            <Button variant="ghost" className={cls('rules-link')} icon={<BookOpen size={18} />} onClick={() => setRulesOpen(true)}>
              Les règles en 1 minute
            </Button>
            <p className="home-note">De 3 à 10 joueurs, chacun sur son téléphone. Idéal en appel vocal ou dans la même pièce.</p>
            {conn !== 'online' && (
              <p className="wake-note" role="status">
                <span className="spinner" /> Réveil du serveur… (jusqu'à une minute la première fois)
              </p>
            )}
          </section>
        </div>

        <footer className="home-foot">
          D'après <i>Just One</i> de Ludovic Roudy et Bruno Sautter (Repos Production). Création de fans, non officielle.
        </footer>
      </div>
    </div>
  );
}
