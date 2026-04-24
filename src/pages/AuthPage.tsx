import { useState } from 'react';
import { supabase } from '../lib/supabase';

type Mode = 'login' | 'register' | 'forgot';

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'register') {
        // Validate invite code before creating account
        const { data: codeOk, error: rpcErr } = await supabase.rpc('consume_invite_code', {
          p_code: inviteCode.trim().toUpperCase(),
          p_email: email.trim().toLowerCase(),
        });
        if (rpcErr) throw new Error('Code-Prüfung fehlgeschlagen. Bitte versuche es erneut.');
        if (!codeOk) throw new Error('Ungültiger oder bereits verwendeter Einladungscode.');

        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setSuccess('Bestätigungsmail gesendet! Bitte überprüfe dein Postfach.');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/`,
        });
        if (error) throw error;
        setSuccess('Passwort-Reset E-Mail gesendet!');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ein Fehler ist aufgetreten');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">✨</div>
          <h1 className="text-2xl font-bold text-white">Sebi AI</h1>
          <p className="text-[#9ca3af] text-sm mt-1">Bachelor Prüfungsvorbereitung</p>
        </div>

        <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-5">
            {mode === 'login' ? 'Anmelden' : mode === 'register' ? 'Registrieren' : 'Passwort zurücksetzen'}
          </h2>

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}
          {success && (
            <div className="mb-4 p-3 rounded-xl bg-green-500/10 border border-green-500/30">
              <p className="text-green-400 text-sm">{success}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-1.5">
                E-Mail
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="deine@email.com"
                className="w-full text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2.5 text-white placeholder-[#6b7280] focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {mode !== 'forgot' && (
              <div>
                <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-1.5">
                  Passwort
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  minLength={6}
                  className="w-full text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2.5 text-white placeholder-[#6b7280] focus:border-indigo-500 focus:outline-none"
                />
              </div>
            )}

            {mode === 'register' && (
              <div>
                <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-1.5">
                  Einladungscode
                </label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={e => setInviteCode(e.target.value.toUpperCase())}
                  required
                  placeholder="XXXX-XXXX"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2.5 text-white placeholder-[#6b7280] focus:border-indigo-500 focus:outline-none font-mono tracking-widest"
                />
                <p className="text-xs text-[#6b7280] mt-1.5">Du brauchst einen Code von Sebi um dich zu registrieren.</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold transition-colors"
            >
              {loading ? 'Laden…' : mode === 'login' ? 'Anmelden' : mode === 'register' ? 'Konto erstellen' : 'Link senden'}
            </button>
          </form>

          <div className="mt-5 space-y-2 text-center">
            {mode === 'login' && (
              <>
                <button onClick={() => { setMode('register'); setError(''); setSuccess(''); }} className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors block w-full">
                  Noch kein Konto? Registrieren
                </button>
                <button onClick={() => { setMode('forgot'); setError(''); setSuccess(''); }} className="text-sm text-[#6b7280] hover:text-[#9ca3af] transition-colors block w-full">
                  Passwort vergessen?
                </button>
              </>
            )}
            {(mode === 'register' || mode === 'forgot') && (
              <button onClick={() => { setMode('login'); setError(''); setSuccess(''); }} className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors">
                Zurück zur Anmeldung
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
