import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, THEMES, closeWords, clueProblem, clueTooClose, normalize, rightAnswer, tierFor, type Settings } from '../shared/protocol';
import { Game, type GameDeps } from '../server/game';
import { Room } from '../server/room';
import { WORDS } from '../server/words';

function setup(players = ['a', 'b', 'c', 'd'], settings: Partial<Settings> = {}, words = Array.from({ length: 60 }, (_, i) => `Mot${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + (Math.floor(i / 26) % 26))}zz`)) {
  let at = 0;
  const away = new Set<string>();
  const seats = [...players];
  const clock = { now: 1000 };
  const deps: GameDeps = {
    settings: { ...DEFAULT_SETTINGS, ...settings },
    seats: () => seats,
    isAway: (id) => away.has(id),
    drawWord: () => words[at++ % words.length],
    writeMs: 0,
    now: () => clock.now,
  };
  const game = new Game(deps);
  game.deal();
  return { game, away, seats, clock, deps };
}

/** Tous ceux qui écrivent posent un indice différent, puis valident la comparaison. */
function writeAll(game: Game, prefix = 'indice'): void {
  const c = game.card!;
  c.givers.forEach((id, i) => {
    for (let s = 0; s < c.slots; s++) expect(game.write(id, s, `${prefix}${id}${'xyzw'[i]}${'klmn'[s]}`)).toBeUndefined();
  });
  game.settle();
}

function okAll(game: Game): void {
  for (const id of game.card!.givers) expect(game.ok(id)).toBeUndefined();
  game.settle();
}

function playCard(game: Game, outcome: 'found' | 'missed' | 'passed'): void {
  writeAll(game);
  okAll(game);
  const c = game.card!;
  expect(c.stage).toBe('guess');
  const giver = c.givers[0];
  expect(game.verdict(giver, outcome, c.seq)).toBeUndefined();
  expect(c.stage).toBe('result');
}

describe('comparaison des mots', () => {
  it('reconnaît les variantes et la famille', () => {
    expect(closeWords('Chat', 'chats')).toBe(true);
    expect(closeWords('Été', 'ete')).toBe(true);
    expect(closeWords('Prince', 'Princesse')).toBe(true);
    expect(closeWords('Roman', 'Romancier')).toBe(true);
    expect(closeWords('Boulanger', 'Boulangerie')).toBe(true);
    expect(closeWords('Chanter', 'Chanteur')).toBe(true);
    expect(closeWords('Ami', 'Amie')).toBe(true);
    expect(closeWords('Moustache', 'Moustahe')).toBe(true);
  });

  it('laisse tranquilles les mots seulement ressemblants', () => {
    expect(closeWords('Bateau', 'Gâteau')).toBe(false);
    expect(closeWords('Chat', 'Château')).toBe(false);
    expect(closeWords('Mer', 'Mercure')).toBe(false);
    expect(closeWords('Mouton', 'Moutarde')).toBe(false);
    expect(closeWords('Chapeau', 'Chapelle')).toBe(false);
  });

  it('compare aussi les symboles et les nombres', () => {
    expect(closeWords('€', '€')).toBe(true);
    expect(closeWords('€', '$')).toBe(false);
    expect(closeWords('007', '007')).toBe(true);
  });

  it('refuse deux mots et le mot lui-même', () => {
    expect(clueProblem('', 'Baleine')).toBeTruthy();
    expect(clueProblem('gros poisson', 'Baleine')).toBe('Un seul mot !');
    expect(clueProblem('baleines', 'Baleine')).toBeTruthy();
    expect(clueProblem('Eiffel', 'Tour Eiffel')).toBeTruthy();
    expect(clueProblem('Mer', 'Baleine')).toBeNull();
    expect(clueProblem('Spider-Man', 'Baleine')).toBeNull();
    expect(clueProblem('007', 'James Bond')).toBeNull();
    expect(clueProblem('€', 'Banque')).toBeNull();
  });

  it('signale un indice trop proche du mot', () => {
    expect(clueTooClose('Princesse', 'Prince')).toBe(true);
    expect(clueTooClose('Baleineau', 'Baleine')).toBe(true);
    expect(clueTooClose('Mer', 'Baleine')).toBe(false);
  });

  it('accepte une réponse à une faute de frappe près', () => {
    expect(rightAnswer('la baleine', 'Baleine')).toBe(true);
    expect(rightAnswer('Baleines', 'Baleine')).toBe(true);
    expect(rightAnswer('balaine', 'Baleine')).toBe(true);
    expect(rightAnswer('tour eiffel', 'Tour Eiffel')).toBe(true);
    expect(rightAnswer('requin', 'Baleine')).toBe(false);
    expect(rightAnswer('lion', 'Lien')).toBe(false);
  });

  it('retire accents, articles et pluriels', () => {
    expect(normalize("L'Éléphant")).toBe('elephant');
    expect(normalize('Les châteaux')).toBe('chateau');
    expect(normalize('Œuf')).toBe('oeuf');
  });
});

