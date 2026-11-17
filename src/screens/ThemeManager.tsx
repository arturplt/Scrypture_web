import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { actions, useAppState } from '../data/hooks';
import { newId } from '../data/id';
import { back } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { ButtonLook, PixelButton } from '../ui/PixelButton';
import { PixelProgressBar } from '../ui/PixelProgressBar';
import { BAR_IDS, BAR_LABELS } from '../ui/bars';
import { BUTTON_STYLES, CHIP_SCALES, FRAME_HUES, FRAME_SCALES, FRAME_THEMES, backdropFrame, buildFrame, frameOr, resolveFrame, splitFrame, withHue, type FrameTheme } from '../ui/themes';
import { BUTTON_SIZES, CHIP_EDGES, CRT_LEVELS, DEFAULT_APPEARANCE, BUILTIN_PRESETS, MAX_PRESETS, appearanceOf, type Preset, FRAME_CENTERS, FRAME_EDGES, NAV_ACTIVE, NAV_LABELS, sanitizeNavItems } from '../domain';
import type { Key } from '../i18n';
import { CHIP_IDS, ChipLook, useCatChipStyle } from '../ui/chips';
import { TICK_IDS } from '../ui/ticks';
import { TickLook, TickSample } from '../ui/TickLook';
import { PLATE_IDS, usePlateAttrs } from '../ui/navPlates';
import { NAV_DEFS, isActivePath } from '../ui/navItems';
import { Chip, Icon, PixelCheckbox, StatBox } from '../ui/misc';
import { Slot } from '../ui/Inventory';
import { LIGHT_FRAMES } from '../ui/themes';
import { NavLook } from '../ui/NavLook';
import { useT } from '../i18n/useT';
import { LANGS, LANG_NAMES } from '../i18n';

const SIZE_LABEL: Record<(typeof BUTTON_SIZES)[number], Key> = { large: 'sizeLarge', medium: 'sizeMedium', compact: 'sizeCompact' };
const CENTER_LABEL: Record<(typeof FRAME_CENTERS)[number], Key> = { clean: 'centerClean', random: 'centerRandom' };
const EDGE_LABEL: Record<(typeof FRAME_EDGES)[number], Key> = { stretch: 'edgeStretch', repeat: 'edgeRepeat', mirror: 'edgeMirror', random: 'edgeRandom' };

/** Every element of the mockup that can be clicked, with the label shown while editing it. */
const TARGET_LABEL = {
  device: 'deviceCase', frame: 'frames', nav: 'navBar', primary: 'mainButtons', secondary: 'secondaryButtons', chips: 'filterButtons', chipAll: 'all', chipBody: 'body', chipMind: 'mind', chipSoul: 'soul',
  task: 'taskCard', habit: 'habitCard', done: 'doneCard', taskDialog: 'taskDialog', habitDialog: 'habitDialog', tick: 'tickBox',
  xp: 'experiencePoints', hunger: 'hunger', happiness: 'happiness',
  dashLevel: 'tmLevelCard', dashBody: 'tmBodyBox', dashMind: 'tmMindBox', dashSoul: 'tmSoulBox', dashPen: 'tmPen', dashHunger: 'tmHungerCard', dashHappiness: 'tmHappinessCard', dashMenu: 'tmMenuTiles', dashInventory: 'tmInventory', dashNudge: 'tmNudge', manageDialog: 'tmManageDialog', tip: 'tmTip', slot: 'tmSlot', plCard: 'tmPlCard', plBoard: 'tmPlBoard', plEvent: 'tmPlEvent',
} as const satisfies Record<string, Key>;
type Target = keyof typeof TARGET_LABEL;

const CAT_TARGET = { all: 'chipAll', body: 'chipBody', mind: 'chipMind', soul: 'chipSoul' } as const;
/** A category chip sample drawn in its own chip style. */
function CatSample({ cat, on, children }: { cat: 'all' | 'body' | 'mind' | 'soul'; on: boolean; children: ReactNode }) {
  return <ChipLook id={useCatChipStyle(cat)} on={on}>{children}</ChipLook>;
}

