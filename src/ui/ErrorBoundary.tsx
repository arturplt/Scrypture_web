import { Component, type ReactNode } from 'react';
import { actions } from '../data/hooks';

/** Words for the crash screen. Kept right here, not in `src/i18n`, because this screen must work when state or i18n is what broke;
 *  the language is whatever the page was last told (`<html lang>`, set by the App). Latin and Polish are mine, not reviewed. */
const WORDS = {
  en: { title: 'Something broke', body: 'Bóbr tripped over a stick. Your progress is safe in this browser.', reload: 'Reload', backup: 'Export backup', fail: 'Could not export the data.' },
  la: { title: 'Aliquid fractum est', body: 'Bóbr in virga offendit. Progressus tuus in hoc navigatro tutus est.', reload: 'Renova', backup: 'Exporta exemplar', fail: 'Data exportari non potuerunt.' },
  pl: { title: 'Coś się zepsuło', body: 'Bóbr potknął się o patyk. Twoje postępy są bezpieczne w tej przeglądarce.', reload: 'Odśwież', backup: 'Eksportuj kopię', fail: 'Nie udało się wyeksportować danych.' },
};
const words = () => {
  let l = 'en';
  try { l = document.documentElement.lang.slice(0, 2).toLowerCase(); } catch { /* no document */ }
  return WORDS[l as keyof typeof WORDS] ?? WORDS.en;
};

/** Last line of defence: a render crash must never trap the user's data. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('Scrypture crashed', error); }

  exportData = () => {
    try {
      const url = URL.createObjectURL(new Blob([actions.exportData()], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `scrypture-rescue-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a); a.click(); a.remove();
    } catch { alert(words().fail); }
  };

  render() {
    if (!this.state.error) return this.props.children;
    const w = words();
    return (
      <main style={{ padding: 24, display: 'grid', gap: 16, maxWidth: 480, margin: '0 auto', lineHeight: 1.7 }} role="alert">
        <h1 style={{ fontSize: 'var(--fs-md)', fontWeight: 'normal', color: 'var(--gold)' }}>{w.title}</h1>
        <p style={{ fontSize: 'calc(10px * var(--font-scale))' }}>{w.body}</p>
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{this.state.error.message}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="seg on" onClick={() => location.reload()}>{w.reload}</button>
          <button className="seg" onClick={this.exportData}>{w.backup}</button>
        </div>
      </main>
    );
  }
}
