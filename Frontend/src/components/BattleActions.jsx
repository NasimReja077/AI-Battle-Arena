import { useState } from 'react';
import { LuShare2, LuDownload, LuCopy, LuCheck, LuLink2Off } from 'react-icons/lu';
import { exportUrl, shareBattle, unshareBattle } from '../api';

const buttonClass =
  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.02] text-xs font-mono text-neutral-300 hover:text-white hover:bg-white/[0.05] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

const linkFor = (shareId) => `${window.location.origin}${window.location.pathname}#/s/${shareId}`;

// Share link and Markdown export for a saved battle
function BattleActions({ id, saved, historyOn, initialShareId = null }) {
  const [shareId, setShareId] = useState(initialShareId);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  if (!saved || !id) {
    return (
      <p className="text-[11px] font-mono text-neutral-600">
        {historyOn
          ? 'This battle was not saved, so it cannot be shared or exported.'
          : 'History is off (no database connected), so this battle cannot be shared or exported.'}
      </p>
    );
  }

  const share = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await shareBattle(id);
      setShareId(data.shareId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create a share link.');
    } finally {
      setBusy(false);
    }
  };

  const stopSharing = async () => {
    setBusy(true);
    setError('');
    try {
      await unshareBattle(id);
      setShareId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not turn off sharing.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(linkFor(shareId));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked (for example on plain http). The link stays visible to copy by hand.
      setError('Copy failed. Select the link and copy it by hand.');
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {!shareId && (
          <button type="button" onClick={share} disabled={busy} className={buttonClass}>
            <LuShare2 className="w-3.5 h-3.5" /> Share
          </button>
        )}
        <a href={exportUrl(id)} download className={buttonClass}>
          <LuDownload className="w-3.5 h-3.5" /> Export Markdown
        </a>
      </div>

      {shareId && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            readOnly
            value={linkFor(shareId)}
            onFocus={(e) => e.target.select()}
            aria-label="Share link"
            className="flex-1 min-w-60 bg-neutral-950/80 border border-white/10 rounded-lg px-3 py-1.5 text-xs font-mono text-neutral-300 outline-none focus:border-violet-500/50"
          />
          <button type="button" onClick={copy} className={buttonClass}>
            {copied ? <LuCheck className="w-3.5 h-3.5 text-emerald-400" /> : <LuCopy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" onClick={stopSharing} disabled={busy} className={buttonClass}>
            <LuLink2Off className="w-3.5 h-3.5" /> Stop sharing
          </button>
        </div>
      )}
      {shareId && (
        <p className="text-[11px] font-mono text-neutral-600">
          Anyone with this link can read the question, both answers and the verdict. Attached file contents are not included.
        </p>
      )}
      {error && <p role="alert" className="text-[11px] font-mono text-red-400">{error}</p>}
    </div>
  );
}

export default BattleActions;