describe('une carte', () => {
  it('celui qui devine n’écrit pas ; les autres oui', () => {
    const { game } = setup();
    const c = game.card!;
    expect(c.givers).not.toContain(c.guesser);
    expect(game.write(c.guesser, 0, 'triche')).toBeTruthy();
    expect(game.write(c.givers[0], 0, 'Mer')).toBeUndefined();
  });

  it('on attend tout le monde avant de comparer, et on peut reprendre son indice', () => {
    const { game } = setup();
    const c = game.card!;
    const [x, y, z] = c.givers;
    game.write(x, 0, 'Mer');
    game.write(y, 0, 'Bleu');
    game.settle();
    expect(c.stage).toBe('write');
    game.write(x, 0, '');
    game.write(z, 0, 'Gros');
    game.settle();
    expect(c.stage).toBe('write');
    game.write(x, 0, 'Océan');
    game.settle();
    expect(c.stage).toBe('check');
  });

  it('efface d’office les doublons et les indices trop proches du mot', () => {
    const { game } = setup(['a', 'b', 'c', 'd', 'e'], {}, ['Baleine']);
    const c = game.card!;
    const [w, x, y, z] = c.givers;
    game.write(w, 0, 'Mer');
    game.write(x, 0, 'mers');
    game.write(y, 0, 'Baleineau');
    game.write(z, 0, 'Géant');
    game.settle();
    expect(c.stage).toBe('check');
    const byText = Object.fromEntries(c.clues.map((k) => [k.text, k.cancelled]));
    expect(byText).toEqual({ Mer: 'double', mers: 'double', Baleineau: 'close', Géant: null });
  });

  it('une correction sur la comparaison demande à chacun de revalider', () => {
    const { game } = setup();
    writeAll(game);
    const c = game.card!;
    expect(c.stage).toBe('check');
    game.ok(c.givers[0]);
    game.ok(c.givers[1]);
    game.erase(c.givers[2], c.clues[0].id);
    expect(c.clues[0].cancelled).toBe('manual');
    expect(c.ready.size).toBe(0);
    game.erase(c.givers[2], c.clues[0].id);
    expect(c.clues[0].cancelled).toBeNull();
    okAll(game);
    expect(c.stage).toBe('guess');
  });

  it('si tout est effacé, la carte est perdue sans pénalité', () => {
    const { game } = setup(['a', 'b', 'c', 'd'], {}, ['Baleine', 'Autre']);
    const c = game.card!;
    for (const id of c.givers) game.write(id, 0, 'Mer');
    game.settle();
    expect(c.clues.every((k) => k.cancelled === 'double')).toBe(true);
    okAll(game);
    expect(c.stage).toBe('result');
    expect(c.outcome).toBe('empty');
    const t = game.tally();
    expect(t.left).toBe(12);
    expect(t.found).toBe(0);
  });

  it('à trois joueurs, chacun écrit deux indices différents', () => {
    const { game } = setup(['a', 'b', 'c']);
    const c = game.card!;
    expect(c.slots).toBe(2);
    const x = c.givers[0];
    expect(game.write(x, 0, 'Mer')).toBeUndefined();
    expect(game.write(x, 1, 'mers')).toBeTruthy();
    expect(game.write(x, 1, 'Bleu')).toBeUndefined();
    expect(game.hasWritten(c, x)).toBe(true);
    expect(game.write(x, 2, 'Trop')).toBeTruthy();
  });

  it('à quatre joueurs, un seul indice chacun', () => {
    expect(setup().game.card!.slots).toBe(1);
  });

  it('un mot inconnu : nouveau mot, tout s’efface', () => {
    const { game } = setup(['a', 'b', 'c', 'd'], {}, ['Premier', 'Second']);
    const c = game.card!;
    game.write(c.givers[0], 0, 'Mer');
    expect(game.swapWord(c.givers[1])).toBeUndefined();
    expect(c.word).toBe('Second');
    expect(c.texts.size).toBe(0);
    expect(c.swap).toEqual({ by: c.givers[1], n: 1 });
    expect(game.swapWord(c.guesser)).toBeTruthy();
  });

  it('on n’attend pas un absent, ni à l’écriture ni à la comparaison', () => {
    const { game, away } = setup();
    const c = game.card!;
    const [x, y, z] = c.givers;
    game.write(x, 0, 'Mer');
    game.write(y, 0, 'Bleu');
    away.add(z);
    game.settle();
    expect(c.stage).toBe('check');
    game.ok(x);
    game.ok(y);
    game.settle();
    expect(c.stage).toBe('guess');
    expect(c.clues).toHaveLength(2);
  });

  it('tout le monde absent : on attend', () => {
    const { game, away } = setup();
    const c = game.card!;
    for (const id of c.givers) away.add(id);
    game.settle();
    expect(c.stage).toBe('write');
  });

  it('le chrono clôt l’écriture avec les indices déjà posés', () => {
    const { game, clock, deps } = setup();
    deps.writeMs = 1000;
    game.deal();
    const c = game.card!;
    game.write(c.givers[0], 0, 'Mer');
    game.settle();
    expect(c.stage).toBe('write');
    clock.now += 1001;
    game.settle();
    expect(c.stage).toBe('check');
    expect(c.clues).toHaveLength(1);
  });

  it('le chrono sans aucun indice perd la carte, sans pénalité', () => {
    const { game, clock, deps } = setup();
    deps.writeMs = 1000;
    game.deal();
    clock.now += 1001;
    game.settle();
    expect(game.card!.outcome).toBe('empty');
    expect(game.tally().left).toBe(12);
  });

  it('l’hôte peut ne plus attendre, s’il y a au moins un indice', () => {
    const { game } = setup();
    const c = game.card!;
    expect(game.force()).toBeTruthy();
    game.write(c.givers[0], 0, 'Mer');
    expect(game.force()).toBeUndefined();
    expect(c.stage).toBe('check');
    expect(game.force()).toBeUndefined();
    expect(c.stage).toBe('guess');
  });

  it('si celui qui devine quitte la table, la carte passe au suivant sans rien perdre', () => {
    const { game, seats } = setup();
    const first = game.card!.guesser;
    seats.splice(seats.indexOf(first), 1);
    game.settle();
    expect(game.card!.guesser).not.toBe(first);
    expect(game.card!.stage).toBe('write');
    const t = game.tally();
    expect(t.left).toBe(12);
    expect(game.records).toHaveLength(0);
  });

  it('un retardataire écrit dès la carte en cours, s’il en est encore temps', () => {
    const { game, seats } = setup();
    seats.push('e');
    game.join('e');
    const c = game.card!;
    expect(c.givers).toContain('e');
    writeAll(game);
    expect(c.stage).toBe('check');
    seats.push('f');
    game.join('f');
    expect(c.givers).not.toContain('f');
  });

  it('moins de deux joueurs : la partie s’arrête', () => {
    const { game, seats } = setup();
    seats.length = 1;
    game.settle();
    expect(game.over).toBe(true);
  });
});

