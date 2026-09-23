import { getProjectsSummary, getProject } from '../db';
import { LayerData, ProjectData } from '../types';
import { DetectedOriginalInfo, extractOriginalImageInfo } from './imageMetadata';
import { sourceFolderManager } from './sourceFolderStore';
import { generateThumbnail } from './thumbnailGenerator';

export interface AutoMatchResult {
  afterFile: File;
  detectedInfo: DetectedOriginalInfo | null;
  originalBlob: Blob | File | null;
  originalName: string | null;
  matchSource: 'source-folder' | 'indexeddb' | 'url-fetch' | 'batch-selection' | 'manual' | null;
}

/**
 * Searches for a matching original image based on metadata information
 */
export async function findOriginalImage(
  afterFile: File,
  detectedInfo: DetectedOriginalInfo | null,
  additionalCandidateFiles?: File[]
): Promise<AutoMatchResult> {
  const result: AutoMatchResult = {
    afterFile,
    detectedInfo,
    originalBlob: null,
    originalName: detectedInfo?.filename || null,
    matchSource: null,
  };

  if (!detectedInfo || !detectedInfo.filename) {
    return result;
  }

  const targetFilename = detectedInfo.filename.toLowerCase();
  const targetBaseName = targetFilename.replace(/\.[a-zA-Z0-9]+$/, '');
  const relativePath = detectedInfo.relativePath || detectedInfo.filename;

  // 1. Check user-selected Source Folder first (highest priority & instant local matching)
  const folderMatch = sourceFolderManager.findMatch(detectedInfo.filename, relativePath);
  if (folderMatch) {
    result.originalBlob = folderMatch.file;
    result.originalName = folderMatch.file.name;
    result.matchSource = 'source-folder';
    return result;
  }

  // If primary candidate didn't match, check other candidates from ComfyUI workflow
  if (detectedInfo.allCandidates && detectedInfo.allCandidates.length > 1) {
    for (const cand of detectedInfo.allCandidates) {
      const match = sourceFolderManager.findMatch(cand.filename, cand.relativePath);
      if (match) {
        result.detectedInfo = cand;
        result.originalBlob = match.file;
        result.originalName = match.file.name;
        result.matchSource = 'source-folder';
        return result;
      }
    }
  }

  // 2. Check additional candidate files if provided (e.g. user selected multiple files or a folder together)
  if (additionalCandidateFiles && additionalCandidateFiles.length > 0) {
    for (const f of additionalCandidateFiles) {
      if (f.name === afterFile.name) continue;
      const fNameLower = f.name.toLowerCase();
      const fBaseLower = fNameLower.replace(/\.[a-zA-Z0-9]+$/, '');
      if (fNameLower === targetFilename || fBaseLower === targetBaseName) {
        result.originalBlob = f;
        result.originalName = f.name;
        result.matchSource = 'batch-selection';
        return result;
      }
    }
  }

  // 3. Check existing projects in IndexedDB (using lightweight summary to prevent loading full blobs into RAM)
  try {
    const projectSummaries = await getProjectsSummary();
    for (const p of projectSummaries) {
      const matchLayer = p.layerThumbnails?.find(l => {
        const lNameLower = l.name.toLowerCase();
        const lBaseLower = lNameLower.replace(/\.[a-zA-Z0-9]+$/, '');
        return lNameLower === targetFilename || lBaseLower === targetBaseName;
      });

      if (matchLayer) {
        // Only load the single matching project's full blob on-demand!
        const fullProject = await getProject(p.id);
        const actualLayer = fullProject?.layers.find(l => l.id === matchLayer.id || l.name === matchLayer.name);
        if (actualLayer && actualLayer.blob) {
          result.originalBlob = actualLayer.blob;
          result.originalName = actualLayer.name;
          result.matchSource = 'indexeddb';
          return result;
        }
      }
    }
  } catch (err) {
    console.warn('Error querying project summaries for original image:', err);
  }

  // 4. Try to fetch relativePath or filename if plausible URL / relative asset path
  if (detectedInfo.relativePath || detectedInfo.filename) {
    const pathsToTry = [
      detectedInfo.relativePath,
      detectedInfo.filename,
      `/${detectedInfo.filename}`,
      `/images/${detectedInfo.filename}`,
      `/assets/${detectedInfo.filename}`,
    ].filter((p): p is string => Boolean(p));

    for (const p of pathsToTry) {
      try {
        const resp = await fetch(p, { method: 'GET' });
        if (resp.ok) {
          const contentType = resp.headers.get('content-type') || '';
          if (contentType.startsWith('image/')) {
            const blob = await resp.blob();
            result.originalBlob = blob;
            result.originalName = detectedInfo.filename;
            result.matchSource = 'url-fetch';
            return result;
          }
        }
      } catch {
        // network fetch error, continue
      }
    }
  }

  return result;
}

/**
 * Utility to asynchronously measure image dimensions from a Blob or File
 */
export async function getImageDimensions(blob: Blob | File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      URL.revokeObjectURL(url);
      resolve({ width: w, height: h });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 0, height: 0 });
    };
    img.src = url;
  });
}

