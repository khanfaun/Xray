import React, { useState, useEffect } from 'react';
import { LayerData } from '../types';
import { extractAIMetadata, AIMetadata } from '../utils/aiMetadataExtractor';
import { 
  Sparkles, Copy, Check, Cpu, Hash, Sliders, Layers, 
  ChevronDown, ChevronRight, FileText, Info, Code2, Box, Eye
} from 'lucide-react';

interface MetadataSidebarProps {
  layers: LayerData[];
  activeLayerIndex: number;
  isOpen: boolean;
  onToggle: () => void;
}

export default function MetadataSidebar({
  layers,
  activeLayerIndex,
  isOpen,
  onToggle,
}: MetadataSidebarProps) {
  const [selectedLayerId, setSelectedLayerId] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [metadata, setMetadata] = useState<AIMetadata | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showRawParams, setShowRawParams] = useState<boolean>(false);

  // Auto-select initial layer (prefer layer with index 1 / after layer or active layer)
  useEffect(() => {
    if (layers.length === 0) return;
    if (!selectedLayerId || !layers.some((l) => l.id === selectedLayerId)) {
      // If there's an after layer (index 1), select it; otherwise activeLayerIndex or layer 0
      const targetLayer = layers[1] || layers[activeLayerIndex] || layers[0];
      if (targetLayer) setSelectedLayerId(targetLayer.id);
    }
  }, [layers, activeLayerIndex, selectedLayerId]);

  const currentLayer = layers.find((l) => l.id === selectedLayerId) || layers[activeLayerIndex] || layers[0];

  // Extract metadata whenever selected layer changes
  useEffect(() => {
    let isMounted = true;
    if (!currentLayer || !(currentLayer.blob instanceof Blob)) {
      setMetadata(null);
      return;
    }

    setLoading(true);
    extractAIMetadata(currentLayer.blob)
      .then((meta) => {
        if (isMounted) {
          setMetadata(meta);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.warn('Failed to extract metadata:', err);
        if (isMounted) {
          setMetadata(null);
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [currentLayer?.id, currentLayer?.blob]);

  const handleCopy = (text: string, fieldName: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => {
      setCopiedField(null);
    }, 2000);
  };

  if (!isOpen) {
    return (
      <aside className="w-10 border-r border-white/5 bg-[#08090c] flex flex-col items-center py-4 z-20 shrink-0 select-none">
        <button
          onClick={onToggle}
          className="p-2 text-slate-400 hover:text-cyan-400 hover:bg-white/5 rounded-lg transition-colors flex flex-col items-center gap-2"
          title="Mở Bảng Thông Tin Metadata AI"
        >
          <Cpu size={18} className="text-cyan-400" />
          <span className="text-[9px] uppercase tracking-widest [writing-mode:vertical-lr] rotate-180 font-mono text-slate-400 font-bold mt-2">
            METADATA AI
          </span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-[300px] xl:w-[330px] border-r border-white/10 bg-[#08090c] flex flex-col z-20 shrink-0 overflow-hidden select-text">
      {/* Top Header */}
      <div className="p-3.5 border-b border-white/10 flex items-center justify-between bg-[#0a0c10]">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-400 shrink-0">
            <Cpu size={14} />
          </div>
          <div className="truncate">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-white flex items-center gap-1.5 truncate">
              Metadata AI
            </h2>
            <p className="text-[9px] font-mono text-slate-400">Thông số sinh ảnh</p>
          </div>
        </div>

        <button
          onClick={onToggle}
          className="p-1 text-slate-400 hover:text-white hover:bg-white/10 rounded transition-colors"
          title="Thu gọn bảng Metadata"
        >
          <ChevronLeftIcon size={16} />
        </button>
      </div>

      {/* Layer Selector (if multiple layers) */}
      {layers.length > 1 && (
        <div className="p-2.5 bg-black/40 border-b border-white/5 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest shrink-0 mr-1 flex items-center gap-1">
            <Layers size={10} /> Lớp:
          </span>
          {layers.map((l, idx) => {
            const isSelected = l.id === currentLayer?.id;
            return (
              <button
                key={l.id}
                onClick={() => setSelectedLayerId(l.id)}
                className={`px-2 py-1 rounded text-[10px] font-mono truncate max-w-[120px] transition-all shrink-0 border ${
                  isSelected
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 font-bold shadow-[0_0_8px_rgba(34,211,238,0.2)]'
                    : 'bg-white/[0.03] border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
                }`}
                title={`Xem metadata của Lớp ${idx + 1}: ${l.name}`}
              >
                #{idx + 1} {l.name.replace(/\.[^/.]+$/, '')}
              </button>
            );
          })}
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400 font-mono text-[11px]">
            <div className="w-6 h-6 border-2 border-cyan-400/20 border-t-cyan-400 rounded-full animate-spin" />
            <span>ĐANG ĐỌC METADATA...</span>
          </div>
        ) : !metadata ? (
          <div className="py-8 text-center bg-white/[0.02] border border-white/5 rounded-xl p-4 space-y-3">
            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mx-auto text-slate-500">
              <Info size={20} />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Không tìm thấy Metadata AI
              </h3>
              <p className="text-[10px] text-slate-500 mt-1.5 leading-relaxed">
                Ảnh này không chứa thông số sinh của ComfyUI, WebUI, Forge hay Fooocus (hoặc đã bị mạng xã hội nén xóa metadata).
              </p>
            </div>

            {currentLayer && (
              <div className="pt-3 border-t border-white/5 text-left text-[10px] font-mono space-y-1 text-slate-400">
                <div><span className="text-slate-500">Tên file:</span> {currentLayer.name}</div>
                <div><span className="text-slate-500">Loại:</span> {currentLayer.type}</div>
                {currentLayer.blob && (
                  <div>
                    <span className="text-slate-500">Dung lượng:</span>{' '}
                    {(currentLayer.blob.size / (1024 * 1024)).toFixed(2)} MB
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Software Engine & Generation Type Badges */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {metadata.software && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/10 text-[10px] font-mono font-medium text-slate-300">
                  <Sparkles size={11} className="text-cyan-400" />
                  <span>{metadata.software}</span>
                </div>
              )}

              {metadata.generationType && (
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-mono font-bold tracking-wider uppercase border shadow-sm ${
                    metadata.generationType === 'text2img'
                      ? 'bg-cyan-500/15 text-cyan-300 border-cyan-400/40'
                      : metadata.generationType === 'img2img'
                      ? 'bg-purple-500/15 text-purple-300 border-purple-400/40'
                      : metadata.generationType === 'img2video' || metadata.generationType === 'text2video'
                      ? 'bg-amber-500/15 text-amber-300 border-amber-400/40'
                      : metadata.generationType === 'inpaint'
                      ? 'bg-rose-500/15 text-rose-300 border-rose-400/40'
                      : metadata.generationType === 'upscale'
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/40'
                      : 'bg-white/10 text-slate-300 border-white/15'
                  }`}
                  title={`Loại tác vụ: ${metadata.generationType}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse"></span>
                  <span>{metadata.generationType}</span>
                </div>
              )}
            </div>

            {/* 1. Prompt (Positive) */}
            {metadata.prompt && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1">
                    <FileText size={11} /> Prompt
                  </span>
                  <button
                    onClick={() => handleCopy(metadata.prompt!, 'prompt')}
                    className={`p-1 rounded transition-all ${
                      copiedField === 'prompt'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'text-slate-400 hover:text-white hover:bg-white/10'
                    }`}
                    title={copiedField === 'prompt' ? 'Đã chép prompt!' : 'Sao chép Prompt'}
                  >
                    {copiedField === 'prompt' ? (
                      <Check size={12} className="text-emerald-400" />
                    ) : (
                      <Copy size={12} />
                    )}
                  </button>
                </div>

                <div className="relative group">
                  <div className="p-2.5 rounded-lg bg-black/60 border border-white/10 text-slate-200 text-xs leading-relaxed max-h-40 overflow-y-auto font-sans break-words whitespace-pre-wrap select-all">
                    {metadata.prompt}
                  </div>
                </div>
              </div>
            )}

            {/* 2. Negative Prompt */}
            {metadata.negativePrompt && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-red-400 flex items-center gap-1">
                    <FileText size={11} /> Negative Prompt
                  </span>
                  <button
                    onClick={() => handleCopy(metadata.negativePrompt!, 'negativePrompt')}
                    className={`p-1 rounded transition-all ${
                      copiedField === 'negativePrompt'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'text-slate-400 hover:text-white hover:bg-white/10'
                    }`}
                    title={copiedField === 'negativePrompt' ? 'Đã chép!' : 'Sao chép Negative Prompt'}
                  >
                    {copiedField === 'negativePrompt' ? (
                      <Check size={12} className="text-emerald-400" />
                    ) : (
                      <Copy size={12} />
                    )}
                  </button>
                </div>

                <div className="p-2.5 rounded-lg bg-red-950/15 border border-red-500/20 text-red-200/90 text-xs leading-relaxed max-h-32 overflow-y-auto font-sans break-words whitespace-pre-wrap select-all">
                  {metadata.negativePrompt}
                </div>
              </div>
            )}

            {/* 3. Generation Key Parameters Grid */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1 font-mono">
                <Sliders size={11} className="text-cyan-400" /> Tham số tạo ảnh
              </span>

              <div className="grid grid-cols-2 gap-2 text-xs">
                {/* Seed */}
                {metadata.seed !== undefined && (
                  <div
                    onClick={() => handleCopy(String(metadata.seed), 'seed')}
                    className="p-2 rounded bg-black/40 border border-white/5 hover:border-white/20 transition-colors cursor-pointer group"
                    title="Nhấn để sao chép Seed"
                  >
                    <div className="text-[9px] font-mono text-slate-400 flex items-center justify-between">
                      <span>SEED</span>
                      {copiedField === 'seed' ? (
                        <Check size={10} className="text-emerald-400" />
                      ) : (
                        <Copy size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                    <div className="font-mono font-bold text-cyan-300 truncate mt-0.5">
                      {String(metadata.seed)}
                    </div>
                  </div>
                )}

                {/* Steps */}
                {metadata.steps !== undefined && (
                  <div className="p-2 rounded bg-black/40 border border-white/5">
                    <div className="text-[9px] font-mono text-slate-400">STEPS</div>
                    <div className="font-mono font-bold text-white mt-0.5">{metadata.steps}</div>
                  </div>
                )}

                {/* CFG Scale */}
                {metadata.cfgScale !== undefined && (
                  <div className="p-2 rounded bg-black/40 border border-white/5">
                    <div className="text-[9px] font-mono text-slate-400">CFG SCALE</div>
                    <div className="font-mono font-bold text-amber-300 mt-0.5">{metadata.cfgScale}</div>
                  </div>
                )}

                {/* Denoise */}
                {metadata.denoise !== undefined && (
                  <div className="p-2 rounded bg-black/40 border border-white/5">
                    <div className="text-[9px] font-mono text-slate-400">DENOISE</div>
                    <div className="font-mono font-bold text-emerald-300 mt-0.5">{metadata.denoise}</div>
                  </div>
                )}

                {/* Sampler */}
                {metadata.sampler && (
                  <div className="p-2 rounded bg-black/40 border border-white/5 col-span-2">
                    <div className="text-[9px] font-mono text-slate-400">SAMPLER / SCHEDULER</div>
                    <div className="font-mono font-bold text-white truncate mt-0.5">
                      {metadata.sampler}
                      {metadata.scheduler ? ` (${metadata.scheduler})` : ''}
                    </div>
                  </div>
                )}

                {/* Dimensions */}
                {metadata.dimensions && (
                  <div className="p-2 rounded bg-black/40 border border-white/5 col-span-2">
                    <div className="text-[9px] font-mono text-slate-400">KÍCH THƯỚC BAN ĐẦU</div>
                    <div className="font-mono font-semibold text-slate-300 mt-0.5">
                      {metadata.dimensions}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 4. Checkpoint Model (Moved below Parameters and above LoRA) */}
            {metadata.checkpointModel && (
              <div className="p-2.5 rounded-lg bg-white/[0.03] border border-cyan-500/25 space-y-1">
                <div className="text-[9px] uppercase tracking-wider text-slate-400 font-mono">
                  Checkpoint / Base Model
                </div>
                <div className="text-xs font-bold text-cyan-300 font-mono truncate flex items-center justify-between">
                  <span className="truncate" title={metadata.checkpointModel}>
                    {metadata.checkpointModel}
                  </span>
                  <button
                    onClick={() => handleCopy(metadata.checkpointModel!, 'checkpoint')}
                    className={`p-1 rounded transition-all ${
                      copiedField === 'checkpoint'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'text-slate-400 hover:text-white hover:bg-white/10'
                    }`}
                    title={copiedField === 'checkpoint' ? 'Đã chép model!' : 'Sao chép tên model'}
                  >
                    {copiedField === 'checkpoint' ? (
                      <Check size={12} className="text-emerald-400" />
                    ) : (
                      <Copy size={12} />
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* 5. LoRA List */}
            {metadata.loras && metadata.loras.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1">
                  <Box size={11} className="text-cyan-400" /> LoRA ({metadata.loras.length})
                </span>
                <div className="space-y-1">
                  {metadata.loras.map((lora, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded bg-black/40 border border-white/5 flex items-center justify-between text-xs"
                    >
                      <span className="font-mono text-slate-200 truncate pr-2" title={lora.name}>
                        {lora.name}
                      </span>
                      {lora.strength !== undefined && (
                        <span className="text-[10px] font-mono font-bold text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded shrink-0">
                          {lora.strength}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 6. Detected Source / Before Image in Workflow */}
            {metadata.sourceImageFilename && (
              <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/10 space-y-1">
                <span className="text-[9px] font-mono uppercase tracking-wider text-slate-400">
                  Ảnh đầu vào (Input/Source Image)
                </span>
                <div className="text-xs font-mono font-semibold text-white truncate" title={metadata.sourceImageFilename}>
                  📁 {metadata.sourceImageFilename}
                </div>
              </div>
            )}

            {/* 7. Other Parsed Parameters */}
            {metadata.otherParams && Object.keys(metadata.otherParams).length > 0 && (
              <div className="space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                  Thông số khác
                </span>
                <div className="space-y-1 text-xs">
                  {Object.entries(metadata.otherParams).map(([k, v]) => (
                    <div
                      key={k}
                      className="flex items-center justify-between p-1.5 rounded bg-black/30 text-[11px] font-mono"
                    >
                      <span className="text-slate-400 truncate mr-2">{k}:</span>
                      <span className="text-white font-semibold truncate">{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 8. Raw Parameters / Workflow JSON (Collapsible) */}
            {metadata.rawParameters && (
              <div className="pt-2 border-t border-white/10">
                <button
                  onClick={() => setShowRawParams(!showRawParams)}
                  className="w-full flex items-center justify-between p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/5 text-[10px] font-mono transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <Code2 size={12} /> Dữ liệu Metadata gốc
                  </span>
                  {showRawParams ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>

                {showRawParams && (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex justify-end">
                      <button
                        onClick={() => handleCopy(metadata.rawParameters!, 'raw')}
                        className="text-[9px] font-mono text-cyan-400 hover:underline flex items-center gap-1"
                      >
                        {copiedField === 'raw' ? (
                          <>
                            <Check size={9} /> Đã chép JSON
                          </>
                        ) : (
                          <>
                            <Copy size={9} /> Sao chép Raw
                          </>
                        )}
                      </button>
                    </div>
                    <pre className="p-2 bg-black/80 rounded border border-white/10 text-[9px] font-mono text-slate-300 max-h-48 overflow-y-auto overflow-x-auto whitespace-pre-wrap select-all">
                      {metadata.rawParameters}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function ChevronLeftIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}