describe('la réponse', () => {
  it('à voix haute, ce sont les autres qui valident', () => {
    const { game } = setup();
    writeAll(game);
    okAll(game);
    const c = game.card!;
    expect(game.verdict(c.guesser, 'found', c.seq)).toBeTruthy();
    expect(c.stage).toBe('guess');
    expect(game.verdict(c.givers[0], 'found', c.seq)).toBeUndefined();
    expect(c.outcome).toBe('found');
  });

  it('deux appuis simultanés ne comptent qu’une fois', () => {
    const { game } = setup();
    writeAll(game);
    okAll(game);
    const c = game.card!;
    const seq = c.seq;
    game.verdict(c.givers[0], 'found', seq);
    game.verdict(c.givers[1], 'missed', seq);
    expect(c.outcome).toBe('found');
    expect(game.records).toHaveLength(1);
  });

  it('un appui en retard ne saute pas le résultat', () => {
    // Le second « Trouvé ! » part juste après le premier : son téléphone a déjà reçu l'écran du résultat,
    // et l'appui tombe sur « Carte suivante », au même endroit.
    const { game, clock, deps } = setup();
    deps.holdMs = 600;
    writeAll(game);
    okAll(game);
    clock.now += 600;
    const c = game.card!;
    game.verdict(c.givers[0], 'found', c.seq);
    expect(c.stage).toBe('result');
    clock.now += 150;
    expect(game.next(c.seq)).toBeUndefined();
    expect(game.card).toBe(c);
    expect(c.stage).toBe('result');
    clock.now += 450;
    game.next(c.seq);
    expect(game.card).not.toBe(c);
  });

  it('un appui en retard ne valide pas une réponse que personne n’a encore dite', () => {
    const { game, clock, deps } = setup();
    deps.holdMs = 600;
    writeAll(game);
    okAll(game);
    const c = game.card!;
    expect(c.stage).toBe('guess');
    clock.now += 100;
    game.verdict(c.givers[0], 'found', c.seq);
    expect(c.stage).toBe('guess');
    clock.now += 500;
    game.verdict(c.givers[0], 'found', c.seq);
    expect(c.stage).toBe('result');
  });

  it('« Ne plus attendre » ne vaut que pour l’étape que l’hôte voyait', () => {
    const { game } = setup();
    const c = game.card!;
    game.write(c.givers[0], 0, 'Indice');
    game.force('write');
    expect(c.stage).toBe('check');
    game.force('write');
    expect(c.stage).toBe('check');
    game.force('check');
    expect(c.stage).toBe('guess');
  });

  it('une rectification en retard ne touche pas une autre carte', () => {
    const { game } = setup();
    playCard(game, 'found');
    const c = game.card!;
    expect(game.correct(c.givers[0], false, 'missed', c.seq - 1)).toBeUndefined();
    expect(c.outcome).toBe('found');
    game.correct(c.givers[0], false, 'missed', c.seq);
    expect(c.outcome).toBe('missed');
  });

  it('à l’écrit, l’appli compare, et la table peut rectifier', () => {
    const { game } = setup(['a', 'b', 'c', 'd'], { answer: 'written' }, ['Baleine', 'Autre']);
    writeAll(game);
    okAll(game);
    const c = game.card!;
    expect(game.verdict(c.givers[0], 'found', c.seq)).toBeTruthy();
    expect(game.answer(c.givers[0], 'Baleine')).toBeTruthy();
    expect(game.answer(c.guesser, 'Cachalot')).toBeUndefined();
    expect(c.outcome).toBe('missed');
    expect(c.answer).toBe('Cachalot');
    expect(game.tally().left).toBe(11);
    expect(game.correct(c.givers[0], false, 'found')).toBeUndefined();
    expect(c.outcome).toBe('found');
    expect(c.penalty).toBeNull();
    const t = game.tally();
    expect(t.left).toBe(12);
    expect(t.found).toBe(1);
  });

  it('à l’écrit, la bonne réponse se reconnaît seule', () => {
    const { game } = setup(['a', 'b', 'c', 'd'], { answer: 'written' }, ['Baleine', 'Autre']);
    writeAll(game);
    okAll(game);
    const c = game.card!;
    game.answer(c.guesser, 'les baleines');
    expect(c.outcome).toBe('found');
  });

  it('celui qui devine ne se valide pas lui-même après coup', () => {
    const { game } = setup();
    playCard(game, 'missed');
    const c = game.card!;
    expect(game.correct(c.guesser, false, 'found')).toBeTruthy();
    expect(c.outcome).toBe('missed');
  });

  it('une carte passée ne se rectifie pas', () => {
    const { game } = setup();
    playCard(game, 'passed');
    const c = game.card!;
    expect(game.correct(c.givers[0], false, 'found')).toBeTruthy();
  });
});

