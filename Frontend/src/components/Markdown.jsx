// Small Markdown renderer: code blocks, **bold**, *italic* and `inline code`.
// Everything is rendered as React text nodes, so model output can never inject HTML.
function Markdown({ text }) {
  if (!text) return null;

  const parts = text.split(/(```[\s\S]*?```)/g);

  return parts.map((part, index) => {
    if (part.startsWith('```')) {
      const match = part.match(/```([a-zA-Z0-9-]*)\n?([\s\S]*?)```/);
      const code = match ? match[2] : part.slice(3, -3);
      const lang = match ? match[1] : '';

      return (
        <div key={index} className="my-3 rounded-lg border border-white/5 bg-neutral-950/60 overflow-hidden font-mono text-[13px]">
          {lang && (
            <div className="bg-neutral-900/60 px-4 py-1.5 border-b border-white/5 text-xs text-neutral-400 flex justify-between items-center select-none">
              <span>{lang}</span>
              <span className="text-[10px] text-neutral-500 uppercase tracking-widest">Code</span>
            </div>
          )}
          <pre className="p-4 overflow-x-auto text-left text-neutral-300">
            <code>{code}</code>
          </pre>
        </div>
      );
    }

    const inlineParts = part.split(/(\*\*.*?\*\*|`.*?`|\*.*?\*)/g);

    return (
      <span key={index} className="whitespace-pre-line leading-relaxed">
        {inlineParts.map((sub, i) => {
          if (sub.length > 3 && sub.startsWith('**') && sub.endsWith('**')) {
            return <strong key={i} className="text-white font-semibold">{sub.slice(2, -2)}</strong>;
          }
          if (sub.length > 2 && sub.startsWith('*') && sub.endsWith('*')) {
            return <em key={i} className="text-neutral-200 italic">{sub.slice(1, -1)}</em>;
          }
          if (sub.length > 2 && sub.startsWith('`') && sub.endsWith('`')) {
            return (
              <code key={i} className="bg-neutral-950/60 px-1.5 py-0.5 rounded text-violet-400 font-mono text-xs border border-white/5">
                {sub.slice(1, -1)}
              </code>
            );
          }
          return sub;
        })}
      </span>
    );
  });
}

export default Markdown;
