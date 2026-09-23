/**
 * Instagram-Style Thumbnail Generator and Memory-Safe Cache
 *
 * Optimizes browser memory by generating ultra-compact downscaled WebP/JPEG thumbnails (~15-25KB)
 * directly from full-size raw images/videos (which can be 20MB - 50MB and 4K-8K resolution).
 *
 * Prevents tab freezing and Out-Of-Memory crashes when loading 100+ projects or 1000+ images.
 */

export interface ThumbnailOptions {
  maxDimension?: number;
  quality?: number;
  format?: 'image/webp' | 'image/jpeg';
}

const DEFAULT_MAX_DIMENSION = 280;
const DEFAULT_QUALITY = 0.75;

/**
 * Generates a downscaled, compressed thumbnail Blob from an image or video Blob/File.
 */
export async function generateThumbnail(
  blob: Blob | File,
  options?: ThumbnailOptions
): Promise<Blob> {
  const maxDim = options?.maxDimension || DEFAULT_MAX_DIMENSION;
  const quality = options?.quality || DEFAULT_QUALITY;
  const format = options?.format || 'image/webp';

  const isVideo = blob.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test((blob as File).name || '');

  if (isVideo) {
    return generateVideoThumbnail(blob, maxDim, quality, format);
  }

  return generateImageThumbnail(blob, maxDim, quality, format);
}

/**
 * Fast hardware-accelerated image downscaling via createImageBitmap or Canvas.
 */
async function generateImageThumbnail(
  blob: Blob | File,
  maxDim: number,
  quality: number,
  format: 'image/webp' | 'image/jpeg'
): Promise<Blob> {
  // Strategy 1: Modern createImageBitmap with native downscaling
  // This performs hardware-assisted downscaling during decode without allocating full 4K buffer in JS heap.
  if ('createImageBitmap' in window) {
    try {
      // First inspect natural dimensions quickly
      const tempBitmap = await createImageBitmap(blob);
      const origW = tempBitmap.width;
      const origH = tempBitmap.height;
      tempBitmap.close();

      if (origW > 0 && origH > 0) {
        let targetW = origW;
        let targetH = origH;
        if (targetW > targetH) {
          if (targetW > maxDim) {
            targetH = Math.round((targetH * maxDim) / targetW);
            targetW = maxDim;
          }
        } else {
          if (targetH > maxDim) {
            targetW = Math.round((targetW * maxDim) / targetH);
            targetH = maxDim;
          }
        }

        const resizedBitmap = await createImageBitmap(blob, {
          resizeWidth: targetW,
          resizeHeight: targetH,
          resizeQuality: 'medium',
        });

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(resizedBitmap, 0, 0);
          resizedBitmap.close();

          const thumbBlob = await canvasToBlob(canvas, format, quality);
          if (thumbBlob) return thumbBlob;
        }
      }
    } catch {
      // Fallback to standard Image loading if createImageBitmap with options failed
    }
  }

  // Strategy 2: Standard HTMLImageElement downscale via Canvas
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = async () => {
      try {
        const origW = img.naturalWidth || 100;
        const origH = img.naturalHeight || 100;

        let targetW = origW;
        let targetH = origH;
        if (targetW > targetH) {
          if (targetW > maxDim) {
            targetH = Math.round((targetH * maxDim) / targetW);
            targetW = maxDim;
          }
        } else {
          if (targetH > maxDim) {
            targetW = Math.round((targetW * maxDim) / targetH);
            targetH = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          URL.revokeObjectURL(url);
          resolve(blob);
          return;
        }

        // Smooth downscaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'medium';
        ctx.drawImage(img, 0, 0, targetW, targetH);
        URL.revokeObjectURL(url);

        const thumbBlob = await canvasToBlob(canvas, format, quality);
        resolve(thumbBlob || blob);
      } catch (e) {
        URL.revokeObjectURL(url);
        resolve(blob);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(blob);
    };

    img.src = url;
  });
}

/**
 * Extracts a frame at ~0.1s from a video and resizes it to a small thumbnail.
 */
function generateVideoThumbnail(
  blob: Blob | File,
  maxDim: number,
  quality: number,
  format: 'image/webp' | 'image/jpeg'
): Promise<Blob> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(blob);
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';

    const cleanUp = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
    };

    const timeout = setTimeout(() => {
      cleanUp();
      resolve(blob);
    }, 5000);

    video.onloadeddata = () => {
      video.currentTime = 0.1;
    };

    video.onseeked = async () => {
      clearTimeout(timeout);
      try {
        const origW = video.videoWidth || 320;
        const origH = video.videoHeight || 240;

        let targetW = origW;
        let targetH = origH;
        if (targetW > targetH) {
          if (targetW > maxDim) {
            targetH = Math.round((targetH * maxDim) / targetW);
            targetW = maxDim;
          }
        } else {
          if (targetH > maxDim) {
            targetW = Math.round((targetW * maxDim) / targetH);
            targetH = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, targetW, targetH);
          const thumbBlob = await canvasToBlob(canvas, format, quality);
          cleanUp();
          resolve(thumbBlob || blob);
          return;
        }
      } catch {
        // ignore
      }
      cleanUp();
      resolve(blob);
    };

    video.onerror = () => {
      clearTimeout(timeout);
      cleanUp();
      resolve(blob);
    };
  });
}

/**
 * Canvas to Blob with WebP / JPEG fallback
 */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          // WebP might not be supported on very old browsers, fallback to JPEG
          canvas.toBlob((fallback) => resolve(fallback), 'image/jpeg', quality);
        }
      },
      format,
      quality
    );
  });
}

/**
 * Memory-safe LRU URL Cache:
 * Keeps at most 120 object URLs in memory. When a new URL is generated and the limit is exceeded,
 * the oldest URL is automatically revoked via URL.revokeObjectURL to prevent memory accumulation.
 */
class ThumbnailUrlCache {
  private cache = new Map<string, string>();
  private maxEntries = 120;

  public getOrCreateUrl(id: string, blob: Blob): string {
    const existing = this.cache.get(id);
    if (existing) {
      // Move to end of Map (most recently used)
      this.cache.delete(id);
      this.cache.set(id, existing);
      return existing;
    }

    if (this.cache.size >= this.maxEntries) {
      // Evict oldest entry
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        const oldUrl = this.cache.get(oldestKey);
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        this.cache.delete(oldestKey);
      }
    }

    const newUrl = URL.createObjectURL(blob);
    this.cache.set(id, newUrl);
    return newUrl;
  }

  public revoke(id: string) {
    const url = this.cache.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      this.cache.delete(id);
    }
  }

  public clear() {
    this.cache.forEach((url) => URL.revokeObjectURL(url));
    this.cache.clear();
  }
}

export const thumbnailUrlCache = new ThumbnailUrlCache();
