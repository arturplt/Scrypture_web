import { Component, type ReactNode } from 'react';
import { actions } from '../data/hooks';

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
    } catch { alert('Could not export the data.'); }
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main style={{ padding: 24, display: 'grid', gap: 16, maxWidth: 480, margin: '0 auto', lineHeight: 1.7 }} role="alert">
        <h1 style={{ fontSize: 'var(--fs-md)', fontWeight: 'normal', color: 'var(--gold)' }}>Something broke</h1>
        <p style={{ fontSize: 'calc(10px * var(--font-scale))' }}>Bóbr tripped over a stick. Your progress is safe in this browser.</p>
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{this.state.error.message}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="seg on" onClick={() => location.reload()}>Reload</button>
          <button className="seg" onClick={this.exportData}>Export backup</button>
        </div>
      </main>
    );
  }
}
