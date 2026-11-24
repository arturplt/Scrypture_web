import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { STARTER_TASKS, chatGreeting, chatOptions, chatReply, eventReward, initialFlow, starterTaskInput, type ChatContext, type ChatFlow } from '../domain';
import { actions, store, useAppState } from '../data/hooks';
import type { ChatMessage } from '../data/state';
import { back, navigate } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { Sparkles, fxVars, prefersReducedMotion, type FxKind } from '../ui/CompleteFx';
import { useT } from '../i18n/useT';

/** After this long away, opening the chat starts with a fresh greeting under the old messages (they are kept, up to CHAT_KEEP). */
const GREET_AGAIN_MS = 30 * 60_000;
/** Bóbr "types" for a moment before each reply: longer replies take a little longer, never more than about a second and a half. */
const typingMs = (text: string) => 450 + Math.min(1000, text.length * 6);
let seq = 0;
const msg = (fromBobr: boolean, text: string): ChatMessage => ({ id: `${Date.now().toString(36)}-${(seq++).toString(36)}`, type: 'NORMAL', fromBobr, text, at: Date.now() });

/** The conversation with Bóbr. Unlike Android it is kept between visits (the newest messages, on this device only). */
export function Chat() {
  const t = useT();
  const stats = useAppState(s => s.stats);
  const tasks = useAppState(s => s.tasks);
  const habits = useAppState(s => s.habits);
  const achievements = useAppState(s => s.achievements);
  const userName = useAppState(s => s.user.name);
  const planner = useAppState(s => s.planner);
  const bobr = useAppState(s => s.bobr);
  const inventory = useAppState(s => s.inventory);
  const calm = useAppState(s => !!s.settings.reduceMotion) || prefersReducedMotion();

  // Bóbr knows the plan: the same activities and shortlist the Planner shows
  const ctx: ChatContext = { stats, tasks, habits, achievements, userName, now: Date.now(), t, events: planner.events, shortlist: planner.shortlist, bobr, inventory };
  const [msgs, setMsgs] = useState<ChatMessage[]>(() => {
    const saved = store.getState().chat;   // read once as the chat opens: the screen owns the conversation from then on
    const last = saved[saved.length - 1];
    return !last || Date.now() - last.at > GREET_AGAIN_MS ? [...saved, msg(true, chatGreeting(ctx))] : saved;
  });
  const [flow, setFlow] = useState<ChatFlow>(initialFlow());
  /** Bóbr's reply while he is still "typing" it (shown as dots); it joins the list when the pause is over. */
  const [typing, setTyping] = useState<ChatMessage | null>(null);
  /** The reply that just ticked something off: it bursts with stars like a ticked card. */
  const [fx, setFx] = useState<{ id: string; kind: FxKind; stars: number } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const pending = useRef<{ reply: ChatMessage; timer: ReturnType<typeof setTimeout> } | null>(null);
  const latest = useRef(msgs);
  latest.current = msgs;

  // keep the conversation for next time
  useEffect(() => { actions.setChat(msgs); }, [msgs]);
  // leaving while Bóbr types: his reply is still saved
  useEffect(() => () => { const p = pending.current; if (p) { clearTimeout(p.timer); actions.setChat([...latest.current, p.reply]); } }, []);
  useEffect(() => { if (!fx) return; const id = setTimeout(() => setFx(null), 1600); return () => clearTimeout(id); }, [fx]);

  const options = chatOptions(ctx, flow);
  // Read the newest reply from its first line; the choices follow below it.
  useEffect(() => {
    const said = list.current?.querySelectorAll('.msg.bobr');
    said?.[said.length - 1]?.scrollIntoView?.({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
  }, [msgs, typing, calm]);

  /** Stars for what a reply just ticked off: one per point of XP, like the task, habit and planner cards (habits a fixed handful, their pay depends on the streak). */
  function burstFor(r: ReturnType<typeof chatReply>): { kind: FxKind; stars: number } | null {
    if (r.completeTaskId) { const task = tasks.find(x => x.id === r.completeTaskId); return { kind: 'task', stars: Math.min(30, task?.experienceReward ?? 10) }; }
    if (r.completeHabitId) return { kind: 'habit', stars: 12 };
    if (r.doneEventId) { const e = planner.events.find(x => x.id === r.doneEventId); return { kind: 'event', stars: e ? eventReward(e).xp : 8 }; }
    return null;
  }

  function choose(id: string, text: string) {
    if (typing) return;
    if (id === 'close_chat') { back('/'); return; }
    const r = chatReply(id, ctx, flow);
    if (r.completeTaskId) actions.completeTask(r.completeTaskId);
    if (r.completeHabitId) actions.completeHabit(r.completeHabitId);
    if (r.doneEventId) actions.setEventDone(r.doneEventId, true);
    if (r.feed === 'berry') actions.feedBerry(); else if (r.feed === 'hay') actions.feedBobr();
    const idea = r.addStarterId && STARTER_TASKS.find(s => s.id === r.addStarterId);
    if (idea) actions.addTask(starterTaskInput(idea, t));
    setFlow(r.flow);
    if (r.go) navigate(r.go);
    const reply = msg(true, r.reply), burst = burstFor(r);
    const land = () => { pending.current = null; setTyping(null); setMsgs(m => [...m, reply]); if (burst && !calm) setFx({ id: reply.id, ...burst }); };
    setMsgs(m => [...m, msg(false, text)]);
    if (calm || r.go) { land(); return; }   // (leaving the chat: no pause, the reply is saved at once)
    setTyping(reply);
    pending.current = { reply, timer: setTimeout(land, typingMs(r.reply)) };
  }
  function clear() {
    if (pending.current) { clearTimeout(pending.current.timer); pending.current = null; }
    setTyping(null); setFx(null); setFlow(initialFlow()); setMsgs([msg(true, chatGreeting(ctx))]);
  }

  return (
    <div className="screen chat narrow">
      <div className="row between">
        <PixelButton scale={1} variant="red" onClick={() => navigate('/')}>{t('back')}</PixelButton>
        <div className="row">
          <PixelButton scale={1} onClick={() => navigate('/plan')}>{t('planner')}</PixelButton>
          <PixelButton scale={1} variant="red" onClick={clear}>{t('chatClear')}</PixelButton>
        </div>
      </div>
      <h1 className="title">Bóbr</h1>
      <div className="msgs" aria-live="polite" ref={list}>
        {msgs.map(m => {
          const burst = fx?.id === m.id ? fx : null;
          return (
            <PixelFrame key={m.id} theme={m.fromBobr ? 'app' : 'blue'} scale={1} className={`msg ${m.fromBobr ? 'bobr' : 'me'} ${burst ? 'fx-glow' : ''}`} style={burst ? (fxVars(burst.kind, burst.stars) as CSSProperties) : undefined}>
              {burst && <span className="fx-anchor msg-fx" aria-hidden><Sparkles count={burst.stars} /></span>}
              {m.text}
            </PixelFrame>
          );
        })}
        {typing && <PixelFrame theme="app" scale={1} className="msg bobr typing" role="status" aria-label={t('chatTyping')}><i /><i /><i /></PixelFrame>}
      </div>
      <div className="options" role="group" aria-label={t('chooseReply')} aria-busy={!!typing}>
        {options.map(o => (
          <PixelButton key={o.id} scale={1} disabled={!!typing} variant={o.id === 'close_chat' || o.id.startsWith('cancel') || o.id.endsWith('back') ? 'red' : 'green'} onClick={() => choose(o.id, o.text)}>{o.text}</PixelButton>
        ))}
      </div>
    </div>
  );
}

