/**
 * AI Image Metadata Extractor
 * Parses generation parameters from ComfyUI, Automatic1111, WebUI Forge, Fooocus, InvokeAI,
 * Midjourney, and standard EXIF/XMP/PNG chunks.
 */

export type GenerationType = 'text2img' | 'img2img' | 'img2video' | 'text2video' | 'inpaint' | 'upscale';

export interface AIMetadata {
  generationType?: GenerationType;
  prompt?: string;
  negativePrompt?: string;
  seed?: string | number;
  model?: string;
  checkpointModel?: string;
  sampler?: string;
  scheduler?: string;
  cfgScale?: number;
  steps?: number;
  denoise?: number;
  dimensions?: string;
  loras?: { name: string; strength?: number }[];
  software?: string;
  rawParameters?: string;
  otherParams?: Record<string, string | number>;
  sourceImageFilename?: string;
}

/**
 * Decode text from bytes safely
 */
function decodeText(bytes: Uint8Array): string {
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
 * Parse A1111 / WebUI / Forge / Fooocus "parameters" text block
 */
export function parseA1111Parameters(text: string): AIMetadata {
  const result: AIMetadata = {
    software: 'Automatic1111 / WebUI',
    rawParameters: text.trim(),
  };

  if (!text || typeof text !== 'string') return result;

  let remaining = text.trim();

  // 1. Separate Prompt, Negative Prompt, and Parameters line
  // Common separator: "Negative prompt: " and "Steps: "
  const negMarker = 'Negative prompt:';
  const stepsMarker = 'Steps:';

  const negIndex = remaining.indexOf(negMarker);
  const stepsIndex = remaining.lastIndexOf(stepsMarker);

  if (negIndex !== -1) {
    result.prompt = remaining.substring(0, negIndex).trim();

    if (stepsIndex !== -1 && stepsIndex > negIndex) {
      result.negativePrompt = remaining.substring(negIndex + negMarker.length, stepsIndex).trim();
      remaining = remaining.substring(stepsIndex);
    } else {
      result.negativePrompt = remaining.substring(negIndex + negMarker.length).trim();
      remaining = '';
    }
  } else if (stepsIndex !== -1) {
    result.prompt = remaining.substring(0, stepsIndex).trim();
    remaining = remaining.substring(stepsIndex);
  } else {
    // Check if entire text is a prompt or single line
    result.prompt = remaining;
    remaining = '';
  }

  // 2. Extract LoRA references from prompt: <lora:name:weight>
  if (result.prompt) {
    const loraRegex = /<lora:([^:>]+)(?::([^>]+))?>/gi;
    const loras: { name: string; strength?: number }[] = [];
    let match: RegExpExecArray | null;
    while ((match = loraRegex.exec(result.prompt)) !== null) {
      loras.push({
        name: match[1].trim(),
        strength: match[2] ? parseFloat(match[2]) : 1.0,
      });
    }
    if (loras.length > 0) {
      result.loras = loras;
    }
  }

  // 3. Parse comma-separated key-value pairs in parameters line
  // e.g.: "Steps: 30, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 1234567890, Size: 1024x1024, Model: juggernautXL_v9, Denoising strength: 0.35"
  if (remaining) {
    const otherParams: Record<string, string | number> = {};
    const tokens = remaining.split(/,\s*(?=[A-Za-z\s_-]+:)/);

    for (const token of tokens) {
      const colonIdx = token.indexOf(':');
      if (colonIdx === -1) continue;

      const key = token.substring(0, colonIdx).trim().toLowerCase();
      const val = token.substring(colonIdx + 1).trim();

      switch (key) {
        case 'steps':
          result.steps = parseInt(val, 10) || undefined;
          break;
        case 'sampler':
          result.sampler = val;
          break;
        case 'cfg scale':
        case 'cfg':
        case 'guidance':
          result.cfgScale = parseFloat(val) || undefined;
          break;
        case 'seed':
          result.seed = val;
          break;
        case 'size':
          result.dimensions = val;
          break;
        case 'model':
        case 'checkpoint':
          result.checkpointModel = val;
          result.model = val;
          break;
        case 'model hash':
          otherParams['Model Hash'] = val;
          break;
        case 'denoising strength':
        case 'denoise':
          result.denoise = parseFloat(val) || undefined;
          break;
        case 'schedule type':
        case 'scheduler':
          result.scheduler = val;
          break;
        default:
          if (key.length > 0 && val.length > 0) {
            otherParams[token.substring(0, colonIdx).trim()] = val;
          }
          break;
      }
    }

    if (Object.keys(otherParams).length > 0) {
      result.otherParams = otherParams;
    }
  }

  // Deduce Generation Type
  if (text.includes('AnimateDiff') || text.includes('Video') || text.includes('Frame count:')) {
    result.generationType = text.includes('Initial image:') ? 'img2video' : 'text2video';
  } else if (text.includes('Mask blur:') || text.includes('Inpaint')) {
    result.generationType = 'inpaint';
  } else if (text.includes('Ultimate SD Upscale') || text.includes('Hires upscaler:')) {
    result.generationType = 'upscale';
  } else if (result.denoise !== undefined && result.denoise < 1.0) {
    result.generationType = 'img2img';
  } else {
    result.generationType = 'text2img';
  }

  return result;
}

/**
 * Parse ComfyUI Prompt graph or Workflow JSON
 */
export function parseComfyUiPrompt(jsonString: string): AIMetadata | null {
  try {
    const data = JSON.parse(jsonString);
    if (!data || typeof data !== 'object') return null;

    const result: AIMetadata = {
      software: 'ComfyUI',
      rawParameters: jsonString,
      loras: [],
      otherParams: {},
    };

    // Case 1: Prompt structure: { "1": { "class_type": "...", "inputs": {...} }, ... }
    const nodes = data;

    // Helper to find a text string from node ID or object
    const findTextFromNode = (targetIdOrObj: any, visited = new Set<string>()): string => {
      if (!targetIdOrObj) return '';
      let targetNodeId: string = '';

      if (Array.isArray(targetIdOrObj) && targetIdOrObj.length > 0) {
        targetNodeId = String(targetIdOrObj[0]);
      } else if (typeof targetIdOrObj === 'string' || typeof targetIdOrObj === 'number') {
        targetNodeId = String(targetIdOrObj);
      }

      if (!targetNodeId || visited.has(targetNodeId)) return '';
      visited.add(targetNodeId);

      const targetNode = nodes[targetNodeId];
      if (!targetNode || !targetNode.inputs) return '';

      // Direct text inputs
      if (typeof targetNode.inputs.text === 'string') {
        return targetNode.inputs.text;
      }
      if (typeof targetNode.inputs.text_g === 'string' || typeof targetNode.inputs.text_l === 'string') {
        return [targetNode.inputs.text_g, targetNode.inputs.text_l].filter(Boolean).join(' | ');
      }
      if (typeof targetNode.inputs.prompt === 'string') {
        return targetNode.inputs.prompt;
      }

      // Check if node has inputs that point to another text node (e.g. PrimitiveNode, TextConcatenate)
      for (const val of Object.values(targetNode.inputs)) {
        if (Array.isArray(val) && val.length > 0) {
          const subText = findTextFromNode(val[0], visited);
          if (subText) return subText;
        }
      }

      return '';
    };

    // Scan nodes for Key Generative Components
    for (const [nodeId, nodeVal] of Object.entries(nodes)) {
      if (!nodeVal || typeof nodeVal !== 'object') continue;
      const node = nodeVal as any;
      const classType = String(node.class_type || '').toLowerCase();
      const inputs = node.inputs || {};

      // Checkpoint Loader
      if (
        classType.includes('checkpointloadersimple') ||
        classType.includes('checkpointloader') ||
        classType.includes('unetloader')
      ) {
        const ckpt = inputs.ckpt_name || inputs.unet_name || inputs.model_name;
        if (typeof ckpt === 'string' && ckpt) {
          result.checkpointModel = ckpt;
          result.model = ckpt;
        }
      }

      // LoRA Loader
      if (classType.includes('loraloader')) {
        const loraName = inputs.lora_name;
        const strength = inputs.strength_model ?? inputs.strength ?? 1.0;
        if (typeof loraName === 'string' && loraName) {
          result.loras!.push({
            name: loraName,
            strength: typeof strength === 'number' ? strength : parseFloat(strength) || 1.0,
          });
        }
      }

      // KSampler / KSamplerAdvanced
      if (classType.includes('ksampler')) {
        if (inputs.seed !== undefined) result.seed = inputs.seed;
        if (inputs.noise_seed !== undefined) result.seed = inputs.noise_seed;
        if (inputs.steps !== undefined) result.steps = parseInt(inputs.steps, 10);
        if (inputs.cfg !== undefined) result.cfgScale = parseFloat(inputs.cfg);
        if (inputs.sampler_name !== undefined) result.sampler = String(inputs.sampler_name);
        if (inputs.scheduler !== undefined) result.scheduler = String(inputs.scheduler);
        if (inputs.denoise !== undefined) result.denoise = parseFloat(inputs.denoise);

        // Positive prompt reference
        if (!result.prompt && inputs.positive) {
          result.prompt = findTextFromNode(inputs.positive);
        }

        // Negative prompt reference
        if (!result.negativePrompt && inputs.negative) {
          result.negativePrompt = findTextFromNode(inputs.negative);
        }
      }

      // FLUX Sampler (SamplerCustomAdvanced or FluxGuidance)
      if (classType.includes('fluxguidance')) {
        if (inputs.guidance !== undefined) {
          result.cfgScale = parseFloat(inputs.guidance);
          result.otherParams!['Flux Guidance'] = inputs.guidance;
        }
      }

      // Empty Latent Image (Dimensions)
      if (classType.includes('emptylatentimage')) {
        if (inputs.width && inputs.height) {
          result.dimensions = `${inputs.width}x${inputs.height}`;
        }
      }

      // Source / Original Image loader
      if (classType.includes('loadimage')) {
        if (inputs.image && typeof inputs.image === 'string') {
          result.sourceImageFilename = inputs.image;
        }
      }
    }

    // Fallback search for positive/negative text if KSampler didn't link directly
    if (!result.prompt) {
      for (const nodeVal of Object.values(nodes)) {
        if (!nodeVal || typeof nodeVal !== 'object') continue;
        const node = nodeVal as any;
        const title = String(node._meta?.title || node.class_type || '').toLowerCase();
        if (title.includes('positive') && node.inputs?.text) {
          result.prompt = node.inputs.text;
          break;
        }
      }
    }

    if (!result.negativePrompt) {
      for (const nodeVal of Object.values(nodes)) {
        if (!nodeVal || typeof nodeVal !== 'object') continue;
        const node = nodeVal as any;
        const title = String(node._meta?.title || node.class_type || '').toLowerCase();
        if (title.includes('negative') && node.inputs?.text) {
          result.negativePrompt = node.inputs.text;
          break;
        }
      }
    }

    // Check if any useful fields were found
    if (
      result.prompt ||
      result.negativePrompt ||
      result.checkpointModel ||
      result.seed !== undefined ||
      result.sampler ||
      (result.loras && result.loras.length > 0)
    ) {
      // Deduce ComfyUI Generation Type
      let hasVideoNode = false;
      let hasInpaintNode = false;
      let hasUpscaleNode = false;
      let hasInputImage = Boolean(result.sourceImageFilename);

      for (const nodeVal of Object.values(nodes)) {
        if (!nodeVal || typeof nodeVal !== 'object') continue;
        const node = nodeVal as any;
        const classType = String(node.class_type || '').toLowerCase();

        if (
          classType.includes('animatediff') ||
          classType.includes('videocombine') ||
          classType.includes('svd') ||
          classType.includes('wanvideo') ||
          classType.includes('cogvideo') ||
          classType.includes('hunyuanvideo') ||
          classType.includes('ltx') ||
          classType.includes('vhs_')
        ) {
          hasVideoNode = true;
        }

        if (
          classType.includes('inpaint') ||
          classType.includes('setlatentnoisemask') ||
          classType.includes('masktoimage') ||
          classType.includes('vaeencodeformask')
        ) {
          hasInpaintNode = true;
        }

        if (
          classType.includes('upscalewithmodel') ||
          classType.includes('ultimatesdupscale') ||
          classType.includes('upscalemodel')
        ) {
          hasUpscaleNode = true;
        }

        if (classType.includes('loadimage') || classType.includes('loadvideo')) {
          hasInputImage = true;
        }
      }

      if (hasVideoNode) {
        result.generationType = hasInputImage ? 'img2video' : 'text2video';
      } else if (hasInpaintNode) {
        result.generationType = 'inpaint';
      } else if (hasUpscaleNode) {
        result.generationType = 'upscale';
      } else if (hasInputImage || (result.denoise !== undefined && result.denoise < 1.0)) {
        result.generationType = 'img2img';
      } else {
        result.generationType = 'text2img';
      }

      return result;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract AI Generation Metadata from File or Blob
 */
export async function extractAIMetadata(file: File | Blob): Promise<AIMetadata | null> {
  try {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    const len = buffer.byteLength;

    // 1. Check PNG signature (89 50 4E 47 0D 0A 1A 0A)
    const isPng =
      len >= 8 &&
      view.getUint8(0) === 0x89 &&
      view.getUint8(1) === 0x50 &&
      view.getUint8(2) === 0x4e &&
      view.getUint8(3) === 0x47;

    if (isPng) {
      let offset = 8;
      let comfyPrompt: string | null = null;
      let comfyWorkflow: string | null = null;
      let a1111Params: string | null = null;

      while (offset + 8 <= len) {
        const chunkLength = view.getUint32(offset);
        offset += 4;
        const chunkTypeBytes = new Uint8Array(buffer, offset, 4);
        const chunkType = String.fromCharCode(...chunkTypeBytes);
        offset += 4;

        if (offset + chunkLength > len) break;

        // tEXt chunk
        if (chunkType === 'tEXt') {
          const dataBytes = new Uint8Array(buffer, offset, chunkLength);
          const nullIdx = dataBytes.indexOf(0);
          if (nullIdx !== -1) {
            const keyword = decodeText(dataBytes.subarray(0, nullIdx)).toLowerCase();
            const text = decodeText(dataBytes.subarray(nullIdx + 1));

            if (keyword === 'parameters') {
              a1111Params = text;
            } else if (keyword === 'prompt') {
              comfyPrompt = text;
            } else if (keyword === 'workflow') {
              comfyWorkflow = text;
            }
          }
        }

        // iTXt chunk
        if (chunkType === 'iTXt') {
          const dataBytes = new Uint8Array(buffer, offset, chunkLength);
          const nullIdx = dataBytes.indexOf(0);
          if (nullIdx !== -1) {
            const keyword = decodeText(dataBytes.subarray(0, nullIdx)).toLowerCase();
            const compFlag = dataBytes[nullIdx + 1];

            let textStart = nullIdx + 3;
            while (textStart < dataBytes.length && dataBytes[textStart] !== 0) textStart++;
            textStart++;
            while (textStart < dataBytes.length && dataBytes[textStart] !== 0) textStart++;
            textStart++;

            if (textStart < dataBytes.length) {
              let text = '';
              if (compFlag === 1) {
                try {
                  if (typeof DecompressionStream !== 'undefined') {
                    const ds = new DecompressionStream('deflate');
                    const writer = ds.writable.getWriter();
                    writer.write(dataBytes.subarray(textStart));
                    writer.close();
                    const decompressed = await new Response(ds.readable).arrayBuffer();
                    text = decodeText(new Uint8Array(decompressed));
                  }
                } catch {
                  // Ignore decompression failure
                }
              } else {
                text = decodeText(dataBytes.subarray(textStart));
              }

              if (text) {
                if (keyword === 'parameters') {
                  a1111Params = text;
                } else if (keyword === 'prompt') {
                  comfyPrompt = text;
                } else if (keyword === 'workflow') {
                  comfyWorkflow = text;
                }
              }
            }
          }
        }

        if (chunkType === 'IEND') break;
        offset += chunkLength + 4; // skip data & CRC
      }

      // Prioritize ComfyUI prompt if available
      if (comfyPrompt) {
        const parsed = parseComfyUiPrompt(comfyPrompt);
        if (parsed) return parsed;
      }
      if (comfyWorkflow) {
        const parsed = parseComfyUiPrompt(comfyWorkflow);
        if (parsed) return parsed;
      }
      if (a1111Params) {
        return parseA1111Parameters(a1111Params);
      }
    }

    // 2. Check JPEG (SOI marker 0xFF 0xD8)
    const isJpeg = len >= 2 && view.getUint8(0) === 0xff && view.getUint8(1) === 0xd8;
    if (isJpeg) {
      let offset = 2;
      while (offset + 4 <= len) {
        if (view.getUint8(offset) !== 0xff) {
          offset++;
          continue;
        }

        const marker = view.getUint8(offset + 1);
        offset += 2;

        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (offset + 2 > len) break;

        const segmentLength = view.getUint16(offset);
        if (segmentLength < 2 || offset + segmentLength > len) break;

        const segmentDataStart = offset + 2;
        const segmentDataLen = segmentLength - 2;

        // COM marker (Comment)
        if (marker === 0xfe) {
          const bytes = new Uint8Array(buffer, segmentDataStart, segmentDataLen);
          const text = decodeText(bytes);
          if (text.includes('Steps:') || text.includes('Negative prompt:')) {
            return parseA1111Parameters(text);
          }
          const comfy = parseComfyUiPrompt(text);
          if (comfy) return comfy;
        }

        // APP1 (EXIF / XMP)
        if (marker === 0xe1 && segmentDataLen > 6) {
          const bytes = new Uint8Array(buffer, segmentDataStart, segmentDataLen);
          const text = decodeText(bytes);

          if (text.includes('Steps:') && (text.includes('Sampler:') || text.includes('Seed:'))) {
            return parseA1111Parameters(text);
          }
          if (text.includes('"class_type"') && text.includes('"inputs"')) {
            const comfy = parseComfyUiPrompt(text);
            if (comfy) return comfy;
          }
        }

        if (marker === 0xda) break; // SOS
        offset += segmentLength;
      }
    }

    // 3. Fallback binary scan for parameters string or ComfyUI JSON (first 5MB)
    const maxScan = Math.min(len, 4 * 1024 * 1024);
    const textScan = decodeText(new Uint8Array(buffer, 0, maxScan));

    if (textScan.includes('Steps:') && (textScan.includes('Sampler:') || textScan.includes('Seed:'))) {
      const stepsIdx = textScan.indexOf('Steps:');
      // Look back for beginning of prompt
      const promptStart = Math.max(0, textScan.lastIndexOf('\0', stepsIdx));
      const chunk = textScan.substring(promptStart, stepsIdx + 500);
      return parseA1111Parameters(chunk.replace(/^\0+/, ''));
    }

    if (textScan.includes('"class_type"') && textScan.includes('"inputs"')) {
      const startIdx = textScan.indexOf('{"');
      if (startIdx !== -1) {
        const jsonCandidate = textScan.substring(startIdx);
        const parsed = parseComfyUiPrompt(jsonCandidate);
        if (parsed) return parsed;
      }
    }
  } catch (err) {
    console.warn('Error extracting AI metadata:', err);
  }

  return null;
}
