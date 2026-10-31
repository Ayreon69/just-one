// Salon : on invite, on voit qui est là, et on lance. Les réglages sont bons d'office : ils restent repliés.
import { BookOpen, Check, ChevronDown, Copy, Crown, LogOut, Play, QrCode, Share2, UserX } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { CARD_OPTIONS, MAX_PLAYERS, MIN_PLAYERS, THEMES, THEME_IDS, TIMER_OPTIONS, type AnswerMode, type CardSetting, type PlayerView, type RoomView, type ThemeId, type TimerSetting } from '../../../shared/protocol';
import { Button, Dot, Logo, Modal, Segmented } from '../components/Ui';
import { cls, plural, shareUrl, useThemeColor } from '../lib/util';
import { leaveRoom, send } from '../net';
import { useStore } from '../store';

function PlayerRow({ p, view }: { p: PlayerView; view: RoomView }) {
  const isHost = view.hostId === view.me;
  const me = p.id === view.me;
  return (
    <li className={cls('player-row', me && 'is-me', !p.connected && 'is-off')}>
      {me ? (
        <button type="button" className="dot-btn" aria-label="Changer la couleur de mon feutre" title="Changer de feutre" onClick={() => void send('room:marker')}>
          <Dot name={p.name} marker={p.marker} />
        </button>
      ) : (
        <Dot name={p.name} marker={p.marker} />
      )}
      <span className="player-name">
        {p.name}
        {me && <span className="muted"> (toi)</span>}
      </span>
      {p.isHost && (
        <span className="pill">
          <Crown size={12} aria-hidden /> Hôte
        </span>
      )}
      {!p.connected && <span className="pill is-off">Hors ligne</span>}
      {isHost && !me && (
        <button type="button" className="icon-btn on-light" aria-label={`Retirer ${p.name}`} onClick={() => void send('room:kick', { playerId: p.id })}>
          <UserX size={18} />
        </button>
      )}
    </li>
  );
}

