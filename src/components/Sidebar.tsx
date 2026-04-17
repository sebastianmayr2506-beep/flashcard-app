interface NavItem {
  id: string;
  icon: string;
  label: string;
}

const navItems: NavItem[] = [
  { id: 'dashboard',   icon: '⬡', label: 'Dashboard' },
  { id: 'library',     icon: '⊞', label: 'Bibliothek' },
  { id: 'new-card',    icon: '+', label: 'Neue Karte' },
  { id: 'study',       icon: '▶', label: 'Lernen' },
  { id: 'import-export', icon: '⇅', label: 'Import / Export' },
  { id: 'settings',    icon: '⚙', label: 'Einstellungen' },
];

interface Props {
  active: string;
  onChange: (page: string) => void;
  dueCount: number;
}

export default function Sidebar({ active, onChange, dueCount }: Props) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 min-h-screen bg-[#1a1d27] border-r border-[#2d3148] p-4 shrink-0">
        <div className="mb-8 px-2">
          <h1 className="text-xl font-bold text-white tracking-tight">🎓 KarteAI</h1>
          <p className="text-xs text-[#6b7280] mt-0.5">Exam Prep</p>
        </div>
        <nav className="flex flex-col gap-1 flex-1">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 relative group
                ${active === item.id
                  ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30'
                  : 'text-[#9ca3af] hover:bg-[#252840] hover:text-white border border-transparent'
                }`}
            >
              <span className="text-base w-5 text-center">{item.icon}</span>
              <span>{item.label}</span>
              {item.id === 'study' && dueCount > 0 && (
                <span className="ml-auto bg-indigo-500 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center">
                  {dueCount}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="mt-auto pt-4 border-t border-[#2d3148]">
          <p className="text-xs text-[#6b7280] px-2">Bachelor Prüfungsvorbereitung</p>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#1a1d27] border-t border-[#2d3148] z-40 flex">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 relative
              ${active === item.id ? 'text-indigo-400' : 'text-[#6b7280]'}`}
          >
            <span className="text-lg leading-none">{item.icon}</span>
            <span className="text-[9px] font-medium">{item.label.split(' ')[0]}</span>
            {item.id === 'study' && dueCount > 0 && (
              <span className="absolute top-1 right-1/4 bg-indigo-500 text-white text-[8px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {dueCount > 99 ? '99' : dueCount}
              </span>
            )}
          </button>
        ))}
      </nav>
    </>
  );
}
