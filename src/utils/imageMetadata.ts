/**
 * Comprehensive Image Metadata Extractor for detecting Original / Source / Before images
 * Supports:
 * - JPEG: EXIF (IFD0, SubIFD), XMP (APP1), IPTC (APP13), COM markers
 * - PNG: tEXt, iTXt, zTXt chunks (including XML:com.adobe.xmp and AI tools JSON like ComfyUI/A1111)
 * - WebP: EXIF and XMP chunks
 * - Fallback binary string scanning for common metadata patterns
 */

export interface ComfyNodeDetails {
  nodeId?: string | number;
  nodeType?: string;
  nodeTitle?: string;
  parameterName?: string;
  rawPath?: string;
  cleanPath?: string;
  rawSnippet?: string;
}

export interface DetectedOriginalInfo {
  filename: string;
  relativePath?: string;
  sourceType: 'comfyui-prompt' | 'comfyui-workflow' | 'xmp' | 'exif' | 'png-chunk' | 'json' | 'comment' | 'iptc' | 'binary-scan' | 'filename-convention';
  metadataField?: string;
  rawMetadataValue?: string;
  comfyDetails?: ComfyNodeDetails;
  allCandidates?: DetectedOriginalInfo[];
}

/**
 * Clean and extract a relative path and clean filename from a metadata string/path
 * Prioritizes relative paths and filename over absolute paths (like D:\... or C:\...)
 * so the app continues working even if the directory was moved or renamed.
 */
export function extractRelativePathAndFilename(raw: string): { filename: string; relativePath: string } | null {
  if (!raw || typeof raw !== 'string') return null;
  let str = raw.trim().replace(/^["'`]|["'`]$/g, '').trim();
  if (!str) return null;

  // Standardize slashes
  str = str.replace(/\\/g, '/');

  // If URL, take pathname
  if (str.startsWith('http://') || str.startsWith('https://')) {
    try {
      str = new URL(str).pathname;
    } catch {
      // ignore
    }
  }

  // Strip Windows drive letters e.g. D:/ or C:/
  str = str.replace(/^[a-zA-Z]:\/+/, '');

  // Split path components
  const parts = str.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  const filename = parts[parts.length - 1]?.trim();
  if (!filename || filename.includes('<') || filename.includes('>') || filename.includes('{') || filename.includes('}')) {
    return null;
  }

  // Check if valid image extension
  const imgExtRegex = /\.(jpe?g|png|webp|gif|bmp|tiff?|avif|heic|svg|raw|cr2|nef|arw)$/i;
  const isImageLike = imgExtRegex.test(filename) || /^[a-zA-Z0-9_-]{2,100}$/.test(filename);
  if (!isImageLike) return null;

  // If path contains 'input/' (standard ComfyUI input folder), strip preceding parts
  const lowerParts = parts.map(p => p.toLowerCase());
  const inputIdx = lowerParts.lastIndexOf('input');
  let relativePath = filename;

  if (inputIdx !== -1 && inputIdx < parts.length - 1) {
    relativePath = parts.slice(inputIdx + 1).join('/');
  } else if (parts.length > 1) {
    // Preserve relative subfolder (e.g. portraits/photo.png)
    relativePath = parts.slice(-2).join('/');
  }

  return {
    filename,
    relativePath,
  };
}

/**
 * Clean and extract a valid filename from a metadata string/path
 */
export function extractCleanFilename(raw: string): string | null {
  const res = extractRelativePathAndFilename(raw);
  return res ? res.filename : null;
}

/**
 * Helper to decode text from Uint8Array
 */
function decodeAsciiOrUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    let s = '';
    for (let i = 0; i < bytes.length; i++) {
      s += String.fromCharCode(bytes[i]);
    }
    return s;
  }
}

/**
 * Parse XMP XML string and look for original document/source image references
 */
