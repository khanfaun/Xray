import React, { useState, useRef, useEffect, useMemo } from 'react';
import { extractOriginalImageInfo, DetectedOriginalInfo } from '../utils/imageMetadata';
import { findOriginalImage, createXRayPairProject, createDemoSampleImages, AutoMatchResult } from '../utils/originalImageFinder';
import { sourceFolderManager, SourceFolderState } from '../utils/sourceFolderStore';
import { ProjectData } from '../types';
import { saveProject, getDistinctFolders, getProjects } from '../db';
import { 
  X, Search, CheckCircle, AlertTriangle, FileImage, Sparkles, 
  FolderOpen, ArrowRight, RefreshCw, UploadCloud, Eye, Trash2, 
  Layers, Info, Check, HardDrive, CheckCheck, Loader2, StopCircle,
  Folder, FolderPlus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface BatchPairItem {
  id: string;
  afterFile: File;
  detectedInfo: DetectedOriginalInfo | null;
  originalBlob: Blob | File | null;
  originalName: string | null;
  matchSource: string | null;
  status: 'analyzing' | 'matched' | 'missing-source' | 'no-metadata';
}

interface AfterImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectReady: (project: ProjectData) => void;
  onApplyLayersToCurrentProject?: (originalBlob: Blob | File, originalName: string, afterFile: File) => void;
}

/**
 * Lightweight lazy image renderer for the modal list.
 * Only creates object URL and decodes when scrolled into viewport.
 * Automatically cleans up URL when row unmounts or scrolls away.
 */
function LazyPreviewImg({ fileOrBlob, alt }: { fileOrBlob?: Blob | File | null; alt: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (!('IntersectionObserver' in window)) {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || !fileOrBlob) return;
    const objUrl = URL.createObjectURL(fileOrBlob);
    setUrl(objUrl);
    return () => {
      URL.revokeObjectURL(objUrl);
    };
  }, [inView, fileOrBlob]);

  return (
    <div ref={ref} className="w-full h-full flex items-center justify-center bg-black/40">
      {url ? (
        <img
          src={url}
          alt={alt}
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="w-full h-full bg-white/5 animate-pulse flex items-center justify-center text-slate-600">
          <FileImage size={16} />
        </div>
      )}
    </div>
  );
}

