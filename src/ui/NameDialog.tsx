import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { PixelButton } from './PixelButton';

/** A small "type a name" dialog drawn inside the app (the browser's own prompt() is hidden in full screen). */
export function NameDialog({ open, title, initial, okLabel, cancelLabel, onSubmit, onClose }:
  { open: boolean; title: string; initial: string; okLabel: string; cancelLabel: string; onSubmit: (name: string) => void; onClose: () => void }) {
  const [value, setValue] = useState(initial);
  useEffect(() => { if (open) setValue(initial); }, [open, initial]);
  const ok = value.trim().length > 0;
  const submit = () => { if (ok) onSubmit(value.trim()); };
  return (
    <Modal open={open} onClose={onClose} title={title} theme="app">
      <input type="text" className="field" value={value} maxLength={40} autoFocus aria-label={title}
        onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
      <div className="row">
        <PixelButton scale={1} disabled={!ok} onClick={submit}>{okLabel}</PixelButton>
        <PixelButton scale={1} variant="red" onClick={onClose}>{cancelLabel}</PixelButton>
      </div>
    </Modal>
  );
}