describe('la pioche', () => {
  it('trouvé : la carte est gagnée', () => {
    const { game } = setup();
    playCard(game, 'found');
    const t = game.tally();
    expect(t.found).toBe(1);
    expect(t.left).toBe(12);
    expect(t.pips.slice(0, 2)).toEqual(['found', 'left']);
    expect(t.pips).toHaveLength(13);
  });

  it('raté : la carte et la suivante sont perdues', () => {
    const { game } = setup();
    playCard(game, 'missed');
    const t = game.tally();
    expect(t.found).toBe(0);
    expect(t.left).toBe(11);
    expect(game.card!.penalty).toBe('next');
    expect(t.pips.slice(0, 3)).toEqual(['lost', 'lost', 'left']);
  });

  it('passé : seule la carte est perdue', () => {
    const { game } = setup();
    playCard(game, 'passed');
    const t = game.tally();
    expect(t.left).toBe(12);
    expect(game.card!.penalty).toBeNull();
  });

  it('raté sur la dernière carte : une carte gagnée s’en va', () => {
    const { game } = setup(['a', 'b', 'c', 'd'], { cards: 7 });
    for (let i = 0; i < 6; i++) {
      playCard(game, 'found');
      game.next(game.card!.seq);
    }
    expect(game.tally().found).toBe(6);
    playCard(game, 'missed');
    expect(game.card!.penalty).toBe('success');
    const t = game.tally();
    expect(t.found).toBe(5);
    expect(t.left).toBe(0);
    game.correct(game.card!.givers[0], false, 'found');
    expect(game.tally().found).toBe(7);
    expect(game.card!.penalty).toBeNull();
  });

  it('une partie finit quand la pioche est vide, erreurs comprises', () => {
    const { game } = setup(['a', 'b', 'c', 'd'], { cards: 7 });
    let played = 0;
    while (!game.over) {
      playCard(game, played % 2 ? 'found' : 'missed');
      played++;
      game.next(game.card!.seq);
    }
    // 7 cartes : raté (2), trouvé, raté (2), trouvé, raté (dernière) : 5 cartes jouées.
    expect(played).toBe(5);
    const t = game.tally();
    expect(t.left).toBe(0);
    expect(t.found).toBe(1);
  });

  it('chacun devine à son tour, en sautant les absents', () => {
    const { game, away } = setup(['a', 'b', 'c', 'd']);
    const seen = [game.card!.guesser];
    playCard(game, 'found');
    game.next(game.card!.seq);
    seen.push(game.card!.guesser);
    away.add('c');
    playCard(game, 'found');
    game.next(game.card!.seq);
    seen.push(game.card!.guesser);
    expect(seen).toEqual(['a', 'b', 'd']);
  });

  it('un double appui sur « Carte suivante » ne saute pas de carte', () => {
    const { game } = setup();
    playCard(game, 'found');
    const seq = game.card!.seq;
    game.next(seq);
    const after = game.card!.n;
    game.next(seq);
    expect(game.card!.n).toBe(after);
    expect(game.card!.stage).toBe('write');
  });
});