export default function AfterImageModal({
  isOpen,
  onClose,
  onProjectReady,
  onApplyLayersToCurrentProject,
}: AfterImageModalProps) {
  const [items, setItems] = useState<BatchPairItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [inspectItem, setInspectItem] = useState<BatchPairItem | null>(null);
  const [folderState, setFolderState] = useState<SourceFolderState>(sourceFolderManager.getState());
  const [batchNotice, setBatchNotice] = useState<string | null>(null);

  // Destination Folder management
  const [existingFolders, setExistingFolders] = useState<string[]>(['Khác']);
  const [selectedFolder, setSelectedFolder] = useState<string>('Khác');
  const [isCreatingNewFolder, setIsCreatingNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Load distinct folders when modal opens
  useEffect(() => {
    if (isOpen) {
      getDistinctFolders()
        .then((folders) => {
          setExistingFolders(folders);
          if (!folders.includes(selectedFolder)) {
            setSelectedFolder('Khác');
          }
        })
        .catch((err) => console.warn('Error loading distinct folders:', err));
    }
  }, [isOpen]);

  const targetFolder = (isCreatingNewFolder ? newFolderName.trim() : selectedFolder.trim()) || 'Khác';

  // Chunked processing & Cancel support
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const cancelProcessingRef = useRef(false);

  // Tabs & Pagination for large batches (e.g. 100+ images)
  const [activeTab, setActiveTab] = useState<'all' | 'matched' | 'missing' | 'no-meta'>('all');
  const [displayLimit, setDisplayLimit] = useState(25);

  // Hidden inputs for file / folder picking
  const afterFileInputRef = useRef<HTMLInputElement | null>(null);
  const sourceFolderInputRef = useRef<HTMLInputElement | null>(null);
  const manualSingleInputRef = useRef<HTMLInputElement | null>(null);
  const currentManualTargetId = useRef<string | null>(null);

  // Subscribe to Source Folder updates
  useEffect(() => {
    const unsub = sourceFolderManager.subscribe((state) => {
      setFolderState(state);
    });
    return unsub;
  }, []);

  const handleClose = () => {
    cancelProcessingRef.current = true;
    setItems([]);
    setInspectItem(null);
    setIsProcessing(false);
    setProgress(null);
    setBatchNotice(null);
    onClose();
  };

  // Process a batch of AFTER files with non-blocking UI chunks and deduplication
  const processAfterFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setIsProcessing(true);
    setBatchNotice(null);
    cancelProcessingRef.current = false;

    // Do NOT eagerly create URLs for 100 files; LazyPreviewImg handles visible rows on-demand
    const newItems: BatchPairItem[] = files.map((f) => ({
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      afterFile: f,
      detectedInfo: null,
      originalBlob: null,
      originalName: null,
      matchSource: null,
      status: 'analyzing',
    }));

    setItems((prev) => [...prev, ...newItems]);

    // Process files with microtask yields to prevent browser freeze
    const updatedItems = [...newItems];
    for (let i = 0; i < updatedItems.length; i++) {
      if (cancelProcessingRef.current) break;

      const item = updatedItems[i];
      setProgress({ current: i + 1, total: updatedItems.length });

      // Yield thread every 2 images
      if (i % 2 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }

      try {
        // 1. Read metadata (ComfyUI prompt/workflow, XMP, EXIF, etc.)
        const info = await extractOriginalImageInfo(item.afterFile);
        item.detectedInfo = info;

        // 2. Try to automatically find BEFORE image (from source folder, batch files, DB, or URL)
        const matchResult: AutoMatchResult = await findOriginalImage(item.afterFile, info, files);

        if (matchResult.originalBlob && matchResult.originalName) {
          item.originalBlob = matchResult.originalBlob;
          item.originalName = matchResult.originalName;
          item.matchSource = matchResult.matchSource;
          item.status = 'matched';
        } else if (info && info.filename) {
          item.originalName = info.filename;
          item.status = 'missing-source';
        } else {
          item.status = 'no-metadata';
        }
      } catch (err) {
        console.error('Error analyzing image:', item.afterFile.name, err);
        item.status = 'no-metadata';
      }

      // Update state incrementally for responsive UI feedback
      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...item } : it))
      );
    }

    setProgress(null);
    setIsProcessing(false);
  };

  // When user selects a Source Folder (directory input)
  const handleSourceFolderSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    // sourceFolderManager has O(1) Map lookups optimized for 1,000+ files
    sourceFolderManager.setDirectoryFiles(files);
    e.target.value = '';

    // Re-evaluate any current items that are missing-source
    setItems((prevItems) => {
      return prevItems.map((item) => {
        if (item.status === 'matched') return item;
        const targetFilename = item.detectedInfo?.filename || item.originalName;
        const relPath = item.detectedInfo?.relativePath;

        if (targetFilename) {
          const match = sourceFolderManager.findMatch(targetFilename, relPath);
          if (match) {
            return {
              ...item,
              originalBlob: match.file,
              originalName: match.file.name,
              matchSource: 'source-folder',
              status: 'matched',
            };
          }
        }
        return item;
      });
    });
  };

  // When user manually picks a single original image for a specific item
  const handleManualOriginalSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const targetId = currentManualTargetId.current;
    if (!file || !targetId) return;

    setItems((prev) =>
      prev.map((item) => {
        if (item.id === targetId) {
          return {
            ...item,
            originalBlob: file,
            originalName: file.name,
            matchSource: 'manual',
            status: 'matched',
          };
        }
        return item;
      })
    );

    e.target.value = '';
    currentManualTargetId.current = null;
  };

  const triggerManualPickerForItem = (itemId: string) => {
    currentManualTargetId.current = itemId;
    manualSingleInputRef.current?.click();
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  // Launch a single pair project into the lens viewer
  const launchSinglePair = async (item: BatchPairItem) => {
    if (!item.originalBlob) return;

    try {
      if (onApplyLayersToCurrentProject) {
        onApplyLayersToCurrentProject(
          item.originalBlob,
          item.originalName || 'Anh_Goc',
          item.afterFile
        );
        handleClose();
        return;
      }

      const project = await createXRayPairProject(
        item.afterFile,
        item.originalBlob,
        item.originalName || 'Anh_Goc',
        (item.originalName || item.afterFile.name).replace(/\.[^/.]+$/, ''),
        targetFolder
      );

      await saveProject(project);
      onProjectReady(project);
      handleClose();
    } catch (err) {
      console.error('Lỗi khi mở cặp ảnh:', err);
    }
  };

  // Batch save all matched projects into IndexedDB with thumbnail summaries
  const handleBatchCreateProjects = async () => {
    const matchedItems = items.filter((it) => it.status === 'matched' && it.originalBlob);
    if (matchedItems.length === 0) return;

    try {
      setIsProcessing(true);

      for (let i = 0; i < matchedItems.length; i++) {
        const item = matchedItems[i];
        setBatchNotice(`Đang tạo & tối ưu ảnh nhỏ (${i + 1}/${matchedItems.length})...`);

        const projName = (item.originalName || item.afterFile.name).replace(/\.[^/.]+$/, '');
        const p = await createXRayPairProject(
          item.afterFile,
          item.originalBlob!,
          item.originalName || 'Anh_Goc',
          projName,
          targetFolder
        );
        await saveProject(p);
      }

      setBatchNotice(`Đã lưu thành công tất cả ${matchedItems.length} dự án vào thư mục "${targetFolder}"!`);

      // Keep user on the project list: do NOT automatically open detail view
      setTimeout(() => {
        handleClose();
      }, 700);
    } catch (err) {
      console.error('Lỗi tạo dự án hàng loạt:', err);
      setBatchNotice('Có lỗi xảy ra khi lưu dự án.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Demo generator: quickly create test sample images with metadata
  const handleGenerateDemo = async () => {
    try {
      setBatchNotice('Đang khởi tạo ảnh mẫu...');
      const { originalFile, afterFileWithMetadata } = await createDemoSampleImages();
      await processAfterFiles([afterFileWithMetadata, originalFile]);
      setBatchNotice('Đã tạo thành công ảnh mẫu ComfyUI!');
    } catch (err) {
      console.error('Demo error:', err);
    }
  };

  const matchedCount = items.filter((i) => i.status === 'matched').length;
  const missingCount = items.filter((i) => i.status === 'missing-source').length;
  const noMetaCount = items.filter((i) => i.status === 'no-metadata').length;

  // Filter items based on active tab
  const filteredItems = useMemo(() => {
    if (activeTab === 'matched') return items.filter((i) => i.status === 'matched');
    if (activeTab === 'missing') return items.filter((i) => i.status === 'missing-source');
    if (activeTab === 'no-meta') return items.filter((i) => i.status === 'no-metadata');
    return items;
  }, [items, activeTab]);

  const visibleItems = useMemo(() => {
    return filteredItems.slice(0, displayLimit);
  }, [filteredItems, displayLimit]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 sm:p-6">
      {/* Hidden file pickers */}
      <input
        ref={afterFileInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            processAfterFiles(Array.from(e.target.files));
            e.target.value = '';
          }
        }}
      />
      <input
        ref={sourceFolderInputRef}
        type="file"
        multiple
        // @ts-ignore
        webkitdirectory="true"
        directory="true"
        className="hidden"
        onChange={handleSourceFolderSelected}
      />
      <input
        ref={manualSingleInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleManualOriginalSelected}
      />

      <div className="bg-[#0b0e14] border border-white/10 rounded-2xl w-full max-w-5xl h-[90vh] flex flex-col shadow-2xl overflow-hidden relative">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 bg-[#0f131c] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.3)]">
              <Sparkles size={18} />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
                Ghép Ảnh AFTER Thông Minh
                <span className="text-[9px] px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono">
                  COMFYUI & METADATA AUTO-PAIR
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Tự động đọc thông tin ảnh gốc trong metadata và ghép đôi kính lúp tức thì
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleGenerateDemo}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 border border-purple-500/40 text-xs font-semibold transition-colors"
              title="Tạo ảnh mẫu có nhúng ComfyUI workflow để kiểm tra"
            >
              <Sparkles size={13} /> Thử Ảnh Mẫu
            </button>
            <button
              onClick={handleClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Notice Bar */}
        {batchNotice && (
          <div className="px-6 py-2 bg-cyan-500/10 border-b border-cyan-500/20 flex items-center justify-between text-xs text-cyan-300">
            <span className="flex items-center gap-2">
              <CheckCircle size={14} /> {batchNotice}
            </span>
            <button onClick={() => setBatchNotice(null)} className="text-cyan-400 hover:text-white">
              ✕
            </button>
          </div>
        )}

        {/* Progress Bar (when processing multiple files) */}
        {progress && (
          <div className="px-6 py-2 bg-cyan-950/40 border-b border-cyan-500/30 flex items-center justify-between gap-4 text-xs font-mono text-cyan-300">
            <div className="flex items-center gap-2">
              <Loader2 size={13} className="animate-spin text-cyan-400" />
              <span>
                ĐANG PHÂN TÍCH: {progress.current} / {progress.total} ẢNH (
                {Math.round((progress.current / progress.total) * 100)}%)
              </span>
            </div>
            <button
              onClick={() => {
                cancelProcessingRef.current = true;
                setProgress(null);
                setIsProcessing(false);
              }}
              className="flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300 bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20"
            >
              <StopCircle size={12} /> Dừng phân tích
            </button>
          </div>
        )}

        {/* Body content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* Top Control Panels: 3 Action Boxes */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Box 1: Select AFTER Images */}
            <div
              onClick={() => afterFileInputRef.current?.click()}
              className="p-4 rounded-xl border border-dashed border-cyan-400/40 bg-cyan-500/[0.03] hover:bg-cyan-500/[0.07] transition-all cursor-pointer flex flex-col items-center justify-center text-center group"
            >
              <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-400/50 flex items-center justify-center text-cyan-300 mb-2 group-hover:scale-105 transition-transform shadow-[0_0_15px_rgba(34,211,238,0.2)]">
                <UploadCloud size={20} />
              </div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-1">
                1. NẠP ẢNH AFTER (HÀNG LOẠT)
              </h4>
              <p className="text-[11px] text-slate-400 max-w-xs leading-relaxed">
                Chọn một hoặc nhiều ảnh sau xử lý (tự động đọc ComfyUI LoadImage, prompt, EXIF, XMP)
              </p>
              <span className="mt-3 px-3 py-1 rounded bg-cyan-500/20 text-cyan-300 text-[10px] font-semibold border border-cyan-400/30">
                + Chọn tệp ảnh AFTER
              </span>
            </div>

            {/* Box 2: Source Folder */}
            <div className="p-4 rounded-xl border border-white/10 bg-white/[0.02] flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <HardDrive size={16} className="text-slate-400" />
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                      2. THƯ MỤC NGUỒN (BEFORE)
                    </h4>
                  </div>
                  {folderState.isConfigured && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 font-mono font-semibold flex items-center gap-0.5">
                      <Check size={10} /> {folderState.fileCount} tệp
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
                  Chọn thư mục chứa ảnh gốc. Khi tải ảnh AFTER, hệ thống tự động đối chiếu theo tên tệp hoặc đường dẫn tương đối.
                </p>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-white/5">
                <button
                  onClick={() => sourceFolderInputRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/15 rounded-lg text-[11px] font-semibold text-slate-200 hover:text-white transition-colors"
                >
                  <FolderOpen size={13} className="text-cyan-400" />
                  {folderState.isConfigured ? 'Đổi thư mục nguồn' : 'Chọn thư mục gốc'}
                </button>
                {folderState.isConfigured && (
                  <button
                    onClick={() => sourceFolderManager.clear()}
                    className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-white/5 rounded-lg transition-colors"
                    title="Xóa cấu hình thư mục nguồn"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>

            {/* Box 3: Destination Folder */}
            <div className="p-4 rounded-xl border border-cyan-500/30 bg-cyan-950/10 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Folder size={16} className="text-cyan-400" />
                    <h4 className="text-xs font-bold text-cyan-300 uppercase tracking-wider">
                      3. THƯ MỤC LƯU DỰ ÁN
                    </h4>
                  </div>
                  <span className="text-[9px] px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono font-semibold border border-cyan-400/30 truncate max-w-[120px]">
                    📁 {targetFolder}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mb-2 leading-relaxed">
                  Chọn thư mục có sẵn hoặc tạo thư mục mới để phân loại. Mặc định là thư mục <strong className="text-white">"Khác"</strong>.
                </p>

                {/* Folder Select or Create New */}
                {isCreatingNewFolder ? (
                  <div className="space-y-1.5 mt-2">
                    <div className="relative">
                      <input
                        type="text"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        placeholder="Nhập tên thư mục mới..."
                        autoFocus
                        className="w-full px-3 py-1.5 bg-black/60 border border-cyan-400/50 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-400">Tên thư mục mới</span>
                      <button
                        onClick={() => {
                          setIsCreatingNewFolder(false);
                          setNewFolderName('');
                        }}
                        className="text-cyan-400 hover:text-white underline cursor-pointer"
                      >
                        Chọn thư mục có sẵn
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 mt-2">
                    <div className="relative">
                      <select
                        value={selectedFolder}
                        onChange={(e) => {
                          if (e.target.value === '__NEW__') {
                            setIsCreatingNewFolder(true);
                          } else {
                            setSelectedFolder(e.target.value);
                          }
                        }}
                        className="w-full px-3 py-1.5 bg-black/60 border border-white/15 rounded-lg text-xs text-white focus:outline-none focus:border-cyan-400 appearance-none cursor-pointer pr-8"
                      >
                        <option value="Khác">📁 Khác (Mặc định)</option>
                        {existingFolders
                          .filter((f) => f !== 'Khác')
                          .map((folder) => (
                            <option key={folder} value={folder}>
                              📁 {folder}
                            </option>
                          ))}
                      </select>
                      <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-[10px]">
                        ▼
                      </div>
                    </div>

                    <button
                      onClick={() => setIsCreatingNewFolder(true)}
                      className="w-full flex items-center justify-center gap-1.5 py-1 text-[10px] text-cyan-400 hover:text-cyan-300 font-semibold bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 rounded-md transition-colors"
                    >
                      <FolderPlus size={12} /> + Tạo thư mục mới
                    </button>
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-white/5 text-[9px] text-slate-500 font-mono">
                {isCreatingNewFolder && newFolderName.trim()
                  ? `Sẽ tạo thư mục: "${newFolderName.trim()}"`
                  : `Dự án sẽ nằm trong: "${targetFolder}"`}
              </div>
            </div>
          </div>

          {/* Items Card List & Filters */}
          {items.length > 0 && (
            <div className="space-y-3">
              {/* Header + Tabs Filter */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-white/10">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white mr-2">
                    Danh Sách Ảnh ({items.length})
                  </h4>

                  {/* Filter Tabs */}
                  <div className="flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-white/10 text-[11px]">
                    <button
                      onClick={() => {
                        setActiveTab('all');
                        setDisplayLimit(25);
                      }}
                      className={`px-2.5 py-1 rounded transition-colors ${
                        activeTab === 'all' ? 'bg-white/15 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Tất cả ({items.length})
                    </button>
                    <button
                      onClick={() => {
                        setActiveTab('matched');
                        setDisplayLimit(25);
                      }}
                      className={`px-2.5 py-1 rounded transition-colors ${
                        activeTab === 'matched' ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Đã ghép ({matchedCount})
                    </button>
                    <button
                      onClick={() => {
                        setActiveTab('missing');
                        setDisplayLimit(25);
                      }}
                      className={`px-2.5 py-1 rounded transition-colors ${
                        activeTab === 'missing' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Cần ảnh gốc ({missingCount})
                    </button>
                    <button
                      onClick={() => {
                        setActiveTab('no-meta');
                        setDisplayLimit(25);
                      }}
                      className={`px-2.5 py-1 rounded transition-colors ${
                        activeTab === 'no-meta' ? 'bg-slate-500/20 text-slate-300 font-bold' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Không metadata ({noMetaCount})
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => afterFileInputRef.current?.click()}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 font-semibold"
                  >
                    + Thêm ảnh AFTER
                  </button>
                  <button
                    onClick={() => {
                      cancelProcessingRef.current = true;
                      setItems([]);
                    }}
                    className="text-[11px] text-slate-500 hover:text-red-400 transition-colors ml-2"
                  >
                    Xóa tất cả
                  </button>
                </div>
              </div>

              {/* Items Card List */}
              <div className="space-y-2.5">
                {visibleItems.map((item) => {
                  const hasComfyMeta = Boolean(item.detectedInfo?.comfyDetails);
                  return (
                    <div
                      key={item.id}
                      className={`p-3.5 rounded-xl border transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-3 ${
                        item.status === 'matched'
                          ? 'bg-cyan-500/[0.03] border-cyan-500/30 shadow-[0_0_15px_rgba(34,211,238,0.05)]'
                          : item.status === 'missing-source'
                          ? 'bg-amber-500/[0.03] border-amber-500/30'
                          : item.status === 'analyzing'
                          ? 'bg-white/[0.02] border-white/10'
                          : 'bg-white/[0.01] border-white/5'
                      }`}
                    >
                      {/* Left: Images pair info */}
                      <div className="flex items-center gap-3.5 min-w-0 flex-1">
                        {/* AFTER Thumbnail (Lazy Loaded) */}
                        <div className="relative w-14 h-14 rounded-lg bg-black/60 border border-cyan-500/30 overflow-hidden shrink-0 flex items-center justify-center">
                          <LazyPreviewImg fileOrBlob={item.afterFile} alt="AFTER" />
                          <span className="absolute bottom-0 inset-x-0 bg-cyan-950/85 text-[8px] font-mono text-cyan-300 text-center py-0.5 border-t border-cyan-500/30">
                            AFTER
                          </span>
                        </div>

                        {/* Arrow separator */}
                        <ArrowRight size={14} className="text-slate-600 shrink-0" />

                        {/* BEFORE Thumbnail or Placeholder (Lazy Loaded) */}
                        <div className="relative w-14 h-14 rounded-lg bg-black/60 border border-white/15 overflow-hidden shrink-0 flex items-center justify-center">
                          {item.originalBlob ? (
                            <>
                              <LazyPreviewImg fileOrBlob={item.originalBlob} alt="BEFORE" />
                              <span className="absolute bottom-0 inset-x-0 bg-black/85 text-[8px] font-mono text-slate-300 text-center py-0.5 border-t border-white/20">
                                BEFORE
                              </span>
                            </>
                          ) : (
                            <div className="flex flex-col items-center justify-center text-slate-600">
                              <FileImage size={18} />
                              <span className="text-[8px] font-mono text-slate-500 mt-1">Chưa có</span>
                            </div>
                          )}
                        </div>

                        {/* Text info & metadata badges */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-xs font-bold text-white truncate max-w-[200px]" title={item.afterFile.name}>
                              {item.afterFile.name}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              ({(item.afterFile.size / 1024).toFixed(0)} KB)
                            </span>
                          </div>

                          {/* Metadata badge */}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {hasComfyMeta ? (
                              <button
                                onClick={() => setInspectItem(item)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 border border-purple-500/40 text-[9px] font-mono font-semibold transition-colors"
                                title="Xem chi tiết Node ComfyUI đã trích xuất"
                              >
                                <Sparkles size={10} />
                                ComfyUI: Node #{item.detectedInfo?.comfyDetails?.nodeId} ({item.detectedInfo?.comfyDetails?.nodeType}) → {item.detectedInfo?.filename}
                                <Eye size={10} className="ml-0.5" />
                              </button>
                            ) : item.detectedInfo?.filename ? (
                              <button
                                onClick={() => setInspectItem(item)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 border border-cyan-500/30 text-[9px] font-mono transition-colors"
                              >
                                <Info size={10} />
                                Metadata ({item.detectedInfo.sourceType}): {item.detectedInfo.filename}
                                <Eye size={10} className="ml-0.5" />
                              </button>
                            ) : (
                              <span className="text-[9px] text-slate-500 font-mono italic">
                                Không tìm thấy metadata ảnh gốc
                              </span>
                            )}
                          </div>

                          {/* Match Source status text */}
                          <div className="mt-1 text-[10px] font-mono">
                            {item.status === 'matched' ? (
                              <span className="text-green-400 flex items-center gap-1">
                                <Check size={11} /> Đã ghép với: <strong className="text-white">{item.originalName}</strong>
                                <span className="text-slate-500">({item.matchSource || 'Metadata'})</span>
                              </span>
                            ) : item.status === 'missing-source' ? (
                              <span className="text-amber-400 flex items-center gap-1">
                                <AlertTriangle size={11} /> Cần tìm tệp: <strong className="text-white underline">{item.originalName}</strong>
                              </span>
                            ) : item.status === 'analyzing' ? (
                              <span className="text-cyan-400 flex items-center gap-1">
                                <RefreshCw size={11} className="animate-spin" /> Đang đọc metadata...
                              </span>
                            ) : (
                              <span className="text-slate-400">Chưa có ảnh BEFORE</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                        {item.status === 'matched' ? (
                          <button
                            onClick={() => launchSinglePair(item)}
                            className="flex items-center gap-1.5 px-3.5 py-2 bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs uppercase tracking-wider rounded-lg shadow-[0_0_15px_rgba(34,211,238,0.3)] transition-all"
                            title="Mở cặp ảnh này vào giao diện kính lúp"
                          >
                            <Search size={13} /> Mở Kính Lúp
                          </button>
                        ) : (
                          <button
                            onClick={() => triggerManualPickerForItem(item.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/40 text-amber-300 font-semibold text-xs rounded-lg transition-colors"
                            title="Chọn tệp ảnh gốc thủ công"
                          >
                            <FolderOpen size={13} /> Chọn Ảnh BEFORE
                          </button>
                        )}

                        <button
                          onClick={() => removeItem(item.id)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-red-400 hover:bg-white/5 transition-colors"
                          title="Xóa mục này"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Show More Pagination for long lists */}
                {visibleItems.length < filteredItems.length && (
                  <div className="pt-2 text-center">
                    <button
                      onClick={() => setDisplayLimit((prev) => prev + 25)}
                      className="px-4 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs text-cyan-400 font-mono"
                    >
                      Xem thêm {Math.min(25, filteredItems.length - visibleItems.length)} mục nữa (
                      {visibleItems.length}/{filteredItems.length})
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-[#0f131c] border-t border-white/10 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-[11px] font-mono text-slate-400">
            {items.length > 0 && (
              <span>
                Tổng cộng: <strong className="text-white">{items.length} ảnh AFTER</strong> • Đã khớp:{' '}
                <strong className="text-cyan-400">{matchedCount} cặp</strong>
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleClose}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white uppercase tracking-wider transition-colors"
            >
              Đóng
            </button>

            {matchedCount > 0 && (
              <button
                onClick={handleBatchCreateProjects}
                disabled={isProcessing}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-black font-bold text-xs uppercase tracking-widest shadow-[0_0_20px_rgba(34,211,238,0.4)] transition-all"
              >
                <CheckCheck size={15} /> Lưu {matchedCount} Cặp Vào Thư Mục "{targetFolder}"
              </button>
            )}
          </div>
        </div>

        {/* Modal: Inspector for ComfyUI / Metadata details */}
        <AnimatePresence>
          {inspectItem && (
            <div
              className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
              onClick={() => setInspectItem(null)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-[#121622] border border-cyan-500/40 rounded-xl p-6 max-w-xl w-full shadow-2xl text-xs space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles size={16} className="text-cyan-400" />
                    <h4 className="font-bold text-white uppercase tracking-wider">
                      Chi Tiết Metadata & Node ComfyUI
                    </h4>
                  </div>
                  <button
                    onClick={() => setInspectItem(null)}
                    className="text-slate-400 hover:text-white"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="space-y-2.5 font-mono text-[11px]">
                  <div>
                    <span className="text-slate-400">Tệp AFTER:</span>{' '}
                    <strong className="text-white">{inspectItem.afterFile.name}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400">Nguồn Metadata:</span>{' '}
                    <strong className="text-cyan-300 uppercase">
                      {inspectItem.detectedInfo?.sourceType || 'Không xác định'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400">Tên tệp gốc phát hiện:</span>{' '}
                    <strong className="text-green-300">
                      {inspectItem.detectedInfo?.filename || 'Chưa tìm thấy'}
                    </strong>
                  </div>
                  {inspectItem.detectedInfo?.relativePath && (
                    <div>
                      <span className="text-slate-400">Đường dẫn tương đối:</span>{' '}
                      <span className="text-slate-200">
                        {inspectItem.detectedInfo.relativePath}
                      </span>
                    </div>
                  )}

                  {inspectItem.detectedInfo?.comfyDetails && (
                    <div className="mt-3 p-3 rounded bg-black/40 border border-purple-500/30 space-y-1.5">
                      <div className="text-purple-300 font-bold uppercase tracking-wider text-[10px]">
                        Thông tin ComfyUI Node:
                      </div>
                      <div>
                        Node ID:{' '}
                        <span className="text-white">
                          #{inspectItem.detectedInfo.comfyDetails.nodeId}
                        </span>
                      </div>
                      <div>
                        Node Type:{' '}
                        <span className="text-white">
                          {inspectItem.detectedInfo.comfyDetails.nodeType}
                        </span>
                      </div>
                      {inspectItem.detectedInfo.comfyDetails.title && (
                        <div>
                          Title:{' '}
                          <span className="text-white">
                            {inspectItem.detectedInfo.comfyDetails.title}
                          </span>
                        </div>
                      )}
                      {inspectItem.detectedInfo.comfyDetails.subfolder && (
                        <div>
                          Subfolder:{' '}
                          <span className="text-white">
                            {inspectItem.detectedInfo.comfyDetails.subfolder}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {inspectItem.detectedInfo?.rawPrompt && (
                    <div className="mt-2">
                      <div className="text-slate-400 mb-1">Trích đoạn JSON ComfyUI:</div>
                      <pre className="p-2.5 bg-black/50 rounded border border-white/5 max-h-40 overflow-y-auto text-[10px] text-slate-300">
                        {inspectItem.detectedInfo.rawPrompt.slice(0, 800)}
                        {inspectItem.detectedInfo.rawPrompt.length > 800 && '...'}
                      </pre>
                    </div>
                  )}
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    onClick={() => setInspectItem(null)}
                    className="px-4 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded text-xs uppercase tracking-wider"
                  >
                    Đóng
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
