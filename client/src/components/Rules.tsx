// Les règles, lisibles en une minute et consultables à tout moment.
import { Ban, EyeOff, MessageCircle, PenLine, Sparkles } from 'lucide-react';
import { useStore } from '../store';
import { Easel, Modal } from './Ui';

export function RulesModal() {
  const open = useStore((s) => s.rulesOpen);
  const setOpen = useStore((s) => s.setRulesOpen);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Les règles" wide>
      <div className="rules">
        <section className="rule-hero">
          <div className="rule-demo" aria-hidden>
            <Easel text="Miaou" marker={0} cancelled="double" />
            <Easel text="Griffes" marker={2} />
            <Easel text="Miaou" marker={3} cancelled="double" />
          </div>
          <p>
            <b>Vous jouez tous ensemble.</b> Faites deviner un maximum de mots à tour de rôle, avec un indice d'un seul mot chacun. Le piège : <b>si deux indices se ressemblent, ils s'effacent.</b> Il faut donc être bon… sans avoir la même idée que son voisin.
          </p>
        </section>

        <section>
          <h3>Une carte</h3>
          <ol className="rule-steps">
            <li>
              <EyeOff size={20} aria-hidden />
              <div>
                <b>Un joueur devine</b>, à tour de rôle. Il est le seul à ne pas voir le mot. Si quelqu'un ne connaît pas le mot, il peut en demander un autre.
              </div>
            </li>
            <li>
              <PenLine size={20} aria-hidden />
              <div>
                <b>Les autres écrivent un indice</b>, chacun de son côté et sans se concerter. <b>À 3 joueurs</b>, chacun en écrit deux.
              </div>
            </li>
            <li>
              <Ban size={20} aria-hidden />
              <div>
                <b>On compare.</b> L'appli efface déjà les doublons et les indices trop proches du mot. À vous de vérifier le reste : touchez un indice pour l'effacer, ou pour le rétablir.
              </div>
            </li>
            <li>
              <MessageCircle size={20} aria-hidden />
              <div>
                <b>Il répond, une seule fois.</b> À voix haute, les autres valident. À l'écrit, l'appli vérifie, et la table peut rectifier. Il peut aussi passer.
              </div>
            </li>
          </ol>
        </section>

        <section className="rule-columns">
          <div>
            <h3>Un indice, c'est…</h3>
            <p>
              <b>Un seul mot.</b> Un nombre (<i>007</i>), un sigle (<i>SNCF</i>), une onomatopée (<i>miaou</i>) ou un symbole (<i>€</i>) comptent pour un mot.
            </p>
          </div>
          <div>
            <h3>Pas d'indice avec…</h3>
            <p>Le mot lui-même, un mot de sa famille (<i>Prince</i> pour <i>Princesse</i>), sa traduction, un mot inventé, ou un mot qui se prononce pareil.</p>
          </div>
        </section>

        <section>
          <h3>La pioche</h3>
          <ul className="rule-outcomes">
            <li>
              <b className="is-good">Trouvé</b> la carte est gagnée.
            </li>
            <li>
              <b className="is-bad">Raté</b> cette carte et la suivante sont perdues. Sur la dernière carte, une carte déjà gagnée s'en va.
            </li>
            <li>
              <b className="is-neutral">Passé</b> seule cette carte est perdue.
            </li>
            <li>
              <b className="is-neutral">Tout effacé</b> seule cette carte est perdue.
            </li>
          </ul>
        </section>

        <section className="rule-goal">
          <Sparkles size={20} aria-hidden />
          <p>
            <b>Le score, c'est le nombre de cartes gagnées.</b> Une partie compte 13 cartes : 7 ou 8, c'est dans la moyenne ; 11, c'est excellent ; 13, c'est parfait.
          </p>
        </section>
      </div>
    </Modal>
  );
}