describe('la table', () => {
  function table(n: number): { room: Room; ids: string[] } {
    const room = new Room('ABCD');
    room.holdMs = 0;
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const p = room.addHuman(`J${i}`);
      if (typeof p === 'string') throw new Error(p);
      room.connect(p, `s${i}`);
      ids.push(p.id);
    }
    room.hostId = ids[0];
    return { room, ids };
  }

  it('il faut trois joueurs, et seul l’hôte lance', () => {
    const { room, ids } = table(2);
    expect(room.start(ids[0])).toBeTruthy();
    expect(room.phase).toBe('lobby');
    const third = table(3);
    expect(third.room.start(third.ids[1])).toBeTruthy();
    expect(third.room.start(third.ids[0])).toBeUndefined();
    expect(third.room.phase).toBe('playing');
    third.room.dispose();
  });

  it('celui qui devine ne reçoit ni le mot ni les indices avant de pouvoir répondre', () => {
    const { room, ids } = table(4);
    room.start(ids[0]);
    const g = room.game!;
    const c = g.card!;
    const guesser = c.guesser;
    const giver = c.givers[0];
    expect(room.viewFor(guesser).game!.round.word).toBeNull();
    expect(JSON.stringify(room.viewFor(guesser))).not.toContain(c.word);
    expect(room.viewFor(giver).game!.round.word).toBe(c.word);

    c.givers.forEach((id, i) => g.write(id, 0, i === 0 ? 'Zèbre' : i === 1 ? 'zebres' : 'Xylophone'));
    expect(JSON.stringify(room.viewFor(giver)).includes('Xylophone')).toBe(false);
    g.settle();
    expect(c.stage).toBe('check');
    const during = JSON.stringify(room.viewFor(guesser));
    for (const text of ['Zèbre', 'zebres', 'Xylophone', c.word]) expect(during).not.toContain(text);
    expect(room.viewFor(giver).game!.round.clues).toHaveLength(3);

    for (const id of c.givers) g.ok(id);
    g.settle();
    expect(c.stage).toBe('guess');
    const seen = room.viewFor(guesser).game!.round;
    expect(seen.word).toBeNull();
    expect(seen.clues.filter((k) => k.text).map((k) => k.text)).toEqual(['Xylophone']);
    expect(JSON.stringify(seen)).not.toContain('Zèbre');
    expect(seen.clues.filter((k) => k.cancelled).every((k) => k.cancelled === 'manual')).toBe(true);

    g.verdict(giver, 'found', c.seq);
    const after = room.viewFor(guesser).game!.round;
    expect(after.word).toBe(c.word);
    expect(after.clues.map((k) => k.text)).toEqual(['Zèbre', 'zebres', 'Xylophone']);
    room.dispose();
  });

  it('personne ne voit l’indice d’un autre avant que tous aient écrit', () => {
    const { room, ids } = table(4);
    room.start(ids[0]);
    const g = room.game!;
    const c = g.card!;
    const [x, y] = c.givers;
    g.write(x, 0, 'Secretum');
    expect(room.viewFor(x).game!.round.mine).toEqual(['Secretum']);
    const other = room.viewFor(y);
    expect(JSON.stringify(other)).not.toContain('Secretum');
    expect(other.game!.round.written).toEqual([x]);
    room.dispose();
  });

  it('aucun jeton ne circule dans les vues', () => {
    const { room, ids } = table(3);
    room.start(ids[0]);
    expect(JSON.stringify(room.viewFor(ids[1]))).not.toContain('token');
    room.dispose();
  });

  it('un mot déjà sorti ne revient pas à la même table', () => {
    const { room, ids } = table(3);
    room.settings.themes = ['arts'];
    room.start(ids[0]);
    const seen = new Set<string>();
    const g = room.game!;
    for (let i = 0; i < 30; i++) {
      const word = g.card!.word;
      expect(seen.has(word)).toBe(false);
      seen.add(word);
      g.swapWord(g.card!.givers[0]);
    }
    room.dispose();
  });

  it('les âmes sœurs sont ceux qui ont le plus souvent écrit la même chose', () => {
    const { room, ids } = table(4);
    room.start(ids[0]);
    const g = room.game!;
    // Les deux joueurs qui écrivent sur les deux premières cartes ont deux fois la même idée.
    const pair = ids.filter((id) => id !== g.card!.guesser && id !== g.peekGuesser());
    for (let i = 0; i < 2; i++) {
      const c = g.card!;
      const givers = c.givers;
      for (const id of givers) g.write(id, 0, pair.includes(id) ? 'Identique' : 'Solitaire');
      g.settle();
      for (const id of givers) g.ok(id);
      g.settle();
      g.verdict(givers[0], 'found', c.seq);
      g.next(c.seq);
    }
    expect(room.finish(ids[0])).toBeUndefined();
    expect(room.phase).toBe('finished');
    expect(room.final!.cards).toHaveLength(2);
    const soulmates = room.final!.soulmates!;
    expect(soulmates.count).toBe(2);
    expect([soulmates.a, soulmates.b].sort()).toEqual(pair.map((id) => room.get(id)!.name).sort());
    room.dispose();
  });

  it('terminer sans carte jouée ramène au salon, avec un score sinon', () => {
    const { room, ids } = table(3);
    room.start(ids[0]);
    room.finish(ids[0]);
    expect(room.phase).toBe('lobby');
    expect(room.final).toBeNull();
  });

  it('les réglages gardent au moins un thème', () => {
    const { room, ids } = table(3);
    expect(room.updateSettings(ids[0], { themes: [] })).toBeTruthy();
    expect(room.updateSettings(ids[0], { themes: ['arts', 'inconnu'] })).toBeUndefined();
    expect(room.settings.themes).toEqual(['arts']);
    expect(room.updateSettings(ids[1], { cards: 7 })).toBeTruthy();
  });

  it('chacun a son feutre, et peut en changer', () => {
    const { room, ids } = table(5);
    const markers = room.players.map((p) => p.marker);
    expect(new Set(markers).size).toBe(5);
    room.changeMarker(ids[0]);
    expect(new Set(room.players.map((p) => p.marker)).size).toBe(5);
  });
});

