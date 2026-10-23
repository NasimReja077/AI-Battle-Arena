import { useEffect } from 'react';
import { LuX, LuTrash2, LuLink } from 'react-icons/lu';
import { fmtDate } from '../lib/format';

const winnerText = (item) =>
  item.winner === 'none' ? 'No winner' : item.winner === 'tie' ? 'Tie' : `Won: ${item.labels[item.winner]}`;

// Slide-over list of saved battles
function HistoryDrawer({ open, onClose, items, loading, error, hasMore, onOpen, onDelete, onMore }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close history" onClick={onClose} className="absolute inset-0 bg-black/60 cursor-default" />
      <aside role="dialog" aria-label="Battle history" className="relative w-full max-w-sm h-full bg-[#0a0a0a] border-l border-white/10 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <h2 className="text-sm font-bold tracking-wide text-white">HISTORY</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 cursor-pointer" aria-label="Close history">
            <LuX className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          {error && <p role="alert" className="text-xs font-mono text-red-400 p-2">{error}</p>}
          {!error && !loading && items.length === 0 && (
            <p className="text-xs font-mono text-neutral-500 p-2">No saved battles yet. Run one and it shows up here.</p>
          )}

          {items.map((item) => (
            <div key={item.id} className="group relative rounded-lg border border-white/5 bg-white/[0.01] hover:border-violet-500/30 transition-all">
              <button type="button" onClick={() => onOpen(item.id)} className="w-full text-left p-3 pr-10 cursor-pointer">
                <span className="text-xs text-neutral-200 line-clamp-2 block mb-1.5">{item.problem}</span>
                <span className="block text-[10px] font-mono text-neutral-500">
                  {item.labels.solution_1} vs {item.labels.solution_2}
                </span>
                <span className="flex flex-wrap items-center gap-x-2 text-[10px] font-mono text-neutral-600 mt-0.5">
                  <span className="text-emerald-500/80">{winnerText(item)}</span>
                  <span>{item.rounds} round{item.rounds === 2 ? 's' : ''}</span>
                  <span>{fmtDate(item.createdAt)}</span>
                  {item.shared && <span className="flex items-center gap-0.5 text-violet-400"><LuLink className="w-2.5 h-2.5" />shared</span>}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(item)}
                className="absolute top-2 right-2 p-1.5 rounded-md text-neutral-600 hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
                aria-label={`Delete battle: ${item.problem.slice(0, 40)}`}
                title="Delete"
              >
                <LuTrash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {loading && <p className="text-xs font-mono text-neutral-500 p-2">Loading…</p>}
          {hasMore && !loading && (
            <button type="button" onClick={onMore} className="text-xs font-mono text-violet-400 hover:text-violet-300 p-2 cursor-pointer">
              Load more
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

export default HistoryDrawer;