export function Lobby({ view }: { view: RoomView }) {
  useThemeColor('#2346f5');
  const setRulesOpen = useStore((s) => s.setRulesOpen);
  const isHost = view.hostId === view.me;
  const seated = view.players.filter((p) => p.status !== 'spectator');
  const spectators = view.players.filter((p) => p.status === 'spectator');
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState(false);
  const [open, setOpen] = useState(false);
  const url = shareUrl(view.code);
  const host = view.players.find((p) => p.id === view.hostId);
  const s = view.settings;
  const missing = Math.max(0, MIN_PLAYERS - seated.length);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      useStore.getState().showToast(`Lien : ${url}`, 'info');
    }
  };
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Just One', text: `Rejoins ma table de Just One (code ${view.code}) !`, url });
      } catch {
        /* partage annulé */
      }
    } else void copy();
  };

  const toggleTheme = (id: ThemeId) => {
    const on = s.themes.includes(id);
    if (on && s.themes.length === 1) {
      useStore.getState().showToast('Garde au moins un thème.', 'info');
      return;
    }
    void send('room:settings', { themes: on ? s.themes.filter((t) => t !== id) : [...s.themes, id] });
  };

  const summary = [`${s.cards} cartes`, s.answer === 'oral' ? 'réponse à voix haute' : 'réponse à l’écrit', s.timer ? `${s.timer} s pour écrire` : 'sans chrono', s.themes.length === THEME_IDS.length ? 'tous les thèmes' : plural(s.themes.length, 'thème')];

  return (
    <div className="screen lobby-screen">
      <div className="lobby">
        <header className="lobby-top">
          <Logo size="sm" />
          <Button variant="ghost" className="on-color" icon={<LogOut size={18} />} onClick={() => void leaveRoom()}>
            Quitter
          </Button>
        </header>

        <section className="code-panel">
          <button type="button" className="big-code" onClick={copy} aria-label={`Code ${view.code.split('').join(' ')}. Copier le lien`}>
            {view.code.split('').map((c, i) => (
              <span key={i} style={{ animationDelay: `${i * 0.08}s` }}>
                {c}
              </span>
            ))}
          </button>
          <div className="share-row">
            <Button variant="primary" className="share-main" icon={<Share2 size={18} />} onClick={share}>
              Inviter des amis
            </Button>
            <Button icon={copied ? <Check size={18} /> : <Copy size={18} />} onClick={copy} aria-label="Copier le lien">
              {copied ? 'Copié !' : null}
            </Button>
            <Button icon={<QrCode size={18} />} onClick={() => setQr(true)} aria-label="Afficher le QR code" />
          </div>
        </section>

        <div className="lobby-cols">
          <section className="sheet">
            <div className="sheet-head">
              <h3>
                Autour de la table <span className="muted">{seated.length}/{MAX_PLAYERS}</span>
              </h3>
            </div>
            <ul className="player-list">
              {seated.map((p) => (
                <PlayerRow key={p.id} p={p} view={view} />
              ))}
              {Array.from({ length: missing }, (_, i) => (
                <li key={`empty${i}`} className="player-row is-empty">
                  <span className="dot is-ghost" aria-hidden />
                  <span className="player-name muted">Une place libre…</span>
                </li>
              ))}
            </ul>
            <p className="muted small lobby-note">{seated.length === 3 ? 'À 3, chacun écrit 2 indices par carte.' : 'Touche ta pastille pour changer de feutre.'}</p>
            {spectators.length > 0 && <p className="muted small">Spectateurs : {spectators.map((p) => p.name).join(', ')}</p>}
          </section>

          <section className="sheet settings">
            <button type="button" className="settings-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              <span>
                <b>Réglages</b>
                <small>{summary.join(' · ')}</small>
              </span>
              <ChevronDown size={20} className={cls('chevron', open && 'is-open')} aria-hidden />
            </button>
            {open && (
              <div className="settings-body">
                {!isHost && <p className="muted small">Choisis par {host?.name ?? "l'hôte"}.</p>}
                <span className="field-label">La réponse</span>
                <Segmented<AnswerMode>
                  label="Comment se donne la réponse"
                  value={s.answer}
                  disabled={!isHost}
                  onChange={(answer) => void send('room:settings', { answer })}
                  options={[
                    { value: 'oral', label: 'À voix haute', sub: 'les autres valident' },
                    { value: 'written', label: 'À l’écrit', sub: 'l’appli vérifie' },
                  ]}
                />
                <p className="muted small lobby-note">Les indices, eux, s'écrivent toujours dans l'appli : ils doivent rester cachés jusqu'à la comparaison.</p>

                <span className="field-label">Longueur</span>
                <Segmented<CardSetting>
                  label="Nombre de cartes"
                  value={s.cards}
                  disabled={!isHost}
                  onChange={(cards) => void send('room:settings', { cards })}
                  options={CARD_OPTIONS.map((n) => ({ value: n, label: `${n} cartes`, sub: n === 13 ? 'la vraie partie' : 'pour aller vite' }))}
                />

                <span className="field-label">Temps pour écrire</span>
                <Segmented<TimerSetting> label="Temps pour écrire son indice" value={s.timer} disabled={!isHost} onChange={(timer) => void send('room:settings', { timer })} options={TIMER_OPTIONS.map((t) => ({ value: t, label: t === 0 ? 'Sans limite' : `${t} s` }))} />

                <span className="field-label">Les mots</span>
                <div className="theme-chips">
                  {THEMES.map((t) => {
                    const on = s.themes.includes(t.id);
                    return (
                      <button key={t.id} type="button" className={cls('chip', on && 'is-on')} role="checkbox" aria-checked={on} disabled={!isHost} onClick={() => toggleTheme(t.id)}>
                        <span aria-hidden>{t.emoji}</span> {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="lobby-cta">
          {isHost ? (
            <Button variant="primary" className="btn-lg btn-wide" icon={missing === 0 ? <Play size={22} /> : undefined} disabled={missing > 0} onClick={() => void send('game:start')}>
              {missing > 0 ? `Encore ${plural(missing, 'joueur')} pour commencer` : `C'est parti, à ${seated.length} !`}
            </Button>
          ) : (
            <div className="waiting" role="status">
              <span className="spinner" /> {host?.name ?? "L'hôte"} va lancer la partie…
            </div>
          )}
        </div>
        <Button variant="ghost" className="on-color" icon={<BookOpen size={18} />} onClick={() => setRulesOpen(true)}>
          Les règles en 1 minute
        </Button>

        <Modal open={qr} onClose={() => setQr(false)} title={`Table ${view.code}`}>
          <div className="qr-box">
            <QRCodeSVG value={url} size={220} bgColor="#fffefa" fgColor="#14162b" level="M" includeMargin />
            <p className="muted small">Scanne pour rejoindre la table directement.</p>
            <code className="url-code">{url}</code>
          </div>
        </Modal>
      </div>
    </div>
  );
}
