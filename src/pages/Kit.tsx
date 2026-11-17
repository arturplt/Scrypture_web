import { useState } from 'react';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { PixelProgressBar } from '../ui/PixelProgressBar';
import { Chip, Divider, Icon, Modal, PixelCheckbox, StatBox } from '../ui/misc';
import { FRAME_THEMES, type FrameTheme } from '../ui/themes';
import { BAR_IDS } from '../ui/bars';

export function Kit() {
  const [checked, setChecked] = useState(false);
  const [open, setOpen] = useState(false);
  const [xp, setXp] = useState(60);
  return (
    <main style={{ padding: 16, maxWidth: 560, margin: '0 auto', display: 'grid', gap: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 'normal' }}>Pixel kit</h1>

      <h3>Buttons</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <PixelButton onClick={() => setXp(x => (x + 15) % 115)}>+XP</PixelButton>
        <PixelButton variant="red" onClick={() => setOpen(true)}>Modal</PixelButton>
        <PixelButton disabled>Off</PixelButton>
        <PixelButton scale={1}>Small</PixelButton>
      </div>

      <h3>Progress ({Math.min(xp, 100)}%)</h3>
      {BAR_IDS.map(id => <div key={id}><div style={{ fontSize: 8, marginBottom: 4 }}>{id}</div><PixelProgressBar value={xp} look={id} scale={1} /></div>)}

      <h3>Stats, icons, chips, checkbox</h3>
      <div style={{ display: 'flex', gap: 8 }}>
        <StatBox stat="body" value={12} /><StatBox stat="mind" value={7} /><StatBox stat="soul" value={3} />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Icon name="coin" /><Icon name="xp" /><Icon name="home" size={36} /><Icon name="task" size={36} /><Icon name="habit" size={36} />
        <Chip color="var(--success)">LOW</Chip><Chip color="var(--warning)">MEDIUM</Chip><Chip color="var(--error)">CRITICAL</Chip>
      </div>
      <PixelCheckbox checked={checked} onChange={setChecked} label="Task done" />
      <Divider />

      <h3>Bóbr</h3>
      <div style={{ display: 'flex', gap: 8 }}>
        {['hatchling', 'young', 'mature', 'ancient'].map(s => <img key={s} src={`/assets/raw/bobr_${s}.png`} width={80} alt={s} className="pixel" />)}
      </div>

      <h3>Frame themes</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
        {(Object.keys(FRAME_THEMES) as FrameTheme[]).map(t => (
          <PixelFrame key={t} theme={t} scale={1}><div style={{ fontSize: 8, wordBreak: 'break-all' }}>{t}</div></PixelFrame>
        ))}
      </div>
      <h3>Scales</h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <PixelFrame theme="gold_thick" scale={1}>x1</PixelFrame>
        <PixelFrame theme="gold_thick" scale={2}>x2</PixelFrame>
        <PixelFrame theme="gold_thick" scale={3}>x3</PixelFrame>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Level up!">
        <p style={{ fontSize: 10 }}>You reached level 2.</p>
        <PixelButton onClick={() => setOpen(false)}>OK</PixelButton>
      </Modal>
    </main>
  );
}