/**
 * Creates an X-Ray pair ProjectData structure:
 * Layer 0: Original image (background outside the lens)
 * Layer 1: AFTER image (shown inside the magnifying lens)
 * Auto-scales layer 1 proportionally to match layer 0's display size (matching "dự án mới và upload ảnh" logic)
 */
export async function createXRayPairProject(
  afterFile: File,
  originalBlob: Blob | File,
  originalName: string,
  projectName?: string,
  folder?: string
): Promise<ProjectData> {
  const timestamp = Date.now();
  const baseProjectName = projectName || originalName.replace(/\.[^/.]+$/, '') || 'DU_AN_XRAY';

  // Resize scaling logic matching "dự án mới và upload ảnh":
  // Proportionally scale layer 2 (AFTER) to match layer 1 (ORIGINAL) height: ratio = origH / afterH
  let scaleRatio: number | undefined = undefined;
  try {
    const [origDim, afterDim] = await Promise.all([
      getImageDimensions(originalBlob),
      getImageDimensions(afterFile)
    ]);
    if (origDim.height > 0 && afterDim.height > 0) {
      scaleRatio = origDim.height / afterDim.height;
    }
  } catch (err) {
    console.warn('Could not precalculate image dimensions:', err);
  }

  // Generate compact thumbnails concurrently (~15KB each)
  let origThumb: Blob | undefined;
  let afterThumb: Blob | undefined;
  try {
    const [t1, t2] = await Promise.all([
      generateThumbnail(originalBlob, { maxDimension: 280, quality: 0.75 }),
      generateThumbnail(afterFile, { maxDimension: 280, quality: 0.75 })
    ]);
    origThumb = t1;
    afterThumb = t2;
  } catch (err) {
    console.warn('Error generating thumbnails for XRay pair:', err);
  }

  const originalLayer: LayerData = {
    id: `${timestamp}_original_${Math.random().toString(36).substring(2, 7)}`,
    name: originalName,
    type: 'image',
    blob: originalBlob,
    thumbnailBlob: origThumb,
    layerScale: 1,
    layerScaleX: 1,
    layerScaleY: 1,
    layerX: 0,
    layerY: 0,
    layerOpacity: 1,
    visible: true,
  };

  const afterLayer: LayerData = {
    id: `${timestamp}_after_${Math.random().toString(36).substring(2, 7)}`,
    name: afterFile.name,
    type: 'image',
    blob: afterFile,
    thumbnailBlob: afterThumb,
    // Scale proportionally to match layer 0's height/size
    layerScale: scaleRatio,
    layerScaleX: scaleRatio,
    layerScaleY: scaleRatio,
    layerX: 0,
    layerY: 0,
    layerOpacity: 1,
    visible: true,
  };

  return {
    id: timestamp.toString(),
    name: `${baseProjectName} (AFTER + GỐC)`,
    folder: folder || 'Khác',
    createdAt: timestamp,
    // Layer 0 is the original image (background outside lens)
    // Layer 1 is the AFTER image (revealed inside the lens)
    layers: [originalLayer, afterLayer],
    thumbnailBlob: afterThumb || origThumb,
  };
}

/**
 * Generates sample demo images with metadata for quick testing
 */
