// Renders Markdown: ## headings, **bold**, *italic*, - bullets (nested), | tables |

const BULLET_MARKERS = ['•', '◦', '▪', '▫'];

// Counts leading whitespace and returns nesting level.
// Tab = 4 spaces, every 2 spaces = one level. Capped at 4.
function getIndentLevel(rawLine: string): number {
  const match = rawLine.match(/^[ \t]*/);
  if (!match) return 0;
  let spaces = 0;
  for (const ch of match[0]) spaces += ch === '\t' ? 4 : 1;
  return Math.min(Math.floor(spaces / 2), 4);
}

export default function MarkdownText({ text, className = '' }: { text: string; className?: string }) {
  const lines = text.split('\n');
  const output: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trimStart();

    // Fenced code block: ``` ... ``` — preserve ALL whitespace (critical for ASCII art)
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const bodyLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        bodyLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      output.push(
        <span key={`code-${i}`} className="block my-2 overflow-x-auto rounded-lg bg-[#0f1117] border border-[#2d3148] p-3">
          <pre className="text-xs text-[#d1d5db] font-mono leading-snug whitespace-pre">
            {lang && <span className="block text-[10px] text-[#6b7280] uppercase tracking-wider mb-1">{lang}</span>}
            {bodyLines.join('\n')}
          </pre>
        </span>
      );
      continue;
    }

    // Detect table: current line has pipes and next line is separator |---|
    if (trimmed.startsWith('|') && i + 1 < lines.length && lines[i + 1].trim().match(/^\|[-| :]+\|$/)) {
      const headerCells = parseTableRow(trimmed);
      i += 2; // skip header + separator

      const bodyRows: string[][] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        bodyRows.push(parseTableRow(lines[i].trimStart()));
        i++;
      }

      output.push(
        <span key={i} className="block overflow-x-auto my-2">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                {headerCells.map((cell, ci) => (
                  <th key={ci} className="px-3 py-2 text-left font-semibold text-white bg-[#252840] border border-[#3d4168]">
                    {parseInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? 'bg-[#1a1d27]' : 'bg-[#1e2130]'}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-2 text-[#d1d5db] border border-[#2d3148]">
                      {parseInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </span>
      );
      continue;
    }

    // H1
    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
      output.push(
        <span key={i} className="block text-2xl font-bold text-white mt-3 mb-1">
          {parseInline(trimmed.slice(2))}
        </span>
      );
    }
    // H2
    else if (trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
      output.push(
        <span key={i} className="block text-lg font-bold text-white mt-3 mb-1">
          {parseInline(trimmed.slice(3))}
        </span>
      );
    }
    // H3
    else if (trimmed.startsWith('### ')) {
      output.push(
        <span key={i} className="block text-base font-semibold text-indigo-300 mt-2 mb-0.5">
          {parseInline(trimmed.slice(4))}
        </span>
      );
    }
    // Numbered list (1. item) — supports nesting via leading whitespace (2 spaces / 1 tab per level)
    else if (trimmed.match(/^\d+\. /)) {
      const level = getIndentLevel(rawLine);
      const num = trimmed.match(/^(\d+)\. /)?.[1] ?? '';
      const content = trimmed.replace(/^\d+\. /, '');
      output.push(
        <span
          key={i}
          className="block relative mt-0.5"
          style={{ paddingLeft: `${24 + level * 20}px` }}
        >
          <span
            className="absolute top-0 text-indigo-400 text-xs font-semibold"
            style={{ left: `${4 + level * 20}px` }}
          >
            {num}.
          </span>
          {parseInline(content)}
        </span>
      );
    }
    // Bullet list — supports nesting via leading whitespace (2 spaces / 1 tab per level)
    else if (trimmed.match(/^[-*] /)) {
      const level = getIndentLevel(rawLine);
      const marker = BULLET_MARKERS[Math.min(level, BULLET_MARKERS.length - 1)];
      output.push(
        <span
          key={i}
          className="block relative mt-0.5"
          style={{ paddingLeft: `${16 + level * 20}px` }}
        >
          <span
            className="absolute top-0 text-indigo-400"
            style={{ left: `${4 + level * 20}px` }}
          >
            {marker}
          </span>
          {parseInline(trimmed.slice(2))}
        </span>
      );
    }
    // Horizontal rule: --- / *** / ___
    else if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      output.push(
        <span key={i} className="block my-3">
          <span className="block border-t border-[#2d3148]" />
        </span>
      );
    }
    // Empty line → spacer
    else if (trimmed === '') {
      output.push(<span key={i} className="block h-2" />);
    }
    // Normal paragraph line
    else {
      output.push(
        <span key={i} className="block">
          {parseInline(trimmed)}
        </span>
      );
    }
    i++;
  }

  return <span className={`${className} block`}>{output}</span>;
}

function parseTableRow(line: string): string[] {
  return line
    .split('|')
    .slice(1, -1) // remove leading/trailing empty strings from outer pipes
    .map(cell => cell.trim());
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
