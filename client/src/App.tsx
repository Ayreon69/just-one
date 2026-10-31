import { WifiOff } from 'lucide-react';
import { RulesModal } from './components/Rules';
import { Final } from './screens/Final';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { Table } from './screens/Table';
import { useStore } from './store';

export function App() {
  const view = useStore((s) => s.view);
  const conn = useStore((s) => s.conn);
  const everConnected = useStore((s) => s.everConnected);
  const toast = useStore((s) => s.toast);

  return (
    <>
      {!view ? <Home /> : view.phase === 'lobby' ? <Lobby view={view} /> : view.phase === 'finished' ? <Final view={view} /> : view.game ? <Table view={view} /> : <Lobby view={view} />}
      <RulesModal />
      {view && conn !== 'online' && everConnected && (
        <div className="conn-banner" role="status">
          <WifiOff size={16} /> Connexion perdue : reconnexion en cours…
        </div>
      )}
      {toast && (
        <div key={toast.id} className={`toast is-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'} onClick={() => useStore.setState({ toast: null })}>
          {toast.text}
        </div>
      )}
    </>
  );
}