export function parseXmpString(xmpText: string): DetectedOriginalInfo | null {
  if (!xmpText || typeof xmpText !== 'string') return null;

  // 1. stRef:originalDocumentID
  const origDocIdMatch = xmpText.match(/<[^:]+:originalDocumentID>([^<]+)<\/[^:]+:originalDocumentID>/i) 
    || xmpText.match(/(?:stRef|xmpMM):originalDocumentID=["']([^"']+)["']/i);
  if (origDocIdMatch) {
    const fn = extractCleanFilename(origDocIdMatch[1]);
    if (fn) {
      return {
        filename: fn,
        relativePath: origDocIdMatch[1].trim(),
        sourceType: 'xmp',
        metadataField: 'xmpMM:originalDocumentID',
        rawMetadataValue: origDocIdMatch[1]
      };
    }
  }

  // 2. stRef:filePath (very common in Photoshop DerivedFrom)
  const filePathMatch = xmpText.match(/<[^:]+:filePath>([^<]+)<\/[^:]+:filePath>/i) 
    || xmpText.match(/(?:stRef|xmpMM):filePath=["']([^"']+)["']/i);
  if (filePathMatch) {
    const fn = extractCleanFilename(filePathMatch[1]);
    if (fn) {
      return {
        filename: fn,
        relativePath: filePathMatch[1].trim(),
        sourceType: 'xmp',
        metadataField: 'stRef:filePath',
        rawMetadataValue: filePathMatch[1]
      };
    }
  }

  // 3. crs:RawFileName (Lightroom / Adobe Camera Raw original file)
  const rawFileMatch = xmpText.match(/<[^:]+:RawFileName>([^<]+)<\/[^:]+:RawFileName>/i)
    || xmpText.match(/crs:RawFileName=["']([^"']+)["']/i);
  if (rawFileMatch) {
    const fn = extractCleanFilename(rawFileMatch[1]);
    if (fn) {
      return {
        filename: fn,
        relativePath: rawFileMatch[1].trim(),
        sourceType: 'xmp',
        metadataField: 'crs:RawFileName',
        rawMetadataValue: rawFileMatch[1]
      };
    }
  }

  // 4. xmp:Source or dc:source
  const sourceMatch = xmpText.match(/<[^:]+:source>([^<]+)<\/[^:]+:source>/i)
    || xmpText.match(/(?:xmp|dc):source=["']([^"']+)["']/i);
  if (sourceMatch) {
    const fn = extractCleanFilename(sourceMatch[1]);
    if (fn) {
      return {
        filename: fn,
        relativePath: sourceMatch[1].trim(),
        sourceType: 'xmp',
        metadataField: 'xmp:Source',
        rawMetadataValue: sourceMatch[1]
      };
    }
  }

  // 5. stRef:documentID if it contains a filename
  const docIdMatch = xmpText.match(/<[^:]+:documentID>([^<]+)<\/[^:]+:documentID>/i)
    || xmpText.match(/(?:stRef|xmpMM):documentID=["']([^"']+)["']/i);
  if (docIdMatch) {
    const fn = extractCleanFilename(docIdMatch[1]);
    if (fn && /\.(jpe?g|png|webp|tiff?|cr2|nef|raw)$/i.test(fn)) {
      return {
        filename: fn,
        relativePath: docIdMatch[1].trim(),
        sourceType: 'xmp',
        metadataField: 'xmpMM:documentID',
        rawMetadataValue: docIdMatch[1]
      };
    }
  }

  return null;
}

/**
 * Parse ComfyUI JSON data (from 'prompt' or 'workflow' metadata chunks or files)
 * Detects LoadImage, LoadImageMask, VHS_LoadImages, and any input image nodes.
 * Automatically extracts the relative path and clean filename,
 * prioritizing them over hardcoded absolute paths (like D:\...)
 */
