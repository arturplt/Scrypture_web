import { tickDef, tickHue, tickUrl } from './ticks';
import { useHuedUrls } from './hue';

/** The off and on sprites of a tick-box style in its colour variant (`[off, on]` as CSS `url(...)` values). */
export function useTickUrls(id: string): [string, string] {
  const d = tickDef(id);
  const [off, on] = useHuedUrls([`/assets/${d.off}.png`, `/assets/${d.on}.png`], tickHue(id));
  return [off ?? tickUrl(d.off), on ?? tickUrl(d.on)];
}

/** One tick box sample, checked or not (Theme manager mockup). */
export function TickSample({ id, checked }: { id: string; checked: boolean }) {
  const [off, on] = useTickUrls(id);
  return <i className="tick-sample" style={{ backgroundImage: checked ? on : off }} />;
}

/** Unchecked + checked sample of a tick-box style (Settings). */
export function TickLook({ id }: { id: string }) {
  const [off, on] = useTickUrls(id);
  return (
    <span className="tick-pair" aria-hidden>
      <i className="tick-sample" style={{ backgroundImage: off }} />
      <i className="tick-sample" style={{ backgroundImage: on }} />
    </span>
  );
}
