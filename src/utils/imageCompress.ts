// Compress + resize an image File before we store it as base64 on a card.
//
// Why this exists: phone cameras produce 5–15 MP photos at 5–10 MB. Reading
// such a file via FileReader.readAsDataURL produces a ~10 MB base64 string,
// holds the original ArrayBuffer + the Data-URL string + the base64 string
// all in memory at once, then triggers a React re-render with the huge
// string in component state. Mobile Safari aggressively reloads the tab
// under memory pressure → the user's in-progress edit is silently lost.
//
// We side-step this by drawing the image onto a canvas at a sensible
// maximum dimension and re-encoding as JPEG. Typical 5MP camera photo
// shrinks from 8 MB → <300 KB. No external dependency.
//
// HEIC images from iPhone: Safari can decode them via <img>, Chrome can't.
// On decode failure we fall back to the original (uncompressed) base64 so
// the user still gets *something* rather than a broken image.

const MAX_DIMENSION = 1600; // px on the long edge — plenty for a flashcard
const JPEG_QUALITY = 0.85;
// If the source is already small AND a "safe" mime type, skip compression.
const SKIP_THRESHOLD_BYTES = 500 * 1024; // 500 KB
const SKIP_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export interface CompressedImage {
  /** Base64 string (without the data URL prefix). */
  data: string;
  mimeType: string;
}

/**
 * Read a File as a data URL via FileReader. Used for the small-file
 * fast path AND as the fallback when canvas compression fails.
 */
function readAsBase64(file: File): Promise<CompressedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const data = e.target?.result as string | undefined;
      if (!data) { reject(new Error('FileReader produced no result')); return; }
      const base64 = data.split(',')[1] ?? '';
      resolve({ data: base64, mimeType: file.type || 'image/png' });
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.readAsDataURL(file);
  });
}

/**
 * Resize and re-encode the image to JPEG via a canvas. Returns the
 * compressed base64. Throws if the image cannot be decoded.
 */
function canvasCompress(file: File): Promise<CompressedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const { width, height } = img;
        if (!width || !height) { reject(new Error('Image has zero dimension')); return; }
        const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height, 1);
        const targetW = Math.round(width * scale);
        const targetH = Math.round(height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('2D context unavailable')); return; }
        // White background — JPEG can't be transparent. PNGs with transparency
        // would otherwise come out with black backgrounds on some browsers.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(img, 0, 0, targetW, targetH);

        canvas.toBlob(
          blob => {
            if (!blob) { reject(new Error('Canvas toBlob returned null')); return; }
            const r = new FileReader();
            r.onload = e => {
              const dataUrl = e.target?.result as string | undefined;
              if (!dataUrl) { reject(new Error('Failed to read compressed blob')); return; }
              const base64 = dataUrl.split(',')[1] ?? '';
              resolve({ data: base64, mimeType: 'image/jpeg' });
            };
            r.onerror = () => reject(r.error ?? new Error('FileReader error on blob'));
            r.readAsDataURL(blob);
          },
          'image/jpeg',
          JPEG_QUALITY,
        );
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image decode failed (HEIC on Chrome, corrupt file, etc.)'));
    };
    img.src = url;
  });
}

/**
 * Best-effort image compression. Skips compression for already-small files,
 * falls back to raw base64 if canvas decoding fails.
 */
export async function compressImageFile(file: File): Promise<CompressedImage> {
  if (file.size <= SKIP_THRESHOLD_BYTES && SKIP_TYPES.has(file.type)) {
    return readAsBase64(file);
  }
  try {
    return await canvasCompress(file);
  } catch (err) {
    console.warn('[imageCompress] canvas path failed — falling back to raw base64:', err);
    return readAsBase64(file);
  }
}