export function parseComfyUiData(text: string, chunkName?: string): DetectedOriginalInfo | null {
  if (!text || typeof text !== 'string') return null;

  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') return null;

    const candidates: DetectedOriginalInfo[] = [];

    // Format 1: ComfyUI "prompt" graph object
    // Keyed by node IDs: { "10": { "class_type": "LoadImage", "inputs": { "image": "my_photo.png", ... } } }
    for (const [nodeId, nodeVal] of Object.entries(data)) {
      if (!nodeVal || typeof nodeVal !== 'object') continue;
      const node = nodeVal as {
        class_type?: string;
        inputs?: Record<string, any>;
        _meta?: { title?: string };
      };

      const classType = (node.class_type || '').toLowerCase();
      const nodeTitle = node._meta?.title || node.class_type || `Node #${nodeId}`;
      const isLoadImageNode =
        classType.includes('loadimage') ||
        classType.includes('image') ||
        classType.includes('input') ||
        classType.includes('source') ||
        nodeTitle.toLowerCase().includes('load image') ||
        nodeTitle.toLowerCase().includes('input image');

      if (node.inputs && typeof node.inputs === 'object') {
        const priorityKeys = ['image', 'image_path', 'filename', 'source_image', 'file_path', 'input_image', 'image_file'];

        for (const key of priorityKeys) {
          const val = node.inputs[key];
          if (typeof val === 'string' && val.trim().length > 0) {
            const parsed = extractRelativePathAndFilename(val);
            if (parsed) {
              const snippet = JSON.stringify({ [nodeId]: node }, null, 2);
              candidates.push({
                filename: parsed.filename,
                relativePath: parsed.relativePath,
                sourceType: 'comfyui-prompt',
                metadataField: `ComfyUI [Node #${nodeId}: ${node.class_type || 'LoadImage'} -> inputs.${key}]`,
                rawMetadataValue: val,
                comfyDetails: {
                  nodeId,
                  nodeType: node.class_type || 'LoadImage',
                  nodeTitle,
                  parameterName: `inputs.${key}`,
                  rawPath: val,
                  cleanPath: parsed.relativePath,
                  rawSnippet: snippet,
                }
              });
            }
          }
        }

        // Also check any other string value in inputs that ends with image extensions
        for (const [k, val] of Object.entries(node.inputs)) {
          if (priorityKeys.includes(k)) continue;
          if (typeof val === 'string' && /\.(jpe?g|png|webp|bmp|tiff?)$/i.test(val)) {
            const parsed = extractRelativePathAndFilename(val);
            if (parsed) {
              const snippet = JSON.stringify({ [nodeId]: node }, null, 2);
              candidates.push({
                filename: parsed.filename,
                relativePath: parsed.relativePath,
                sourceType: 'comfyui-prompt',
                metadataField: `ComfyUI [Node #${nodeId}: ${node.class_type || 'Custom'} -> inputs.${k}]`,
                rawMetadataValue: val,
                comfyDetails: {
                  nodeId,
                  nodeType: node.class_type || 'Custom',
                  nodeTitle,
                  parameterName: `inputs.${k}`,
                  rawPath: val,
                  cleanPath: parsed.relativePath,
                  rawSnippet: snippet,
                }
              });
            }
          }
        }
      }
    }

    // Format 2: ComfyUI "workflow" graph object
    // { "nodes": [ { "id": 10, "type": "LoadImage", "widgets_values": ["photo.png", "image"] } ] }
    if (Array.isArray((data as any).nodes)) {
      const nodes = (data as any).nodes as any[];
      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const nodeType = (node.type || '').toLowerCase();
        const nodeTitle = node.title || node.properties?.['Node name for S&R'] || node.type || `Node #${node.id}`;
        const isLoad = nodeType.includes('loadimage') || nodeType.includes('load') || nodeType.includes('input');

        if (Array.isArray(node.widgets_values)) {
          for (let idx = 0; idx < node.widgets_values.length; idx++) {
            const val = node.widgets_values[idx];
            if (typeof val === 'string' && (isLoad || /\.(jpe?g|png|webp|bmp|tiff?)$/i.test(val))) {
              const parsed = extractRelativePathAndFilename(val);
              if (parsed) {
                const snippet = JSON.stringify(node, null, 2);
                candidates.push({
                  filename: parsed.filename,
                  relativePath: parsed.relativePath,
                  sourceType: 'comfyui-workflow',
                  metadataField: `ComfyUI Workflow [Node #${node.id}: ${node.type} -> widget[${idx}]]`,
                  rawMetadataValue: val,
                  comfyDetails: {
                    nodeId: node.id,
                    nodeType: node.type,
                    nodeTitle,
                    parameterName: `widgets_values[${idx}]`,
                    rawPath: val,
                    cleanPath: parsed.relativePath,
                    rawSnippet: snippet,
                  }
                });
              }
            }
          }
        }
      }
    }

    if (candidates.length > 0) {
      // Prioritize nodes with class_type 'LoadImage' or parameter 'image'
      const best = candidates.find(c =>
        c.comfyDetails?.nodeType?.toLowerCase() === 'loadimage' ||
        c.comfyDetails?.parameterName === 'inputs.image'
      ) || candidates[0];

      return {
        ...best,
        allCandidates: candidates,
      };
    }
  } catch {
    // text wasn't valid JSON
  }

  return null;
}

