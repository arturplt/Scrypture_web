import { useEffect, useRef, useState } from 'react';
import { STARTER_TASKS, chatGreeting, chatOptions, chatReply, initialFlow, starterTaskInput, type ChatContext, type ChatFlow } from '../domain';
import { actions, useAppState } from '../data/hooks';
import { back, navigate } from '../router';
import { PixelFrame } from '../ui/PixelFrame';
import { PixelButton } from '../ui/PixelButton';
import { useT } from '../i18n/useT';

interface Msg { id: number; fromBobr: boolean; text: string }

/** Like Android, the conversation lives only while the chat is open. */
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

  // Bóbr knows the plan: the same activities and shortlist the Planner shows
  const ctx: ChatContext = { stats, tasks, habits, achievements, userName, now: Date.now(), t, events: planner.events, shortlist: planner.shortlist, bobr, inventory };
  const [msgs, setMsgs] = useState<Msg[]>(() => [{ id: 0, fromBobr: true, text: chatGreeting(ctx) }]);
  const [flow, setFlow] = useState<ChatFlow>(initialFlow());
  const next = useRef(1);
  const list = useRef<HTMLDivElement>(null);

  const options = chatOptions(ctx, flow);
  // Read the newest reply from its first line; the choices follow below it.
  useEffect(() => {
    const bobr = list.current?.querySelectorAll('.msg.bobr');
    bobr?.[bobr.length - 1]?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [msgs]);

  function choose(id: string, text: string) {
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
    setMsgs(m => [...m, { id: next.current++, fromBobr: false, text }, { id: next.current++, fromBobr: true, text: r.reply }]);
  }
  function clear() { setFlow(initialFlow()); setMsgs([{ id: next.current++, fromBobr: true, text: chatGreeting(ctx) }]); }

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
        {msgs.map(m => (
          <PixelFrame key={m.id} theme={m.fromBobr ? 'app' : 'blue'} scale={1} className={`msg ${m.fromBobr ? 'bobr' : 'me'}`}>{m.text}</PixelFrame>
        ))}
      </div>
      <div className="options" role="group" aria-label={t('chooseReply')}>
        {options.map(o => (
          <PixelButton key={o.id} scale={1} variant={o.id === 'close_chat' || o.id.startsWith('cancel') || o.id.endsWith('back') ? 'red' : 'green'} onClick={() => choose(o.id, o.text)}>{o.text}</PixelButton>
        ))}
      </div>
    </div>
  );
}
