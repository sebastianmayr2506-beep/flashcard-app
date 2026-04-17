// Renders Markdown from pasted Notion/ChatGPT text:
// ## H2, ### H3, **bold**, *italic*, - bullet lists, newlines

export default function MarkdownText({ text, className = '' }: { text: string; className?: string }) {
  const lines = text.split('\n');

  return (
    <span className={`${className} block`}>
      {lines.map((line, li) => {
        const trimmed = line.trimStart();

        // H1
        if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
          return (
            <span key={li} className="block text-2xl font-bold text-white mt-3 mb-1">
              {parseInline(trimmed.slice(2))}
            </span>
          );
        }
        // H2
        if (trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
          return (
            <span key={li} className="block text-lg font-bold text-white mt-3 mb-1">
              {parseInline(trimmed.slice(3))}
            </span>
          );
        }
        // H3
        if (trimmed.startsWith('### ')) {
          return (
            <span key={li} className="block text-base font-semibold text-indigo-300 mt-2 mb-0.5">
              {parseInline(trimmed.slice(4))}
            </span>
          );
        }
        // Bullet list (- item or * item)
        if (trimmed.match(/^[-*] /)) {
          return (
            <span key={li} className="block pl-4 relative mt-0.5">
              <span className="absolute left-1 top-0 text-indigo-400">•</span>
              {parseInline(trimmed.slice(2))}
            </span>
          );
        }
        // Empty line → spacer
        if (trimmed === '') {
          return <span key={li} className="block h-2" />;
        }
        // Normal paragraph line
        return (
          <span key={li} className="block">
            {parseInline(trimmed)}
          </span>
        );
      })}
    </span>
  );
}

function parseInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let last = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[0].startsWith('**')) {
      parts.push(<strong key={match.index} className="font-semibold text-white">{match[2]}</strong>);
    } else {
      parts.push(<em key={match.index} className="italic">{match[3]}</em>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length > 0 ? parts : [text];
}
