// Test de bout en bout : de vrais clients (socket.io) jouent sur le serveur compilé.
// Une partie à voix haute à 5 joueurs (coupure, retardataire, doublons, correction, dernière carte ratée),
// puis une partie à l'écrit à 3 (2 indices chacun, chrono, changement de mot, hôte qui n'attend plus).
// À chaque état reçu, on vérifie que celui qui devine ne reçoit rien de ce qu'il ne doit pas voir.
// Usage : npm run build && npm run e2e
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';

const PORT = 3900 + Math.floor(Math.random() * 90);
const URL = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['dist/server/index.mjs'], {
  env: { ...process.env, PORT: String(PORT), JO_FAST: '1' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  server.kill();
  process.exit(1);
};
setTimeout(() => fail('délai dépassé (3 min)'), 180_000).unref();

await new Promise((resolve) => server.stdout.on('data', (d) => String(d).includes('prêt') && resolve()));

const stats = { audited: 0, cards: 0, doubles: 0, erased: 0, away: 0, swaps: 0, forced: 0, timeouts: 0, emotes: 0, reconnected: false, late: false, games: 0 };

/** Ce que voient les uns et les autres, confronté à la fin : un état peut arriver avant celui du voisin. */
const wordsOf = new Map();
const textsOf = new Map();
const guesserViews = new Map();
const writeViews = new Map();

function bucket(map, key, make) {
  if (!map.has(key)) map.set(key, make());
  return map.get(key);
}

function audit(c, v) {
  const json = JSON.stringify(v);
  if (json.includes('"token"')) fail('un jeton circule');
  const g = v.game;
  if (v.phase !== 'playing' || !g) return;
  stats.audited++;
  const r = g.round;
  const tag = `${stats.games}:${r.n}`;
  if (g.pips.length !== g.total) fail(`${g.pips.length} pastilles pour ${g.total} cartes`);
  if (g.found !== g.pips.filter((p) => p === 'found').length) fail('le score ne suit pas les pastilles');
  if (v.players.some((p) => p.away)) stats.away++;
  if (r.stage === 'write' && r.clues.length) fail('des indices circulent pendant l’écriture');
  if (r.outcome === 'missed' && r.penalty === null && g.found > 0) fail('une erreur sans pénalité');
  if (r.role === 'guesser' && r.stage !== 'result') {
    if (r.word !== null) fail('celui qui devine reçoit le mot');
    if (r.mine.length) fail('celui qui devine a des indices');
    if (r.stage !== 'guess' && r.clues.length) fail('celui qui devine reçoit les indices avant la comparaison');
    for (const clue of r.clues) {
      if (clue.cancelled && clue.text !== null) fail('celui qui devine lit un indice effacé');
      if (clue.cancelled && clue.cancelled !== 'manual') fail('celui qui devine apprend pourquoi un indice est effacé');
    }
    bucket(guesserViews, tag, () => []).push({ json, early: r.stage !== 'guess' });
  } else if (r.word) bucket(wordsOf, tag, () => new Set()).add(r.word);
  if (r.role !== 'guesser' && r.stage === 'write') bucket(writeViews, tag, () => []).push({ json, me: v.me });
  if (r.role !== 'guesser' && r.stage === 'check') {
    for (const clue of r.clues) {
      bucket(textsOf, tag, () => new Map()).set(`${clue.author}|${clue.text}`, clue);
      if (clue.cancelled === 'double') stats.doubles++;
    }
  }
}

function client(name) {
  const socket = io(URL, { transports: ['websocket'], forceNew: true });
  const c = { name, socket, view: null, acted: new Set(), session: null, paused: false, gone: false };
  socket.on('state', (v) => {
    c.view = v;
    audit(c, v);
    if (!c.paused && !c.gone) play(c);
  });
  socket.on('emote', () => stats.emotes++);
  c.call = (event, payload = {}) => new Promise((res) => socket.emit(event, payload, res));
  return c;
}

function once(c, key, fn) {
  if (c.acted.has(key)) return;
  c.acted.add(key);
  fn();
}

/** Un petit temps de réflexion, pour que les joueurs agissent presque en même temps, sans être synchrones. */
const later = (c, fn) => setTimeout(() => !c.paused && !c.gone && c.socket.connected && fn(), 10 + Math.random() * 30);
const check = (what) => (res) => res?.ok || fail(`${what} : ${res?.error}`);

// Le scénario de chaque partie, carte par carte.
const ORAL = { 1: 'found', 2: 'found', 3: 'found', 4: 'missed', 5: 'empty', 6: 'passed', 7: 'found', 8: 'found', 9: 'missed', 10: 'found', 11: 'missed' };
const WRITTEN = { 1: 'found', 2: 'empty', 3: 'found', 4: 'found', 5: 'found', 6: 'missed' };

let correction = 'todo';

function cluesFor(c, r) {
  const i = bots.indexOf(c);
  const a = 'QWRTYPMN'[i] + 'ZXKVJGHB'[i];
  const texts = [`${a}${stats.games}${r.n}`, `${a[1]}${a[0]}${stats.games}${r.n}`].slice(0, r.slots);
  if (stats.games === 0) {
    // Tout le monde écrit la même chose : la carte s'efface entièrement.
    if (r.n === 5) return ['Doublon'];
    // Deux joueurs ont la même idée.
    if (r.n % 3 === 0 && r.givers.indexOf(c.view.me) < 2) return ['Doublon'];
  }
  return texts;
}

function write(c, v, r, tag) {
  once(c, `write:${tag}:${r.swap?.n ?? 0}`, () => {
    cluesFor(c, r).forEach((text, slot) => {
      later(c, () =>
        c.socket.emit('game:clue', { slot, text }, (res) => {
          // Le chrono ou l'hôte a pu clore la carte entre-temps.
          if (!res?.ok && !/Trop tard/.test(res?.error ?? '')) fail(`indice refusé (${text}) : ${res?.error}`);
        }),
      );
    });
  });
}

function writeStage(c, v, r, tag) {
  if (r.mine.some(Boolean) && r.swap && !r.mine.some((m) => m.includes(String(stats.games)))) fail('le changement de mot garde les anciens indices');
  if (stats.games === 0 && r.n === 3 && !cut.done && c === others[3]) {
    cut.done = true;
    void cut(c);
    return;
  }
  if (stats.games === 0 && r.n === 7 && c === host && !stats.late) {
    stats.late = true;
    void latecomer();
  }
  if (r.role !== 'giver') return;
  if (stats.games === 1) {
    const holder = r.givers.find((id) => id !== v.hostId);
    // Carte 2 : personne n'écrit, le chrono tranche. Carte 3 : un joueur est trop lent. Carte 5 : l'hôte n'attend plus.
    if (r.n === 2) return;
    if ((r.n === 3 || r.n === 5) && v.me === holder) return;
    if (r.n === 4 && !r.swap) {
      if (r.givers[0] === v.me) once(c, `swap:${tag}`, () => c.socket.emit('game:swap', {}, check('changement de mot')));
      return;
    }
    if (r.n === 4 && r.swap && r.mine.some(Boolean) && !stats.swaps) stats.swaps = 1;
  }
  write(c, v, r, tag);
}

function checkStage(c, v, r, tag) {
  if (r.role !== 'giver') return;
  if (stats.games === 0 && r.n % 3 === 1 && r.givers[0] === v.me) {
    once(c, `erase:${tag}`, () => {
      const target = r.clues.find((x) => !x.cancelled);
      if (!target) return;
      stats.erased++;
      c.socket.emit('game:erase', { clue: target.id }, check('effacement'));
    });
  }
  // Un indice effacé remet les « prêts » à zéro : chacun revalide.
  if (!r.ready.includes(v.me)) later(c, () => c.socket.emit('game:ok', {}, check('validation')));
}

function guessStage(c, v, r, tag) {
  const plan = (stats.games === 0 ? ORAL : WRITTEN)[r.n];
  if (v.settings.answer === 'written') {
    if (r.role !== 'guesser') return;
    once(c, `answer:${tag}`, () => {
      // Une faute de casse et un article ne comptent pas.
      const word = [...(wordsOf.get(tag) ?? [])].pop() ?? 'rien';
      const text = plan === 'found' ? `le ${word.toLowerCase()}` : 'Mauvaise réponse';
      later(c, () => c.socket.emit('game:answer', { text }, check('réponse')));
    });
    return;
  }
  if (plan === 'passed') {
    if (r.role === 'guesser') once(c, `pass:${tag}`, () => later(c, () => c.socket.emit('game:pass', {}, check('passer'))));
    return;
  }
  if (r.role === 'guesser') return;
  // Tout le monde touche le verdict presque en même temps : seul le premier compte.
  once(c, `verdict:${tag}`, () => later(c, () => c.socket.emit('game:verdict', { outcome: plan, seq: r.seq }, check('verdict'))));
}

function resultStage(c, v, r, tag) {
  const plan = (stats.games === 0 ? ORAL : WRITTEN)[r.n];
  if (stats.games === 0 && r.n === 2 && correction !== 'done') {
    if (v.hostId !== v.me) return;
    if (correction === 'todo') {
      correction = 'sent';
      c.socket.emit('game:correct', { outcome: 'missed' }, check('correction'));
    } else if (correction === 'sent' && r.outcome === 'missed') {
      if (r.penalty !== 'next') fail('une correction ne remet pas la pénalité');
      correction = 'back';
      c.socket.emit('game:correct', { outcome: 'found' }, check('correction'));
    } else if (correction === 'back' && r.outcome === 'found') correction = 'done';
    if (correction !== 'done') return;
  }
  // Un état peut arriver en retard sur la correction : il sera suivi du bon.
  if (stats.games === 0 && r.n === 2 && r.outcome !== 'found') return;
  if (r.outcome !== plan) fail(`carte ${r.n} (${stats.games === 0 ? 'oral' : 'écrit'}) : ${r.outcome} au lieu de ${plan}`);
  if (r.n === 11 && stats.games === 0 && r.penalty !== 'success') fail('dernière carte ratée : une carte gagnée doit s’en aller');
  if (r.n === 4 && stats.games === 0 && r.penalty !== 'next') fail('une erreur doit perdre la carte suivante');
  if (r.outcome === 'empty' && stats.games === 1 && r.clues.length) stats.timeouts = -1;
  if (r.n === 2 && stats.games === 1 && r.clues.length === 0) stats.timeouts++;
  if (r.n === 3 && stats.games === 1 && r.clues.length === 2) stats.timeouts++;
  once(c, `emote:${tag}`, () => c === host && c.socket.emit('emote', { emoji: '🔥' }));
  once(c, `next:${tag}:${r.seq}`, () => {
    stats.cards += c === host ? 1 : 0;
    setTimeout(() => !c.gone && c.socket.emit('game:next', { seq: r.seq }, check('carte suivante')), 15);
  });
}

function play(c) {
  const v = c.view;
  if (!v) return;
  if (v.phase === 'finished') return finalStage(c, v);
  if (v.phase !== 'playing' || !v.game) return;
  const r = v.game.round;
  const tag = `${stats.games}:${r.n}`;
  // L'hôte n'attend plus le joueur lent de la carte 5.
  if (stats.games === 1 && r.stage === 'write' && r.n === 5 && v.hostId === v.me && r.written.length > 0)
    once(c, `force:${tag}`, () => {
      stats.forced++;
      c.socket.emit('game:force', {}, check('ne plus attendre'));
    });
  if (r.stage === 'write') writeStage(c, v, r, tag);
  else if (r.stage === 'check') checkStage(c, v, r, tag);
  else if (r.stage === 'guess') guessStage(c, v, r, tag);
  else resultStage(c, v, r, tag);
}

let switching = false;
/** Les états partent juste après l'accusé de réception : on leur laisse le temps d'arriver. */
const settle = () => new Promise((r) => setTimeout(r, 80));

function finalStage(c, v) {
  if (v.hostId !== v.me || switching) return;
  const f = v.final;
  if (!f) fail('pas de récapitulatif');
  switching = true;
  void (async () => {
    if (stats.games === 0) {
      if (f.total !== 13 || f.cards.length !== 11) fail(`partie à l’oral : ${f.cards.length} cartes sur ${f.total}`);
      if (f.found !== 5) fail(`partie à l’oral : ${f.found} cartes gagnées au lieu de 5`);
      // La partie peut finir avant le retour du joueur coupé.
      while (!stats.reconnected) await settle();
      // Seconde partie : à trois, à l'écrit, avec un chrono.
      await c.call('game:lobby').then(check('retour au salon'));
      for (const b of bots.slice(3)) {
        b.gone = true;
        await b.call('room:leave').then(check('départ'));
      }
      await c.call('room:settings', { answer: 'written', cards: 7, timer: 45 }).then(check('réglages'));
      stats.games = 1;
      await c.call('game:start').then(check('lancement'));
      switching = false;
      return;
    }
    if (f.total !== 7 || f.cards.length !== 6) fail(`partie à l’écrit : ${f.cards.length} cartes sur ${f.total}`);
    if (f.found !== 4) fail(`partie à l’écrit : ${f.found} cartes gagnées au lieu de 4`);
    // « Rejouer » repart d'une pioche neuve, et terminer sans carte jouée ramène au salon.
    for (const b of bots) b.gone = true;
    stats.games = 2;
    await c.call('game:start').then(check('rejouer'));
    await settle();
    if (c.view.game.pips.filter((p) => p === 'left').length !== 6) fail('rejouer ne remet pas la pioche à neuf');
    await c.call('game:finish').then(check('terminer'));
    await settle();
    if (c.view.phase !== 'lobby') fail('terminer sans carte jouée doit ramener au salon');
    finish();
  })();
}

const bots = Array.from({ length: 5 }, (_, i) => client(`Bot${i + 1}`));
const [host, ...others] = bots;
await new Promise((r) => host.socket.on('connect', r));
const created = await host.call('room:create', { name: host.name });
if (!created.ok) fail('création de table');
const code = created.data.code;
for (const b of others) {
  if (!b.socket.connected) await new Promise((r) => b.socket.on('connect', r));
  const res = await b.call('room:join', { code, name: b.name });
  if (!res.ok) fail(`${b.name} ne rejoint pas : ${res.error}`);
  b.session = res.data;
}
const wrong = await others[0].call('game:start');
if (wrong.ok) fail('un invité a pu lancer la partie');
const started = await host.call('game:start');
if (!started.ok) fail(`lancement : ${started.error}`);

// Un joueur coupe son téléphone en pleine écriture : on cesse de l'attendre, puis il revient.
async function cut(b) {
  b.paused = true;
  b.socket.disconnect();
  await new Promise((r) => setTimeout(r, 1500));
  b.socket.connect();
  await new Promise((r) => b.socket.once('connect', r));
  const res = await b.call('room:join', { code, playerId: b.session.playerId, token: b.session.token, resumeOnly: true });
  if (!res.ok) fail(`reprise de session : ${res.error}`);
  await settle();
  b.paused = false;
  stats.reconnected = true;
  play(b);
}

// Un retardataire arrive en pleine partie : il s'assoit et joue tout de suite.
async function latecomer() {
  const b = client('Bot6');
  bots.push(b);
  await new Promise((r) => b.socket.once('connect', r));
  const res = await b.call('room:join', { code, name: b.name });
  if (!res.ok) fail(`retardataire : ${res.error}`);
  b.session = res.data;
}

function finish() {
  for (const [tag, views] of guesserViews) {
    const words = wordsOf.get(tag) ?? new Set();
    const texts = [...(textsOf.get(tag)?.values() ?? [])];
    for (const { json, early } of views) {
      for (const w of words) if (json.includes(JSON.stringify(w))) fail(`carte ${tag} : le mot « ${w} » fuit vers celui qui devine`);
      if (early) for (const clue of texts) if (json.includes(JSON.stringify(clue.text))) fail(`carte ${tag} : l’indice « ${clue.text} » fuit avant la comparaison`);
    }
  }
  for (const [tag, views] of writeViews) {
    const texts = [...(textsOf.get(tag)?.values() ?? [])];
    for (const { json, me } of views) {
      const own = new Set(texts.filter((clue) => clue.author === me).map((clue) => clue.text));
      for (const clue of texts) if (clue.author !== me && !own.has(clue.text) && json.includes(JSON.stringify(clue.text))) fail(`carte ${tag} : l’indice « ${clue.text} » est visible avant la fin de l’écriture`);
    }
  }
  if (!stats.reconnected) fail('la reconnexion n’a pas eu lieu');
  if (!stats.late) fail('le retardataire n’est pas venu');
  if (stats.away === 0) fail('l’absent n’a jamais été signalé');
  if (stats.doubles === 0) fail('aucun doublon effacé');
  if (stats.erased === 0) fail('aucun indice effacé à la main');
  if (stats.swaps === 0) fail('aucun changement de mot');
  if (stats.forced === 0) fail('l’hôte n’a jamais cessé d’attendre');
  if (stats.timeouts < 2) fail(`le chrono n’a pas tranché (${stats.timeouts})`);
  if (stats.emotes === 0) fail('aucune réaction reçue');
  console.log(`✓ ${stats.cards} cartes jouées en 2 parties, ${stats.audited} états vérifiés, ${stats.doubles} doublons vus, ${stats.erased} effacés à la main, ${stats.forced} « ne plus attendre », ${stats.emotes} réactions, reconnexion et retardataire OK, aucune fuite vers celui qui devine`);
  for (const b of bots) b.socket.close();
  server.kill();
  process.exit(0);
}
