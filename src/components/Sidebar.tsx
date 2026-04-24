import { useState } from 'react';

interface NavItem {
  id: string;
  icon: string;
  label: string;
}

const navItems: NavItem[] = [
  { id: 'dashboard',   icon: '⬡', label: 'Dashboard' },
  { id: 'library',     icon: '⊞', label: 'Bibliothek' },
  { id: 'sets',        icon: '📂', label: 'Meine Sets' },
  { id: 'new-card',    icon: '+', label: 'Neue Karte' },
  { id: 'study',       icon: '▶', label: 'Lernen' },
  { id: 'exam',        icon: '🎯', label: 'Prüfungsmodus' },
  { id: 'import-export', icon: '⇅', label: 'Import / Export' },
  { id: 'settings',    icon: '⚙', label: 'Einstellungen' },
];

// Items shown directly in mobile bottom nav (most-used)
const mobileMainIds = ['dashboard', 'study', 'exam', 'library'];
const mobileMainItems = navItems.filter(n => mobileMainIds.includes(n.id));
const mobileMoreItems = navItems.filter(n => !mobileMainIds.includes(n.id));

interface Props {
  active: string;
  onChange: (page: string) => void;
  dueCount: number;
  onSignOut: () => void;
  userEmail?: string;
}

export default function Sidebar({ active, onChange, dueCount, onSignOut, userEmail }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  // set-detail is a sub-page of sets — highlight sets nav item
  const effectiveActive = active === 'set-detail' ? 'sets' : active;
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 min-h-screen bg-[#1a1d27] border-r border-[#2d3148] p-4 shrink-0">
        <div className="mb-8 px-2">
          <h1 className="text-xl font-bold text-white tracking-tight">✨ Sebi AI</h1>
          <p className="text-xs text-[#6b7280] mt-0.5">Exam Prep</p>
        </div>
        <nav className="flex flex-col gap-1 flex-1">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 relative group
                ${effectiveActive === item.id
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
        <div className="mt-auto pt-4 border-t border-[#2d3148] space-y-2">
          {userEmail && (
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-[#252840] border border-[#2d3148]">
              <div className="w-7 h-7 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-indigo-400">
                  {userEmail[0].toUpperCase()}
                </span>
              </div>
              <span className="text-xs text-[#9ca3af] truncate">{userEmail}</span>
            </div>
          )}
          <button
            onClick={onSignOut}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-[#9ca3af] hover:bg-red-500/10 hover:text-red-400 border border-transparent transition-all"
          >
            <span className="text-base w-5 text-center">⏻</span>
            <span>Abmelden</span>
          </button>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#1a1d27] border-t border-[#2d3148] z-40">
        {/* "Mehr" popup sheet */}
        {moreOpen && (
          <div className="absolute bottom-full left-0 right-0 bg-[#1a1d27] border-t border-[#2d3148] grid grid-cols-4 pb-1">
            {mobileMoreItems.map(item => (
              <button
                key={item.id}
                onClick={() => { onChange(item.id); setMoreOpen(false); }}
                className={`flex flex-col items-center justify-center py-3 gap-1
                  ${effectiveActive === item.id ? 'text-indigo-400' : 'text-[#9ca3af]'}`}
              >
                <span className="text-xl leading-none">{item.icon}</span>
                <span className="text-[10px] font-medium">{item.label.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        )}
        {/* Backdrop to close Mehr */}
        {moreOpen && (
          <div className="fixed inset-0 z-[-1]" onClick={() => setMoreOpen(false)} />
        )}

        <div className="flex">
          {mobileMainItems.map(item => (
            <button
              key={item.id}
              onClick={() => { onChange(item.id); setMoreOpen(false); }}
              className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 relative
                ${effectiveActive === item.id ? 'text-indigo-400' : 'text-[#6b7280]'}`}
            >
              <span className="text-xl leading-none">{item.icon}</span>
              <span className="text-[10px] font-medium leading-tight">{item.label.split(' ')[0]}</span>
              {item.id === 'study' && dueCount > 0 && (
                <span className="absolute top-1.5 right-[22%] bg-indigo-500 text-white text-[8px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {dueCount > 99 ? '99' : dueCount}
                </span>
              )}
            </button>
          ))}
          {/* Mehr button */}
          <button
            onClick={() => setMoreOpen(s => !s)}
            className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5
              ${moreOpen ? 'text-indigo-400' : 'text-[#6b7280]'}`}
          >
            <span className="text-xl leading-none">⋯</span>
            <span className="text-[10px] font-medium leading-tight">Mehr</span>
          </button>
        </div>
      </nav>
    </>
  );
}