/**
 * Scan arbitrary JSON text (e.g. from ComfyUI, Automatic1111, or custom tools)
 */
export function scanJsonForOriginalImage(text: string): DetectedOriginalInfo | null {
  if (!text) return null;

  // First try dedicated ComfyUI structure
  const comfyRes = parseComfyUiData(text);
  if (comfyRes) return comfyRes;

  // Patterns like "original_image": "abc.png" or "source_image": "abc.jpg"
  const patterns: { regex: RegExp; field: string }[] = [
    { regex: /"(?:original[_\s-]?image|original[_\s-]?file(?:name)?|original[_\s-]?path)"\s*:\s*"([^"]+)"/i, field: 'original_image' },
    { regex: /"(?:source[_\s-]?image|source[_\s-]?file|source)"\s*:\s*"([^"]+)"/i, field: 'source_image' },
    { regex: /"(?:before[_\s-]?image|before)"\s*:\s*"([^"]+)"/i, field: 'before_image' },
    { regex: /"(?:base[_\s-]?image|input[_\s-]?image|init[_\s-]?image)"\s*:\s*"([^"]+)"/i, field: 'input_image' },
    { regex: /"image"\s*:\s*"([^"]+\.(?:png|jpe?g|webp|bmp|gif))"/i, field: 'comfyui_image_node' },
  ];

  for (const { regex, field } of patterns) {
    const match = text.match(regex);
    if (match) {
      const fn = extractCleanFilename(match[1]);
      if (fn) {
        return {
          filename: fn,
          relativePath: match[1].trim(),
          sourceType: 'json',
          metadataField: field,
          rawMetadataValue: match[1]
        };
      }
    }
  }

  return null;
}

/**
 * Parse plain text key-value patterns (e.g. "Original: image.png")
 */
export function scanKeyValueForOriginalImage(text: string): DetectedOriginalInfo | null {
  if (!text) return null;

  const patterns: { regex: RegExp; field: string }[] = [
    { regex: /(?:original[_\s-]?image|original[_\s-]?file(?:name)?|original[_\s-]?path)\s*[:=]\s*["']?([^"'\r\n,;}{]+)["']?/i, field: 'Original Image' },
    { regex: /(?:source[_\s-]?image|source[_\s-]?file|source)\s*[:=]\s*["']?([^"'\r\n,;}{]+)["']?/i, field: 'Source Image' },
    { regex: /(?:before[_\s-]?image|before)\s*[:=]\s*["']?([^"'\r\n,;}{]+)["']?/i, field: 'Before Image' },
    { regex: /(?:base[_\s-]?image|input[_\s-]?image|init[_\s-]?image)\s*[:=]\s*["']?([^"'\r\n,;}{]+)["']?/i, field: 'Base Image' },
  ];

  for (const { regex, field } of patterns) {
    const match = text.match(regex);
    if (match) {
      const fn = extractCleanFilename(match[1]);
      if (fn) {
        return {
          filename: fn,
          relativePath: match[1].trim(),
          sourceType: 'comment',
          metadataField: field,
          rawMetadataValue: match[1]
        };
      }
    }
  }

  return null;
}

/**
 * Parse JPEG structure and extract EXIF / XMP / IPTC / COM
 */