/** A clickable region of the mockup. Its content is a non-interactive sample, so a click always selects the region. */
function Hot({ id, sel, pick, label, className = '', children }: { id: Target; sel: Target | null; pick: (id: Target, el: HTMLElement) => void; label: string; className?: string; children: ReactNode }) {
  const go = (e: MouseEvent | KeyboardEvent) => { e.stopPropagation(); pick(id, e.currentTarget as HTMLElement); };
  return (
    <div role="button" tabIndex={0} aria-label={label} aria-pressed={sel === id} className={`hot ${sel === id ? 'sel' : ''} ${className}`} onClick={go}
      onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(e); } }}>
      {children}
    </div>
  );
}

interface Opt { id: string; label: string; node?: ReactNode }
/** One group of options inside the editor. */
function Choices({ label, opts, value, onPick, wide = false, compact = false, navs = false, disabledHint }: { label?: string; opts: Opt[]; value: string; onPick: (id: string) => void; wide?: boolean; compact?: boolean; navs?: boolean; disabledHint?: string }) {
  return (
    <div className="tm-group">
      {label && <div className="tm-label">{label}</div>}
      {disabledHint ? <div className="muted small">{disabledHint}</div> : (
        <div className={`themes ${wide ? 'wide' : ''} ${compact ? 'compact' : ''} ${navs ? 'navs' : ''}`} role="group" aria-label={label}>
          {opts.map(o => (
            <button key={o.id} type="button" className={`theme ${value === o.id ? 'on' : ''}`} aria-pressed={value === o.id} onClick={() => onPick(o.id)}>
              {o.node}
              <span className="small">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ThemeManager() {
  const t = useT();
  const s = useAppState(st => st.settings);
  const { elements, nav, buttons, bars, chips, chipsCat, chipEdges, device, crt, deviceFrame, buttonSize, frameEdges, frameCenter } = s;
  const [sel, setSel] = useState<Target | null>(null);
  const [presetName, setPresetName] = useState('');
  const current = JSON.stringify(appearanceOf(s));   // to mark which preset (if any) is on right now
  const sheet = useRef<HTMLDivElement>(null);
  const set = actions.setSettings;
  // keep the chosen element visible above the editor panel
  const pick = (id: Target, el: HTMLElement) => {
    setSel(id);
    requestAnimationFrame(() => el.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
  };

  useEffect(() => {
    if (!sel) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setSel(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sel]);
  useEffect(() => { sheet.current?.scrollTo({ top: 0 }); }, [sel]);

  const centreApplies = frameEdges === 'mirror' || frameEdges === 'random';
  const plateAttrs = usePlateAttrs(nav.plate);
  const navFrame = frameOr(nav.frame, 'wood_steel');
  const navLight = LIGHT_FRAMES.has(resolveFrame(navFrame, s.frameTheme, '', '').name);

  // ---- option lists ------------------------------------------------------------------------------------------------
  const FRAME_NAMES = Object.keys(FRAME_THEMES) as FrameTheme[];   // read now, so a frame added a moment ago is in the list
  const frameOpts = (withApp: boolean): Opt[] => [...(withApp ? ['app'] : []), ...FRAME_NAMES].map(id => ({
    id, label: id === 'app' ? t('sameAsFrame') : id.replace(/_/g, ' '),
    node: <PixelFrame theme={id as FrameTheme | 'app'} scale={1} className="theme-preview"><span /></PixelFrame>,
  }));
  const buttonOpts = (fallback: 'button_green' | 'button_red'): Opt[] => BUTTON_STYLES.map(id => ({ id, label: id.replace(/_/g, ' '), node: <ButtonLook look={id} fallback={fallback}>Aa</ButtonLook> }));
  const barOpts: Opt[] = BAR_IDS.map(id => ({ id, label: BAR_LABELS[id], node: <div aria-hidden><PixelProgressBar value={60} look={id} scale={1} /></div> }));
  /**
   * Edge and centre style of one element. An id carries them as `name[~hue]:edges:center`; "Default" leaves a part out, so the
   * element follows the global choice (Theme manager > Frames). `kind` 'chip' = chips tile their own sprite: no stretch / centre rows.
   */
  /** Corner size of one element: frames draw their border 4 / 8 / 16 / 32 wide, chips 1-4 units per sprite pixel. */
  const cornerScale = (value: string, setValue: (id: string) => void, kind: 'frame' | 'chip' = 'frame', disabledHint?: string) => {
    const p = splitFrame(value);
    const FRAME_LABEL: Record<number, Key> = { 8: 'cornerSmall', 16: 'cornerNormal', 32: 'cornerLarge', 64: 'cornerXLarge' };
    const sizes: readonly number[] = kind === 'chip' ? CHIP_SCALES : FRAME_SCALES;
    const sample = (scale: string | undefined) => kind === 'chip'
      ? <ChipLook id={buildFrame({ ...p, scale })} wide>Aa</ChipLook>
      : <PixelFrame theme={buildFrame({ ...p, scale })} scale={1} className="theme-preview"><span /></PixelFrame>;
    return (
      <Choices label={t('cornerSize')} wide value={p.scale ?? ''} disabledHint={disabledHint} onPick={c => setValue(buildFrame({ ...p, scale: c || undefined }))}
        opts={[{ id: '', label: t('defaultOpt'), node: sample(undefined) },
          ...sizes.map(n => ({ id: String(n), label: kind === 'chip' ? `${n}x` : t(FRAME_LABEL[n]), node: sample(String(n)) }))]} />
    );
  };
  const edgeCentre = (value: string, setValue: (id: string) => void, kind: 'frame' | 'chip' = 'frame', disabledHint?: string) => {
    const p = splitFrame(value);
    const edgeIds = kind === 'chip' ? CHIP_EDGES : FRAME_EDGES;
    const effective = p.edges ?? (kind === 'chip' ? chipEdges : frameEdges);
    const centreApplies = effective === 'mirror' || effective === 'random';
    const sample = (parts: typeof p, cls: string) => kind === 'chip'
      ? <ChipLook id={buildFrame(parts)} wide>Aa</ChipLook>
      : <div aria-hidden><PixelFrame theme={buildFrame(parts)} scale={1} className={cls}><span /></PixelFrame></div>;
    return (
      <>
        <Choices label={kind === 'chip' ? t('chipEdges') : t('frameEdges')} wide disabledHint={disabledHint} value={p.edges ?? ''} onPick={e => setValue(buildFrame({ ...p, edges: e || undefined }))}
          opts={[{ id: '', label: t('defaultOpt'), node: sample({ ...p, edges: undefined }, 'edge-preview') },
            ...edgeIds.map(id => ({ id, label: t(EDGE_LABEL[id as keyof typeof EDGE_LABEL]), node: sample({ ...p, edges: id }, 'edge-preview') }))]} />
        {kind === 'frame' && (
          <Choices label={t('frameCenter')} wide value={p.center ?? ''} onPick={c => setValue(buildFrame({ ...p, center: c || undefined }))} disabledHint={disabledHint ?? (centreApplies ? undefined : t('centerNeedsEdges'))}
            opts={[{ id: '', label: t('defaultOpt'), node: sample({ ...p, center: undefined }, 'center-preview') },
              ...FRAME_CENTERS.map(id => ({ id, label: t(CENTER_LABEL[id]), node: sample({ ...p, center: id }, 'center-preview') }))]} />
        )}
        {cornerScale(value, setValue, kind, disabledHint)}
      </>
    );
  };
  /** A frame choice plus its colour variants (hue-shifted copies of the same frame), edges and centre. `value`: `name[~hue][:edges[:center]]`. */
  const frameEditor = (label: string, value: string, setValue: (id: string) => void, names: Opt[], withEdges = true) => {
    const p = splitFrame(value);
    return (
      <>
        <Choices label={label} opts={names} value={p.name} onPick={id => setValue(buildFrame({ ...p, name: id, hue: id === 'app' ? 0 : p.hue }))} />
        <Choices label={t('colourVariant')} wide value={String(p.hue)} disabledHint={p.name === 'app' ? t('sameAsFrame') : undefined}
          onPick={h => setValue(buildFrame({ ...p, hue: Number(h) }))}
          opts={FRAME_HUES.map(h => ({ id: String(h), label: h ? `+${h}°` : t('hueOriginal'), node: <PixelFrame theme={buildFrame({ ...p, hue: h })} scale={1} className="theme-preview"><span /></PixelFrame> }))} />
        {withEdges && edgeCentre(value, setValue)}
      </>
    );
  };
  /** The same for any other style id (`name[~hue][:...]`): a base-style group that keeps the hue, plus a Colour variant row, and optionally edges / centre. */
  const styleEditor = (opts: { label?: string; value: string; setValue: (id: string) => void; base: Opt[]; preview: (id: string) => ReactNode; wide?: boolean; compact?: boolean; navs?: boolean; extra?: Opt[]; baseless?: string; edges?: 'frame' | 'chip' }) => {
    const p = splitFrame(opts.value);
    const locked = opts.baseless === p.name;   // e.g. "same as filter buttons": no colour of its own
    return (
      <>
        <Choices label={opts.label} opts={[...(opts.extra ?? []), ...opts.base]} value={p.name} wide={opts.wide} compact={opts.compact} navs={opts.navs}
          onPick={id => opts.setValue(id === opts.baseless ? id : buildFrame({ ...p, name: id }))} />
        <Choices label={t('colourVariant')} wide compact={opts.compact} navs={opts.navs} value={String(p.hue)} disabledHint={locked ? t('sameAsFrame') : undefined}
          onPick={h => opts.setValue(buildFrame({ ...p, hue: Number(h) }))}
          opts={FRAME_HUES.map(h => ({ id: String(h), label: h ? `+${h}°` : t('hueOriginal'), node: opts.preview(buildFrame({ ...p, hue: h })) }))} />
        {opts.edges && edgeCentre(opts.value, opts.setValue, opts.edges, locked ? t('sameAsFrame') : undefined)}
      </>
    );
  };
  const elementFrame = (key: keyof typeof elements, withApp = true) => frameEditor(t('frame'), elements[key], id => set({ elements: { ...elements, [key]: id } }), frameOpts(withApp));
  const barEditor = (slot: 'xp' | 'hunger' | 'happiness') => styleEditor({
    value: bars[slot], setValue: id => set({ bars: { ...bars, [slot]: id } }), base: barOpts, wide: true,
    preview: id => <div aria-hidden><PixelProgressBar value={60} look={id} scale={1} /></div>,
  });
  const sizeEditor = (
    <Choices compact label={t('buttonSize')} value={buttonSize} onPick={id => set({ buttonSize: id })}
      opts={BUTTON_SIZES.map(id => ({ id, label: t(SIZE_LABEL[id]), node: <ButtonLook look={buttons.primary} fallback="button_green" size={id}>Aa</ButtonLook> }))} />
  );

  /** Own chip style for one of the category chips (ALL / BODY / MIND / SOUL); "same" follows the general filter-button style. */
  const chipPair = (id: string) => <span className="chip-pair"><ChipLook id={id}>Aa</ChipLook><ChipLook id={id} on>Aa</ChipLook></span>;
  const chipCatEditor = (cat: 'all' | 'body' | 'mind' | 'soul') => styleEditor({
    value: chipsCat[cat], setValue: id => set({ chipsCat: { ...chipsCat, [cat]: id } }), baseless: 'same',
    extra: [{ id: 'same', label: t('sameAsChips'), node: chipPair(chips) }],
    base: CHIP_IDS.map(id => ({ id, label: id, node: chipPair(id) })), preview: chipPair, edges: 'chip',
  });

  const editors: Record<Target, ReactNode> = {
    device: (
      <>
        {frameEditor(t('caseFrame'), deviceFrame, id => set({ deviceFrame: id }), frameOpts(true))}
        <Choices label={t('crtEffect')} value={crt} onPick={id => set({ crt: id })}
          opts={CRT_LEVELS.map(id => ({ id, label: t(id === 'off' ? 'crtOff' : id === 'low' ? 'crtLow' : 'crtHigh') }))} />
        <Choices label={t('deviceCase')} value={String(device)} onPick={id => set({ device: id === 'true' })}
          opts={[{ id: 'true', label: t('deviceOn') }, { id: 'false', label: t('crtOff') }]} />
      </>
    ),
    frame: (
      <>
        {frameEditor(t('frame'), s.frameTheme, id => set({ frameTheme: id }), FRAME_NAMES.map(id => ({ id, label: id.replace(/_/g, ' '), node: <PixelFrame theme={id} scale={1} className="theme-preview"><span /></PixelFrame> })), false)}
        {cornerScale(s.frameTheme, id => set({ frameTheme: id }))}
        <Choices label={t('frameEdges')} wide value={frameEdges} onPick={id => set({ frameEdges: id })}
          opts={FRAME_EDGES.map(id => ({ id, label: t(EDGE_LABEL[id]), node: <div aria-hidden><PixelFrame theme="app" edges={id} scale={1} className="edge-preview"><span /></PixelFrame></div> }))} />
        <Choices label={t('frameCenter')} wide value={frameCenter} onPick={id => set({ frameCenter: id })} disabledHint={centreApplies ? undefined : t('centerNeedsEdges')}
          opts={FRAME_CENTERS.map(id => ({ id, label: t(CENTER_LABEL[id]), node: <div aria-hidden><PixelFrame theme={s.frameTheme} edges={frameEdges} center={id} scale={1} className="center-preview"><span /></PixelFrame></div> }))} />
      </>
    ),
    nav: (
      <>
        {frameEditor(t('frame'), nav.frame, id => set({ nav: { ...nav, frame: id } }), frameOpts(true))}
        <Choices navs label={t('navActive')} wide value={nav.active} onPick={id => set({ nav: { ...nav, active: id } })}
          opts={NAV_ACTIVE.map(id => ({ id, label: id, node: <NavLook active={id} plate={nav.plate} /> }))} />
        {nav.active === 'plate' && styleEditor({
          label: t('navPlate'), value: nav.plate, setValue: id => set({ nav: { ...nav, plate: id } }), wide: true, navs: true,
          base: PLATE_IDS.map(id => ({ id, label: id, node: <NavLook active="plate" plate={id} /> })), preview: id => <NavLook active="plate" plate={id} />,
        })}
        <div className="tm-group">
          <div className="tm-label">{t('navItems')}</div>
          <div className="nav-items">
            {NAV_DEFS.map(d => (
              <PixelCheckbox key={d.id} checked={nav.items.includes(d.id)} disabled={d.id === 'home'}
                onChange={on => set({ nav: { ...nav, items: sanitizeNavItems(on ? [...nav.items, d.id] : nav.items.filter(x => x !== d.id)) } })}
                label={d.id === 'home' ? `${t(d.label)} - ${t('navHomeLocked')}` : t(d.label)} />
            ))}
          </div>
        </div>
        <Choices label={t('navLabels')} value={nav.labels} onPick={id => set({ nav: { ...nav, labels: id } })}
          opts={NAV_LABELS.map(id => ({ id, label: t(id === 'both' ? 'navIconsText' : 'navIconsOnly') }))} />
      </>
    ),
    primary: (
      <>
        {styleEditor({ label: t('mainButtons'), value: buttons.primary, setValue: id => set({ buttons: { ...buttons, primary: id } }), compact: true,
          base: buttonOpts('button_green'), preview: id => <ButtonLook look={id} fallback="button_green">Aa</ButtonLook>, edges: 'frame' })}
        {sizeEditor}
      </>
    ),
    secondary: (
      <>
        {styleEditor({ label: t('secondaryButtons'), value: buttons.secondary, setValue: id => set({ buttons: { ...buttons, secondary: id } }), compact: true,
          base: buttonOpts('button_red'), preview: id => <ButtonLook look={id} fallback="button_red">Aa</ButtonLook>, edges: 'frame' })}
        {sizeEditor}
      </>
    ),
    chips: (
      <>
        {styleEditor({ label: t('filterButtons'), value: chips, setValue: id => set({ chips: id }), base: CHIP_IDS.map(id => ({ id, label: id, node: chipPair(id) })), preview: chipPair })}
        {cornerScale(chips, id => set({ chips: id }), 'chip')}
        <Choices label={t('chipEdges')} value={chipEdges} onPick={id => set({ chipEdges: id })} wide
          opts={CHIP_EDGES.map(id => ({ id, label: t(EDGE_LABEL[id]), node: <ChipLook id={chips} edges={id} wide>Aa</ChipLook> }))} />
      </>
    ),
    chipAll: chipCatEditor('all'), chipBody: chipCatEditor('body'), chipMind: chipCatEditor('mind'), chipSoul: chipCatEditor('soul'),
    task: elementFrame('task'),
    habit: elementFrame('habit'),
    done: elementFrame('done'),
    taskDialog: elementFrame('taskDialog'),
    habitDialog: elementFrame('habitDialog'),
    dashLevel: elementFrame('dashLevel'), dashBody: elementFrame('dashBody'), dashMind: elementFrame('dashMind'), dashSoul: elementFrame('dashSoul'),
    dashPen: elementFrame('dashPen'), dashHunger: elementFrame('dashHunger'), dashHappiness: elementFrame('dashHappiness'),
    dashMenu: elementFrame('dashMenu'), dashInventory: elementFrame('dashInventory'), dashNudge: elementFrame('dashNudge'),
    manageDialog: elementFrame('manageDialog'), tip: elementFrame('tip'),
    plCard: elementFrame('plCard'), plBoard: elementFrame('plBoard'), plEvent: elementFrame('plEvent', false),
    slot: frameEditor(t('frame'), elements.slot, id => set({ elements: { ...elements, slot: id } }), [
      { id: 'classic', label: t('slotClassic'), node: <span className="slot"><img className="pixel" src="/assets/raw/coin.png" width="32" height="32" alt="" /></span> },
      ...frameOpts(false),
    ], false),
    tick: styleEditor({ value: elements.tick, setValue: id => set({ elements: { ...elements, tick: id } }), base: TICK_IDS.map(id => ({ id, label: id, node: <TickLook id={id} /> })), preview: id => <TickLook id={id} /> }),
    xp: barEditor('xp'),
    hunger: barEditor('hunger'),
    happiness: barEditor('happiness'),
  };

  // ---- the mockup (non-interactive samples of the real components) -------------------------------------------------
  const hot = (id: Target, className = '') => ({ id, sel, pick, label: t(TARGET_LABEL[id]), className });
  const tick = (checked: boolean) => (
    <Hot {...hot('tick', 'hot-tick')}>
      <TickSample id={elements.tick} checked={checked} />
    </Hot>
  );
  const bar = (slot: 'xp' | 'hunger' | 'happiness', value: number) => (
    <Hot {...hot(slot)}>
      <div className="meter"><span>{t(TARGET_LABEL[slot])}</span><PixelProgressBar value={value} look={bars[slot]} scale={1} /></div>
    </Hot>
  );
  const dialog = (id: 'taskDialog' | 'habitDialog' | 'manageDialog', title: Key) => (
    <Hot {...hot(id)}>
      <PixelFrame theme={frameOr(elements[id], 'wood_gold_gem')} scale={1} className="tm-dialog">
        <div className="small">{t(title)}</div>
        <div className="tm-field" />
        <div className="row wrap">
          <Hot {...hot('secondary')}><ButtonLook look={buttons.secondary} fallback="button_red">{t('cancel')}</ButtonLook></Hot>
          <Hot {...hot('primary')}><ButtonLook look={buttons.primary} fallback="button_green">OK</ButtonLook></Hot>
        </div>
      </PixelFrame>
    </Hot>
  );

  return (
    <div className="screen tm" data-open={sel ? '' : undefined}>
      <div className="row between">
        <PixelButton scale={1} variant="red" onClick={() => back('/settings')}>{t('back')}</PixelButton>
        <PixelButton scale={1} variant="red" onClick={() => { set(DEFAULT_APPEARANCE); setSel(null); }}>{t('resetAppearance')}</PixelButton>
      </div>
      <h1 className="title">{t('themeManager')}</h1>
      <p className="muted small" style={{ lineHeight: 1.7 }} role="status">{t('themeManagerHint')}</p>

      <PixelFrame theme="app" scale={1} className="tm-presets card">
        <div className="tm-label">{t('presets')}</div>
        <div className="row wrap">
          {[...BUILTIN_PRESETS, ...s.presets].map((p: Preset) => {
            const mine = s.presets.some(x => x.id === p.id), on = JSON.stringify(p.look) === current;
            return (
              <span key={p.id} className="preset">
                <PixelButton scale={1} variant={on ? 'green' : 'red'} aria-pressed={on} onClick={() => { set(p.look); setSel(null); }}>{p.name}</PixelButton>
                {mine && <button type="button" className="preset-x" aria-label={`${t('presetDelete')}: ${p.name}`} onClick={() => set({ presets: s.presets.filter(x => x.id !== p.id) })}>x</button>}
              </span>
            );
          })}
        </div>
        <form className="row wrap" onSubmit={e => {
          e.preventDefault();
          const name = presetName.trim();
          if (!name || s.presets.length >= MAX_PRESETS) return;
          set({ presets: [...s.presets, { id: newId(), name: name.slice(0, 24), look: appearanceOf(s) }] }); setPresetName('');
        }}>
          <input value={presetName} maxLength={24} onChange={e => setPresetName(e.target.value)} placeholder={t('presetNamePh')} aria-label={t('presetNamePh')} style={{ flex: '1 1 120px', width: 'auto' }} />
          <PixelButton type="submit" scale={1} disabled={!presetName.trim() || s.presets.length >= MAX_PRESETS}>{t('presetSave')}</PixelButton>
        </form>
      </PixelFrame>

      <Hot {...hot('device', 'hot-case')}>
      <PixelFrame theme={frameOr(deviceFrame, 'grey_gun')} scale={1} className="tm-case">
      <div className="mock" onClick={() => setSel(null)}>
        <div className="row between">
          <h2 className="subtitle">{t('chatTasks')}</h2>
          <Hot {...hot('primary')}><ButtonLook look={buttons.primary} fallback="button_green">{t('newButton')}</ButtonLook></Hot>
        </div>

        <Hot {...hot('chips')}>
          <div className="row wrap">
            {(['all', 'body', 'mind', 'soul'] as const).map((k, i) => (
              <Hot key={k} {...hot(CAT_TARGET[k])}><CatSample cat={k} on={i === 0}>{t(k).toUpperCase()}</CatSample></Hot>
            ))}
          </div>
          {/* the language buttons in Settings and onboarding are filter buttons too, so they change with this style */}
          <div className="langs" style={{ marginTop: 'calc(8 * var(--u))' }}>
            {LANGS.map((l, i) => <ChipLook key={l} id={chips} on={i === 0}>{LANG_NAMES[l]}</ChipLook>)}
          </div>
        </Hot>

        <Hot {...hot('frame')}>
          <PixelFrame theme="app" scale={1} className="card"><div className="small">{t('frames')}</div></PixelFrame>
        </Hot>

        <h2 className="subtitle">{t('tmDashboard')}</h2>
        <Hot {...hot('dashLevel')}>
          <PixelFrame theme={frameOr(elements.dashLevel, 'app')} scale={1} className="card">
            <div className="row between"><span>{t('level').toUpperCase()} 3</span><span className="muted small">{t('xpToGo', { n: 120 })}</span></div>
            {bar('xp', 70)}
          </PixelFrame>
        </Hot>
        <div className="stats3">
          {(['Body', 'Mind', 'Soul'] as const).map(k => {
            const stat = k.toLowerCase() as 'body' | 'mind' | 'soul', id = `dash${k}` as 'dashBody' | 'dashMind' | 'dashSoul';
            return <Hot key={id} {...hot(id)}><StatBox stat={stat} value={12} frame={elements[id]} /></Hot>;
          })}
        </div>
        <Hot {...hot('dashPen')}>
          <PixelFrame theme={frameOr(elements.dashPen, 'app')} scale={1} className="card tm-pen"><Icon name="bobr_young" size={96} /></PixelFrame>
        </Hot>
        <div className="needs">
          <Hot {...hot('dashHunger')}><PixelFrame theme={frameOr(elements.dashHunger, 'app')} scale={1} className="card">{bar('hunger', 45)}</PixelFrame></Hot>
          <Hot {...hot('dashHappiness')}><PixelFrame theme={frameOr(elements.dashHappiness, 'app')} scale={1} className="card">{bar('happiness', 85)}</PixelFrame></Hot>
        </div>
        <Hot {...hot('dashMenu')}>
          <div className="menu-grid">
            {([['task', 'chatTasks'], ['habit', 'chatHabits'], ['target', 'startHere'], ['rearrange', 'settings']] as const).map(([icon, label]) => (
              <PixelFrame key={icon} theme={frameOr(elements.dashMenu, 'app')} scale={1} className="menu-tile"><Icon name={icon} size={32} /><span>{t(label)}</span></PixelFrame>
            ))}
          </div>
        </Hot>
        <Hot {...hot('dashInventory')}>
          <PixelFrame theme={frameOr(elements.dashInventory, 'app')} scale={1} className="card">
            <div className="row">{(['bcoin', 'stone', 'hay', 'stick'] as const).map((i, k) => <Hot key={i} {...hot('slot')}><Slot id={i} n={k + 1} /></Hot>)}</div>
          </PixelFrame>
        </Hot>

        <Hot {...hot('plBoard')}>
          <PixelFrame theme={frameOr(elements.plBoard, 'app')} scale={1} className="card">
            <div className="small">{t('planner')}</div>
            <Hot {...hot('plEvent')}>
              <PixelFrame theme={frameOr(elements.plEvent, 'blue')} scale={1} className="task event compact"><div className="task-head"><span className="task-title">{t('plShortlist')}</span></div></PixelFrame>
            </Hot>
          </PixelFrame>
        </Hot>

        <Hot {...hot('plCard')}>
          <PixelFrame theme={frameOr(elements.plCard, 'app')} scale={1} className="card"><div className="small">{t('plShortlist')}</div></PixelFrame>
        </Hot>

        <Hot {...hot('dashNudge')}>
          <PixelFrame theme={frameOr(elements.dashNudge, 'app')} scale={1} className="card nudge">{t('nudgeSoon', { title: t('task'), n: 15 })}</PixelFrame>
        </Hot>

        <Hot {...hot('tip')}>
          <span className="tip tip-static"><PixelFrame as="span" theme={backdropFrame(elements.tip)} scale={1} className="tip-bg" aria-hidden /><span className="tip-text">{t('holdBodyTip')}</span></span>
        </Hot>

        <Hot {...hot('task')}>
          <PixelFrame theme={frameOr(elements.task, 'app')} scale={1} className="task">
            <div className="task-head">{tick(false)}<span className="task-title">{t('task')}</span><span className="xp"><Icon name="xp" size={16} />25</span></div>
            <div className="row wrap chips"><Icon name="body_active" size={16} /><Chip>{t('priorityHigh')}</Chip><Chip color="var(--bg-3)">D2</Chip></div>
          </PixelFrame>
        </Hot>

        <Hot {...hot('habit')}>
          <PixelFrame theme={frameOr(elements.habit, 'app')} scale={1} className="task">
            <div className="task-head">{tick(false)}<span className="task-title">{t('habit')}</span><span className="xp">x3</span></div>
            <div className="row wrap chips"><Icon name="mind_active" size={16} /><Chip>{t('daily').toUpperCase()}</Chip><Chip color="var(--success)">{t('streak').toUpperCase()} 3</Chip></div>
          </PixelFrame>
        </Hot>

        <Hot {...hot('done')}>
          <PixelFrame theme={frameOr(elements.done, 'grey_stone_chiseld')} scale={1} className="task done">
            <div className="task-head">{tick(true)}<span className="task-title">{t('task')}</span><span className="xp"><Icon name="xp" size={16} />10</span></div>
          </PixelFrame>
        </Hot>

        <div className="tm-dialogs">
          {dialog('taskDialog', 'taskDialog')}
          {dialog('habitDialog', 'habitDialog')}
          {dialog('manageDialog', 'tmManageDialog')}
        </div>

        <Hot {...hot('nav', 'hot-nav')}>
          <PixelFrame theme={navFrame} scale={1} className={`nav-frame ${navLight ? 'nav-light' : ''}`} data-active={nav.active} data-labels={nav.labels} {...plateAttrs}>
            {NAV_DEFS.filter(d => nav.items.includes(d.id)).map(d => (
              <span key={d.id} className={`nav-btn ${isActivePath('/tasks', d.path) ? 'active' : ''}`}>
                <Icon name={d.icon} size={d.size} />
                {nav.labels === 'both' && <span className="nav-label">{t(d.label)}</span>}
              </span>
            ))}
          </PixelFrame>
        </Hot>
      </div>
      </PixelFrame>
      </Hot>

      {sel && (
        <div className="tm-sheet-wrap">
          <PixelFrame theme="app" scale={1} className="tm-sheet" ref={sheet} role="region" aria-label={t('themeEditing', { name: t(TARGET_LABEL[sel]) })}>
            <div className="row between">
              <h2 className="subtitle">{t('themeEditing', { name: t(TARGET_LABEL[sel]) })}</h2>
              <PixelButton scale={1} variant="red" aria-label={t('cancel')} onClick={() => setSel(null)}>X</PixelButton>
            </div>
            {editors[sel]}
          </PixelFrame>
        </div>
      )}
    </div>
  );
}
