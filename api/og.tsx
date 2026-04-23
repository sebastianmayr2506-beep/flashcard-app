import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

export default function handler() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          background: 'linear-gradient(135deg, #0f1117 0%, #1a1d27 100%)',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '60px 70px',
          fontFamily: 'sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Background glow blobs */}
        <div
          style={{
            position: 'absolute',
            top: '-100px',
            left: '-100px',
            width: '500px',
            height: '500px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(99,102,241,0.25) 0%, transparent 70%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-80px',
            right: '200px',
            width: '450px',
            height: '450px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(139,92,246,0.2) 0%, transparent 70%)',
          }}
        />

        {/* Top accent line */}
        <div
          style={{
            position: 'absolute',
            top: '0',
            left: '0',
            right: '0',
            height: '4px',
            background: 'linear-gradient(90deg, transparent, #6366f1, #8b5cf6, transparent)',
          }}
        />

        {/* LEFT: Brand + text */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0px', zIndex: 1 }}>
          {/* Icon + name */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '18px', marginBottom: '12px' }}>
            <div
              style={{
                width: '72px',
                height: '72px',
                borderRadius: '20px',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '36px',
              }}
            >
              ✨
            </div>
            <span style={{ fontSize: '62px', fontWeight: 800, color: '#ffffff', letterSpacing: '-2px' }}>
              Sebi AI
            </span>
          </div>

          {/* Tagline */}
          <p style={{ fontSize: '24px', color: '#9ca3af', margin: '0 0 36px 0', fontWeight: 400 }}>
            KI-gestützte Prüfungsvorbereitung
          </p>

          {/* Feature pills */}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {[
              { icon: '🧠', label: 'Spaced Repetition', color: '#6366f1', bg: 'rgba(99,102,241,0.15)', border: 'rgba(99,102,241,0.4)' },
              { icon: '✨', label: 'Gemini KI', color: '#a78bfa', bg: 'rgba(139,92,246,0.15)', border: 'rgba(139,92,246,0.4)' },
              { icon: '📝', label: 'Exam-Modus', color: '#4ade80', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.35)' },
            ].map(p => (
              <div
                key={p.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '7px',
                  padding: '10px 20px',
                  borderRadius: '50px',
                  background: p.bg,
                  border: `1.5px solid ${p.border}`,
                  color: p.color,
                  fontSize: '15px',
                  fontWeight: 600,
                }}
              >
                <span>{p.icon}</span>
                <span>{p.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT: Flashcard mock */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '400px',
            borderRadius: '20px',
            background: '#1e2130',
            border: '1.5px solid #2d3148',
            overflow: 'hidden',
            boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
            zIndex: 1,
          }}
        >
          {/* Card header */}
          <div style={{ background: '#252840', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '10px', fontWeight: 700, color: '#6366f1', letterSpacing: '2px' }}>FRAGE</span>
            <span style={{ fontSize: '16px', fontWeight: 600, color: '#ffffff' }}>
              Was ist Spaced Repetition?
            </span>
          </div>

          {/* Card body */}
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontSize: '10px', fontWeight: 700, color: '#8b5cf6', letterSpacing: '2px' }}>ANTWORT</span>
            {[100, 85, 92].map((w, i) => (
              <div
                key={i}
                style={{
                  height: '8px',
                  width: `${w}%`,
                  borderRadius: '4px',
                  background: '#2d3148',
                }}
              />
            ))}

            {/* Rating buttons */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
              {[
                { label: '😊 Gut', bg: 'rgba(34,197,94,0.15)', border: '#22c55e', color: '#4ade80' },
                { label: '🤔 Ok', bg: 'rgba(59,130,246,0.15)', border: '#3b82f6', color: '#60a5fa' },
                { label: '😅 Nein', bg: 'rgba(239,68,68,0.15)', border: '#ef4444', color: '#f87171' },
              ].map(b => (
                <div
                  key={b.label}
                  style={{
                    flex: 1,
                    padding: '8px 4px',
                    borderRadius: '10px',
                    background: b.bg,
                    border: `1px solid ${b.border}`,
                    color: b.color,
                    fontSize: '12px',
                    fontWeight: 600,
                    textAlign: 'center',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {b.label}
                </div>
              ))}
            </div>

            {/* AI badge */}
            <div
              style={{
                marginTop: '4px',
                padding: '8px 12px',
                borderRadius: '10px',
                background: 'rgba(139,92,246,0.15)',
                border: '1px solid rgba(139,92,246,0.4)',
                color: '#a78bfa',
                fontSize: '12px',
                fontWeight: 600,
                textAlign: 'center',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ✨ Mit KI überarbeiten
            </div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