export function parseJpegMetadata(view: DataView): DetectedOriginalInfo | null {
  const len = view.byteLength;
  if (len < 4) return null;

  // Check SOI marker: 0xFF, 0xD8
  if (view.getUint8(0) !== 0xFF || view.getUint8(1) !== 0xD8) {
    return null;
  }

  let offset = 2;
  while (offset + 4 <= len) {
    if (view.getUint8(offset) !== 0xFF) {
      offset++;
      continue;
    }

    const marker = view.getUint8(offset + 1);
    offset += 2;

    // Standalone markers
    if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) {
      continue;
    }

    if (offset + 2 > len) break;
    const segmentLength = view.getUint16(offset);
    if (segmentLength < 2 || offset + segmentLength > len) break;

    const segmentDataStart = offset + 2;
    const segmentDataLen = segmentLength - 2;

    // APP1 (0xE1): EXIF or XMP
    if (marker === 0xE1) {
      // Check XMP: starts with "http://ns.adobe.com/xap/1.0/\0"
      if (segmentDataLen >= 29) {
        const headerBytes = new Uint8Array(view.buffer, view.byteOffset + segmentDataStart, 28);
        const headerStr = decodeAsciiOrUtf8(headerBytes);
        if (headerStr.startsWith('http://ns.adobe.com/xap/1.0/')) {
          const xmpBytes = new Uint8Array(view.buffer, view.byteOffset + segmentDataStart + 29, segmentDataLen - 29);
          const xmpText = decodeAsciiOrUtf8(xmpBytes);
          const found = parseXmpString(xmpText);
          if (found) return found;
        }
      }

      // Check EXIF: starts with "Exif\0\0"
      if (segmentDataLen >= 6) {
        const exifHeader = new Uint8Array(view.buffer, view.byteOffset + segmentDataStart, 6);
        if (exifHeader[0] === 0x45 && exifHeader[1] === 0x78 && exifHeader[2] === 0x69 && exifHeader[3] === 0x66 && exifHeader[4] === 0 && exifHeader[5] === 0) {
          const tiffStart = segmentDataStart + 6;
          const exifInfo = parseTiffExif(view, tiffStart, segmentDataLen - 6);
          if (exifInfo) return exifInfo;
        }
      }
    }

    // APP13 (0xED): Photoshop IRB / IPTC
    if (marker === 0xED && segmentDataLen > 14) {
      const bytes = new Uint8Array(view.buffer, view.byteOffset + segmentDataStart, segmentDataLen);
      const text = decodeAsciiOrUtf8(bytes);
      const kv = scanKeyValueForOriginalImage(text) || scanJsonForOriginalImage(text);
      if (kv) {
        return { ...kv, sourceType: 'iptc' };
      }
    }

    // COM (0xFE): Comment
    if (marker === 0xFE && segmentDataLen > 0) {
      const bytes = new Uint8Array(view.buffer, view.byteOffset + segmentDataStart, segmentDataLen);
      const comment = decodeAsciiOrUtf8(bytes);
      const kv = scanKeyValueForOriginalImage(comment) || scanJsonForOriginalImage(comment);
      if (kv) {
        return { ...kv, sourceType: 'comment' };
      }
      const fn = extractCleanFilename(comment);
      if (fn) {
        return {
          filename: fn,
          relativePath: comment.trim(),
          sourceType: 'comment',
          metadataField: 'JPEG Comment',
          rawMetadataValue: comment
        };
      }
    }

    // Stop before scan data
    if (marker === 0xDA) break;

    offset += segmentLength;
  }

  return null;
}

/**
 * Parse TIFF IFD EXIF data
 */
