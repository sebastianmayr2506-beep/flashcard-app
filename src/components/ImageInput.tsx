import { useRef, useCallback, useState } from 'react';
import type { CardImage } from '../types/card';
import { compressImageFile } from '../utils/imageCompress';

interface Props {
  value?: CardImage;
  onChange: (image: CardImage | undefined) => void;
  label?: string;
}

export default function ImageInput({ value, onChange, label = 'Bild' }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [urlInput, setUrlInput] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);

  const [compressing, setCompressing] = useState(false);
  const handleFile = useCallback(async (file: File) => {
    // Compress + resize before storing. A raw 5–15 MP phone photo would
    // otherwise consume 8–10 MB as a base64 string, triggering a memory-
    // pressure tab reload on mobile Safari and silently losing the user's
    // unsaved edit. compressImageFile shrinks typical camera photos to
    // <300 KB and falls back to the raw bytes if canvas decoding fails.
    setCompressing(true);
    try {
      const { data, mimeType } = await compressImageFile(file);
      onChange({ type: 'base64', data, mimeType });
    } catch (err) {
      console.error('[ImageInput] image processing failed:', err);
      // Last-resort fallback so the user isn't left with a silent failure
      const reader = new FileReader();
      reader.onload = e => {
        const dataUrl = e.target?.result as string | undefined;
        if (!dataUrl) return;
        onChange({ type: 'base64', data: dataUrl.split(',')[1] ?? '', mimeType: file.type || 'image/png' });
      };
      reader.readAsDataURL(file);
    } finally {
      setCompressing(false);
    }
  }, [onChange]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) { handleFile(file); break; }
      }
    }
  }, [handleFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleFile(file);
  }, [handleFile]);

  const handleUrlSubmit = () => {
    if (urlInput.trim()) {
      onChange({ type: 'url', data: urlInput.trim() });
      setUrlInput('');
      setShowUrlInput(false);
    }
  };

  const imgSrc = value
    ? (value.type === 'base64' ? `data:${value.mimeType ?? 'image/png'};base64,${value.data}` : value.data)
    : null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider">{label}</p>
      {imgSrc ? (
        <div className="relative group rounded-xl overflow-hidden border border-[#2d3148] bg-[#252840]">
          <img src={imgSrc} alt="Karten-Bild" className="max-h-48 w-full object-contain" />
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="absolute top-2 right-2 bg-red-500/80 hover:bg-red-500 text-white rounded-full w-7 h-7 flex items-center justify-center text-sm opacity-0 group-hover:opacity-100 transition-opacity"
          >
            ✕
          </button>
        </div>
      ) : (
        <div
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          className="border-2 border-dashed border-[#2d3148] rounded-xl p-4 text-center hover:border-indigo-500/50 transition-colors cursor-pointer"
          onClick={() => fileRef.current?.click()}
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && fileRef.current?.click()}
        >
          {compressing ? (
            <p className="text-sm text-indigo-300 flex items-center justify-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
              Bild wird verarbeitet…
            </p>
          ) : (
            <p className="text-sm text-[#6b7280]">
              Ctrl+V einfügen · Datei ablegen · hier klicken
            </p>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="text-xs px-3 py-1.5 rounded-lg bg-[#252840] hover:bg-[#2d3148] text-[#9ca3af] hover:text-white transition-colors border border-[#2d3148]"
        >
          📁 Datei
        </button>
        <button
          type="button"
          onClick={() => setShowUrlInput(!showUrlInput)}
          className="text-xs px-3 py-1.5 rounded-lg bg-[#252840] hover:bg-[#2d3148] text-[#9ca3af] hover:text-white transition-colors border border-[#2d3148]"
        >
          🔗 URL
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors border border-red-500/20"
          >
            Entfernen
          </button>
        )}
      </div>
      {showUrlInput && (
        <div className="flex gap-2">
          <input
            type="url"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            placeholder="https://example.com/bild.png"
            className="flex-1 text-sm bg-[#252840] border border-[#2d3148] rounded-lg px-3 py-2 text-white placeholder-[#6b7280] focus:border-indigo-500 focus:outline-none"
            onKeyDown={e => e.key === 'Enter' && handleUrlSubmit()}
          />
          <button
            type="button"
            onClick={handleUrlSubmit}
            className="px-3 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm transition-colors"
          >
            OK
          </button>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
      />
    </div>
  );
}
