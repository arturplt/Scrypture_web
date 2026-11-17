import { useEffect } from 'react';
import { actions, useAppState, useUndo } from '../data/hooks';
import { UNDO_WINDOW_MS } from '../domain';
import { useT } from '../i18n/useT';

/** For 10 seconds after completing a task or a habit: a bar with an Undo button (taking it back) and a draining timer. */
export function UndoBar() {
  const undo = useUndo();
  const t = useT();
  const taskId = undo && 'taskId' in undo ? undo.taskId : null, habitId = undo && 'habitId' in undo ? undo.habitId : null;
  const title = useAppState(s => (taskId ? s.tasks.find(x => x.id === taskId)?.title : s.habits.find(x => x.id === habitId)?.title));

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(actions.dismissUndo, Math.max(0, undo.until - Date.now()));
    return () => clearTimeout(timer);
  }, [undo]);

  if (!undo) return null;
  return (
    <div className="undo-bar" role="status" key={undo.until}>
      <div className="undo-row">
        <span className="undo-text"><b>{t(habitId ? 'habitCompleted' : 'chatTaskCompleted')}</b>{title ? <span className="muted"> {title}</span> : null}</span>
        <button type="button" className="seg on" onClick={() => (habitId ? actions.undoHabit(habitId) : actions.uncompleteTask(taskId!))}>{t('undo')}</button>
      </div>
      <i className="undo-drain" style={{ animationDuration: `${UNDO_WINDOW_MS}ms` }} />
    </div>
  );
}