function parseTiffExif(view: DataView, tiffStart: number, tiffLen: number): DetectedOriginalInfo | null {
  if (tiffLen < 8) return null;
  const isLE = view.getUint16(tiffStart) === 0x4949; // 'II' vs 'MM'
  const tag42 = view.getUint16(tiffStart + 2, isLE);
  if (tag42 !== 42) return null;

  const firstIfdOffset = view.getUint32(tiffStart + 4, isLE);
  if (firstIfdOffset < 8 || firstIfdOffset >= tiffLen) return null;

  let ifdOffset = tiffStart + firstIfdOffset;
  if (ifdOffset + 2 > tiffStart + tiffLen) return null;

  const numEntries = view.getUint16(ifdOffset, isLE);
  ifdOffset += 2;

  for (let i = 0; i < numEntries; i++) {
    const entryOffset = ifdOffset + i * 12;
    if (entryOffset + 12 > tiffStart + tiffLen) break;

    const tag = view.getUint16(entryOffset, isLE);
    const type = view.getUint16(entryOffset + 2, isLE);
    const count = view.getUint32(entryOffset + 4, isLE);

    // Tags that can contain original filename/path/comment:
    // 0x010E: ImageDescription
    // 0x010D: DocumentName
    // 0x0131: Software
    // 0x9286: UserComment
    // 0x9C9C: XPComment
    // 0x9C9E: XPKeywords
    // 0x02BC: ApplicationNotes (embedded XMP)
    if ([0x010E, 0x010D, 0x0131, 0x9286, 0x9C9C, 0x9C9E, 0x02BC].includes(tag)) {
      let strVal = '';
      if (type === 2 || type === 1 || type === 7) { // ASCII / BYTE / UNDEFINED
        let valOffset = entryOffset + 8;
        if (count > 4) {
          const off = view.getUint32(entryOffset + 8, isLE);
          valOffset = tiffStart + off;
        }

        if (valOffset + count <= tiffStart + tiffLen) {
          const bytes = new Uint8Array(view.buffer, view.byteOffset + valOffset, count);
          strVal = decodeAsciiOrUtf8(bytes);
        }
      }

      if (strVal) {
        // If tag is 0x02BC (XMP)
        if (tag === 0x02BC) {
          const xmpRes = parseXmpString(strVal);
          if (xmpRes) return xmpRes;
        }

        // Try XMP if it contains XML
        if (strVal.includes('<x:xmpmeta') || strVal.includes('<rdf:RDF')) {
          const xmpRes = parseXmpString(strVal);
          if (xmpRes) return xmpRes;
        }

        // Try JSON
        const jsonRes = scanJsonForOriginalImage(strVal);
        if (jsonRes) return jsonRes;

        // Try key-value
        const kvRes = scanKeyValueForOriginalImage(strVal);
        if (kvRes) return kvRes;

        // Direct filename check for ImageDescription or DocumentName
        if (tag === 0x010E || tag === 0x010D) {
          const fn = extractCleanFilename(strVal);
          if (fn) {
            return {
              filename: fn,
              relativePath: strVal.trim(),
              sourceType: 'exif',
              metadataField: tag === 0x010D ? 'DocumentName' : 'ImageDescription',
              rawMetadataValue: strVal
            };
          }
        }
      }
    }
  }

  return null;
}

/**
 * Parse PNG chunk structures (tEXt, iTXt, zTXt, eXIf)
 */