describe('la liste de mots', () => {
  const all = Object.values(WORDS).flat();

  it('a de quoi jouer longtemps, dans chaque thème', () => {
    expect(all.length).toBeGreaterThan(1000);
    for (const t of THEMES) expect(WORDS[t.id].length, t.id).toBeGreaterThanOrEqual(90);
  });

  it('ne contient pas deux fois le même mot', () => {
    const seen = new Map<string, string>();
    const doubles: string[] = [];
    for (const w of all) {
      const k = normalize(w);
      if (seen.has(k)) doubles.push(`${w} / ${seen.get(k)}`);
      seen.set(k, w);
    }
    expect(doubles).toEqual([]);
  });

  it('ne contient que des mots courts et propres', () => {
    for (const w of all) {
      expect(w, w).toBe(w.trim());
      expect(w.length, w).toBeLessThanOrEqual(32);
      expect(w, w).toMatch(/^\p{Lu}|^[0-9]|^[a-z]/u);
    }
  });
});

describe('le barème', () => {
  it('suit les paliers de la boîte', () => {
    expect(tierFor(13, 13).title).toBe('Score parfait !');
    expect(tierFor(12, 13).title).toBe('Incroyable !');
    expect(tierFor(11, 13).title).toBe('Excellent !');
    expect(tierFor(10, 13).title).toBe('Très beau score');
    expect(tierFor(9, 13).title).toBe('Très beau score');
    expect(tierFor(8, 13).title).toBe('Dans la moyenne');
    expect(tierFor(5, 13).title).toBe('Bon début');
    expect(tierFor(0, 13).title).toBe('Ça arrive…');
  });

  it('ramène une partie courte à l’échelle', () => {
    expect(tierFor(7, 7).title).toBe('Score parfait !');
    expect(tierFor(0, 7).title).toBe('Ça arrive…');
  });
});
