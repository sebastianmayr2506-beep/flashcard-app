// Animated bars + recording timer — replaces the live transcript textarea
// while the mic is active. The transcript still streams in the background
// (via mic onResult callbacks into the parent's state); we just hide it
// because mobile speech-recognition outputs are visually noisy (frequent
// duplications mid-stream, weird phrase repetitions on Samsung Internet).
// After recording stops, the parent reveals a regular textarea showing
// the cleaned-up final transcript.

import { useEffect, useState } from 'react';

interface Props {
  /** Optional placeholder count for bars. Default 7. */
  barCount?: number;
}

export default function MicPulseVisualizer({ barCount = 7 }: Props) {
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - start) / 1000));
    }, 250);
    return () => clearInterval(interval);
  }, []);

  const mins = Math.floor(elapsedSec / 60);
  const secs = elapsedSec % 60;
  const timer = `${mins}:${secs.toString().padStart(2, '0')}`;

  return (
    <div className="w-full rounded-xl bg-[#1e2130] border border-purple-500/30 px-4 py-5 flex flex-col items-center gap-3">
      <div className="flex items-end gap-1 h-10">
        {Array.from({ length: barCount }).map((_, i) => (
          <span
            key={i}
            className="w-1.5 bg-purple-400 rounded-full mic-pulse-bar"
            style={{
              // Each bar starts its pulse at a slightly different phase
              // so the whole thing looks like a wave instead of in-sync.
              animationDelay: `${i * 0.12}s`,
              animationDuration: `${0.9 + (i % 3) * 0.15}s`,
            }}
          />
        ))}
      </div>
      <div className="text-xs text-[#9ca3af] flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full bg-red-400 animate-pulse" />
        <span>Aufnahme läuft · <span className="font-mono text-purple-300">{timer}</span></span>
      </div>
      <p className="text-[10px] text-[#6b7280] text-center leading-relaxed">
        Sprich frei — das Transkript wird nach dem Stoppen angezeigt.
      </p>
    </div>
  );
}