export async function parsePngMetadata(view: DataView): Promise<DetectedOriginalInfo | null> {
  const len = view.byteLength;
  if (len < 8) return null;

  // Check PNG signature: 89 50 4E 47 0D 0A 1A 0A
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (let i = 0; i < 8; i++) {
    if (view.getUint8(i) !== sig[i]) return null;
  }

  let offset = 8;
  while (offset + 8 <= len) {
    const chunkLength = view.getUint32(offset);
    offset += 4;
    const chunkTypeBytes = new Uint8Array(view.buffer, view.byteOffset + offset, 4);
    const chunkType = String.fromCharCode(...chunkTypeBytes);
    offset += 4;

    if (offset + chunkLength > len) break;

    // tEXt chunk: Keyword \0 Text
    if (chunkType === 'tEXt') {
      const dataBytes = new Uint8Array(view.buffer, view.byteOffset + offset, chunkLength);
      let nullIdx = dataBytes.indexOf(0);
      if (nullIdx !== -1) {
        const keyword = decodeAsciiOrUtf8(dataBytes.subarray(0, nullIdx));
        const text = decodeAsciiOrUtf8(dataBytes.subarray(nullIdx + 1));

        // Check if keyword is ComfyUI prompt or workflow
        const kwLower = keyword.toLowerCase();
        if (kwLower === 'prompt' || kwLower === 'workflow') {
          const comfyFound = parseComfyUiData(text, keyword);
          if (comfyFound) return comfyFound;
        }

        // Check if keyword is XML:com.adobe.xmp
        if (keyword.toLowerCase().includes('xmp')) {
          const found = parseXmpString(text);
          if (found) return found;
        }

        // Check if keyword relates to original/source/before
        if (
          kwLower.includes('original') || 
          kwLower.includes('source') || 
          kwLower.includes('before') || 
          kwLower.includes('base') ||
          kwLower.includes('parent')
        ) {
          const fn = extractCleanFilename(text);
          if (fn) {
            return {
              filename: fn,
              relativePath: text.trim(),
              sourceType: 'png-chunk',
              metadataField: keyword,
              rawMetadataValue: text
            };
          }
        }

        // Check content via JSON or key-value or XMP
        const found = scanJsonForOriginalImage(text) || scanKeyValueForOriginalImage(text) || parseXmpString(text);
        if (found) return { ...found, sourceType: 'png-chunk', metadataField: `${keyword}: ${found.metadataField}` };
      }
    }

    // iTXt chunk: Keyword \0 compFlag compMethod langTag transKeyword \0 Text
    if (chunkType === 'iTXt') {
      const dataBytes = new Uint8Array(view.buffer, view.byteOffset + offset, chunkLength);
      const nullIdx = dataBytes.indexOf(0);
      if (nullIdx !== -1) {
        const keyword = decodeAsciiOrUtf8(dataBytes.subarray(0, nullIdx));
        const compFlag = dataBytes[nullIdx + 1];
        
        let textStart = nullIdx + 3; // skip flag and compMethod
        // skip lang tag
        while (textStart < dataBytes.length && dataBytes[textStart] !== 0) textStart++;
        textStart++; // skip null
        // skip translated keyword
        while (textStart < dataBytes.length && dataBytes[textStart] !== 0) textStart++;
        textStart++; // skip null

        if (textStart < dataBytes.length) {
          let text = '';
          if (compFlag === 1) {
            // Compressed text
            try {
              if (typeof DecompressionStream !== 'undefined') {
                const ds = new DecompressionStream('deflate');
                const writer = ds.writable.getWriter();
                writer.write(dataBytes.subarray(textStart));
                writer.close();
                const decompressed = await new Response(ds.readable).arrayBuffer();
                text = decodeAsciiOrUtf8(new Uint8Array(decompressed));
              }
            } catch {
              // fallback
            }
          } else {
            text = decodeAsciiOrUtf8(dataBytes.subarray(textStart));
          }

          if (text) {
            const kwLower = keyword.toLowerCase();
            if (kwLower === 'prompt' || kwLower === 'workflow') {
              const comfyFound = parseComfyUiData(text, keyword);
              if (comfyFound) return comfyFound;
            }

            if (kwLower.includes('xmp') || text.includes('<x:xmpmeta')) {
              const found = parseXmpString(text);
              if (found) return found;
            }

            if (
              kwLower.includes('original') || 
              kwLower.includes('source') || 
              kwLower.includes('before') || 
              kwLower.includes('base')
            ) {
              const fn = extractCleanFilename(text);
              if (fn) {
                return {
                  filename: fn,
                  relativePath: text.trim(),
                  sourceType: 'png-chunk',
                  metadataField: keyword,
                  rawMetadataValue: text
                };
              }
            }

            const found = scanJsonForOriginalImage(text) || scanKeyValueForOriginalImage(text);
            if (found) return { ...found, sourceType: 'png-chunk', metadataField: `${keyword}: ${found.metadataField}` };
          }
        }
      }
    }

    // eXIf chunk: raw EXIF TIFF header
    if (chunkType === 'eXIf') {
      const exifInfo = parseTiffExif(view, offset, chunkLength);
      if (exifInfo) return exifInfo;
    }

    if (chunkType === 'IEND') break;

    offset += chunkLength + 4; // skip data and 4-byte CRC
  }

  return null;
}

/**
 * Parse WebP RIFF chunks for EXIF or XMP
 */
export function parseWebpMetadata(view: DataView): DetectedOriginalInfo | null {
  const len = view.byteLength;
  if (len < 12) return null;

  const riff = decodeAsciiOrUtf8(new Uint8Array(view.buffer, view.byteOffset, 4));
  const webp = decodeAsciiOrUtf8(new Uint8Array(view.buffer, view.byteOffset + 8, 4));
  if (riff !== 'RIFF' || webp !== 'WEBP') return null;

  let offset = 12;
  while (offset + 8 <= len) {
    const chunkType = decodeAsciiOrUtf8(new Uint8Array(view.buffer, view.byteOffset + offset, 4));
    const chunkSize = view.getUint32(offset + 4, true);
    offset += 8;

    if (offset + chunkSize > len) break;

    if (chunkType === 'XMP ') {
      const xmpText = decodeAsciiOrUtf8(new Uint8Array(view.buffer, view.byteOffset + offset, chunkSize));
      const found = parseXmpString(xmpText);
      if (found) return found;
    }

    if (chunkType === 'EXIF') {
      const exifInfo = parseTiffExif(view, offset, chunkSize);
      if (exifInfo) return exifInfo;
    }

    offset += chunkSize + (chunkSize % 2); // padded to even bytes
  }

  return null;
}

