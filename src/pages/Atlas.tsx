import { useEffect, useMemo, useRef, useState } from 'react';

type Sprite = { path: string; name: string; folder: string; w: number; h: number; bytes: number };
const BGS = { dark: '#23211a', light: '#e8e5d2', checker: 'repeating-conic-gradient(#3a3a3a 0% 25%, #555 0% 50%) 50% / 16px 16px' };

export function Atlas() {
  const [all, setAll] = useState<Sprite[]>([]);
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState('all');
  const [zoom, setZoom] = useState(2);
  const [bg, setBg] = useState<keyof typeof BGS>('dark');
  const [toast, setToast] = useState('');
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = () => fetch('/sprites.json', { cache: 'no-store' }).then(r => r.json()).then(setAll).catch(() => setToast('sprites.json unavailable'));
  useEffect(() => { load(); }, []);

  const folders = useMemo(() => ['all', ...Array.from(new Set(all.map(s => s.folder)))], [all]);
  const shown = all.filter(s => (folder === 'all' || s.folder === folder) && s.name.toLowerCase().includes(q.toLowerCase()));

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(''), 1800); };
  const copy = (t: string) => { navigator.clipboard?.writeText(t).then(() => say(`Copied ${t}`), () => say(t)); };

  async function upload(files: FileList | File[]) {
    let n = 0;
    for (const f of Array.from(files)) {
      const r = await fetch(`/__sprites/upload?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
      if (r.ok) n++; else say(`${f.name}: ${await r.text()}`);
    }
    if (n) { say(`Added ${n} sprite${n > 1 ? 's' : ''} to public/assets/sprites/`); setTimeout(load, 300); }
  }

  return (
    <main
      style={{ padding: 16, minHeight: '100vh', outline: drag ? '4px dashed var(--gold)' : 'none', outlineOffset: -8 }}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
    >
      <h1 style={{ fontSize: 18, fontWeight: 'normal', margin: '0 0 8px' }}>Atlas — {shown.length}/{all.length} sprites</h1>
      <p style={{ fontSize: 8, lineHeight: 1.6, color: 'var(--text-muted)', margin: '0 0 12px' }}>
        Add sprites: drop PNGs on this page, or put files in <code>public/assets/sprites/</code>. Name a 50×50 frame <code>name.9.png</code> and it is auto-cropped into <code>frames/</code>. Click a sprite to copy its path.
      </p>
      <div className="atlas-bar">
        <input placeholder="search…" value={q} onChange={e => setQ(e.target.value)} />
        <select value={folder} onChange={e => setFolder(e.target.value)}>{folders.map(f => <option key={f}>{f}</option>)}</select>
        <label>zoom {zoom}x <input type="range" min={1} max={6} value={zoom} onChange={e => setZoom(+e.target.value)} /></label>
        <select value={bg} onChange={e => setBg(e.target.value as keyof typeof BGS)}>{Object.keys(BGS).map(b => <option key={b}>{b}</option>)}</select>
        <button onClick={() => input.current?.click()}>+ add</button>
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={e => e.target.files && upload(e.target.files)} />
      </div>
      <div className="atlas-grid" style={{ ['--cell' as string]: `${Math.max(96, 16 * zoom + 32)}px` }}>
        {shown.map(s => (
          <button key={s.path} className="atlas-cell" onClick={() => copy(s.path)} title={`${s.path}\n${s.w}×${s.h}`}>
            <div className="atlas-img" style={{ background: BGS[bg] }}>
              <img src={s.path} width={s.w * zoom} height={s.h * zoom} style={{ maxWidth: '100%', height: 'auto' }} className="pixel" alt={s.name} loading="lazy" />
            </div>
            <div className="atlas-name">{s.name}</div>
            <div className="atlas-meta">{s.w}×{s.h} · {s.folder}</div>
          </button>
        ))}
      </div>
      {toast && <div className="atlas-toast">{toast}</div>}
    </main>
  );
}