export async function createDemoSampleImages(): Promise<{ originalFile: File; afterFileWithMetadata: File }> {
  // 1. Generate an original image canvas
  const canvasOriginal = document.createElement('canvas');
  canvasOriginal.width = 640;
  canvasOriginal.height = 480;
  const ctxO = canvasOriginal.getContext('2d')!;

  // Draw vintage sketch / blueprint / before effect
  ctxO.fillStyle = '#1e293b';
  ctxO.fillRect(0, 0, 640, 480);

  ctxO.strokeStyle = '#475569';
  ctxO.lineWidth = 1;
  for (let x = 0; x < 640; x += 40) {
    ctxO.beginPath(); ctxO.moveTo(x, 0); ctxO.lineTo(x, 480); ctxO.stroke();
  }
  for (let y = 0; y < 480; y += 40) {
    ctxO.beginPath(); ctxO.moveTo(0, y); ctxO.lineTo(640, y); ctxO.stroke();
  }

  // Draw blueprint engine / circle
  ctxO.strokeStyle = '#94a3b8';
  ctxO.lineWidth = 3;
  ctxO.beginPath(); ctxO.arc(320, 240, 120, 0, Math.PI * 2); ctxO.stroke();
  ctxO.beginPath(); ctxO.arc(320, 240, 60, 0, Math.PI * 2); ctxO.stroke();

  ctxO.fillStyle = '#94a3b8';
  ctxO.font = 'bold 22px monospace';
  ctxO.textAlign = 'center';
  ctxO.fillText('[ẢNH GỐC / ORIGINAL BLUEPRINT]', 320, 100);
  ctxO.font = '14px monospace';
  ctxO.fillText('SAMPLE_ORIGINAL_ENGINE.PNG', 320, 390);

  const originalBlob = await new Promise<Blob>((resolve) => canvasOriginal.toBlob((b) => resolve(b!), 'image/png'));
  const originalFile = new File([originalBlob], 'sample_original_engine.png', { type: 'image/png' });

  // 2. Generate AFTER image canvas (vivid modern rendered version)
  const canvasAfter = document.createElement('canvas');
  canvasAfter.width = 640;
  canvasAfter.height = 480;
  const ctxA = canvasAfter.getContext('2d')!;

  const grad = ctxA.createRadialGradient(320, 240, 20, 320, 240, 300);
  grad.addColorStop(0, '#06b6d4');
  grad.addColorStop(0.5, '#3b82f6');
  grad.addColorStop(1, '#0f172a');
  ctxA.fillStyle = grad;
  ctxA.fillRect(0, 0, 640, 480);

  ctxA.strokeStyle = '#22d3ee';
  ctxA.lineWidth = 4;
  ctxA.beginPath(); ctxA.arc(320, 240, 120, 0, Math.PI * 2); ctxA.stroke();
  ctxA.beginPath(); ctxA.arc(320, 240, 60, 0, Math.PI * 2); ctxA.stroke();

  // Glow core
  ctxA.fillStyle = '#ffffff';
  ctxA.beginPath(); ctxA.arc(320, 240, 30, 0, Math.PI * 2); ctxA.fill();

  ctxA.fillStyle = '#ffffff';
  ctxA.font = 'bold 22px monospace';
  ctxA.textAlign = 'center';
  ctxA.fillText('[ẢNH AFTER / 3D RENDERED CORE]', 320, 100);
  ctxA.font = '14px monospace';
  ctxA.fillText('SAMPLE_AFTER_RENDER.PNG', 320, 390);

  const rawAfterBlob = await new Promise<Blob>((resolve) => canvasAfter.toBlob((b) => resolve(b!), 'image/png'));
  const rawAfterBytes = new Uint8Array(await rawAfterBlob.arrayBuffer());

  // Inject an authentic ComfyUI PNG tEXt chunk containing "prompt" graph with LoadImage node
  const comfyPromptJson = JSON.stringify({
    "10": {
      "class_type": "LoadImage",
      "_meta": { "title": "Load Image (Bản vẽ cơ khí gốc)" },
      "inputs": {
        "image": "D:\\ComfyUI\\input\\blueprints\\sample_original_engine.png",
        "upload": "image"
      }
    },
    "12": {
      "class_type": "VAELoader",
      "inputs": {
        "vae_name": "vae-ft-mse-840000-ema-pruned.safetensors"
      }
    },
    "15": {
      "class_type": "KSampler",
      "inputs": {
        "seed": 884729184,
        "steps": 28,
        "cfg": 7.0,
        "sampler_name": "dpmpp_2m_sde_gpu",
        "scheduler": "karras",
        "denoise": 0.85
      }
    }
  });

  const injectedBytes = injectPngTextChunk(rawAfterBytes, 'prompt', comfyPromptJson);
  const afterFileWithMetadata = new File([injectedBytes], 'sample_after_render.png', { type: 'image/png' });

  return { originalFile, afterFileWithMetadata };
}

/**
 * Helper to inject a standard PNG tEXt chunk before IEND
 */
function injectPngTextChunk(pngBytes: Uint8Array, keyword: string, text: string): Uint8Array {
  // Find IEND chunk
  let iendOffset = -1;
  for (let i = pngBytes.length - 8; i >= 8; i--) {
    if (
      pngBytes[i] === 0x49 &&
      pngBytes[i + 1] === 0x45 &&
      pngBytes[i + 2] === 0x4e &&
      pngBytes[i + 3] === 0x44
    ) {
      iendOffset = i - 4; // start of IEND length
      break;
    }
  }

  if (iendOffset === -1) return pngBytes;

  const enc = new TextEncoder();
  const kwBytes = enc.encode(keyword);
  const valBytes = enc.encode(text);
  const dataLen = kwBytes.length + 1 + valBytes.length; // keyword + \0 + text

  const chunk = new Uint8Array(12 + dataLen);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, dataLen); // length
  chunk[4] = 0x74; // 't'
  chunk[5] = 0x45; // 'E'
  chunk[6] = 0x58; // 'X'
  chunk[7] = 0x74; // 't'

  chunk.set(kwBytes, 8);
  chunk[8 + kwBytes.length] = 0; // null separator
  chunk.set(valBytes, 8 + kwBytes.length + 1);

  // Calculate CRC-32 for chunk type + data
  const crc = crc32(chunk.subarray(4, 8 + dataLen));
  view.setUint32(8 + dataLen, crc);

  // Construct new PNG bytes
  const newBytes = new Uint8Array(pngBytes.length + chunk.length);
  newBytes.set(pngBytes.subarray(0, iendOffset), 0);
  newBytes.set(chunk, iendOffset);
  newBytes.set(pngBytes.subarray(iendOffset), iendOffset + chunk.length);

  return newBytes;
}

// CRC32 implementation for PNG chunks
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xff];
  }
  return (c ^ 0xffffffff) >>> 0;
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}