/**
 * Universal binary / string scanner:
 * Checks the whole file buffer (up to first 5MB) for XMP, JSON, or key-value patterns
 */
export function scanBinaryBuffer(buffer: ArrayBuffer): DetectedOriginalInfo | null {
  const maxScan = Math.min(buffer.byteLength, 5 * 1024 * 1024);
  const bytes = new Uint8Array(buffer, 0, maxScan);
  const text = decodeAsciiOrUtf8(bytes);

  // 1. Check for XMP packet
  if (text.includes('xmpMM:') || text.includes('stRef:') || text.includes('<x:xmpmeta') || text.includes('RawFileName')) {
    const xmpRes = parseXmpString(text);
    if (xmpRes) return { ...xmpRes, sourceType: 'binary-scan' };
  }

  // 2. Check for JSON keys
  const jsonRes = scanJsonForOriginalImage(text);
  if (jsonRes) return { ...jsonRes, sourceType: 'binary-scan' };

  // 3. Check for key-values
  const kvRes = scanKeyValueForOriginalImage(text);
  if (kvRes) return { ...kvRes, sourceType: 'binary-scan' };

  return null;
}

/**
 * Filename deduction fallback:
 * If an AFTER image is named `foo_after.png`, `foo-after.jpg`, `after_foo.png`, `foo_result.png`, `foo_upscaled.png`, etc.
 */
export function deduceOriginalFromFilename(filename: string): DetectedOriginalInfo | null {
  if (!filename) return null;

  // Patterns like `something_after.ext`, `something-after.ext`, `something_AFTER.ext`
  const afterSuffixRegex = /^(.+?)[_-](?:after|sau|edited|edit|upscaled|upscale|v2|result|processed|remix)\.([a-zA-Z0-9]+)$/i;
  const afterPrefixRegex = /^(?:after|sau)[_-](.+?)\.([a-zA-Z0-9]+)$/i;

  const matchSuffix = filename.match(afterSuffixRegex);
  if (matchSuffix) {
    const baseName = matchSuffix[1];
    const ext = matchSuffix[2];
    return {
      filename: `${baseName}.${ext}`,
      sourceType: 'filename-convention',
      metadataField: 'Filename convention (after suffix removed)',
      rawMetadataValue: filename
    };
  }

  const matchPrefix = filename.match(afterPrefixRegex);
  if (matchPrefix) {
    const baseName = matchPrefix[1];
    const ext = matchPrefix[2];
    return {
      filename: `${baseName}.${ext}`,
      sourceType: 'filename-convention',
      metadataField: 'Filename convention (after prefix removed)',
      rawMetadataValue: filename
    };
  }

  return null;
}

/**
 * Main function to extract original image information from any image File / Blob
 */
export async function extractOriginalImageInfo(file: File | Blob): Promise<DetectedOriginalInfo | null> {
  try {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);

    // 1. Try JPEG
    const jpegRes = parseJpegMetadata(view);
    if (jpegRes) return jpegRes;

    // 2. Try PNG
    const pngRes = await parsePngMetadata(view);
    if (pngRes) return pngRes;

    // 3. Try WebP
    const webpRes = parseWebpMetadata(view);
    if (webpRes) return webpRes;

    // 4. Universal binary text scan (covers other formats, custom headers, TIFF, etc.)
    const binaryRes = scanBinaryBuffer(buffer);
    if (binaryRes) return binaryRes;

    // 5. Filename deduction fallback if file is a File object with a name
    if ('name' in file && file.name) {
      const nameDeduction = deduceOriginalFromFilename(file.name);
      if (nameDeduction) return nameDeduction;
    }
  } catch (err) {
    console.warn('Error reading image metadata:', err);
  }

  // Final fallback: filename deduction if available
  if ('name' in file && file.name) {
    return deduceOriginalFromFilename(file.name);
  }

  return null;
}
