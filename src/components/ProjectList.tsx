import React, { useEffect, useState, useRef, useMemo } from 'react';
import { ProjectData, ProjectSummary } from '../types';
import { getProjectsSummary, getProject, deleteProject, updateProjectFolder, renameFolder, deleteFolderProjects } from '../db';
import { thumbnailUrlCache } from '../utils/thumbnailGenerator';
import { 
  Trash2, Layers, LayoutGrid, List, Film, Image as ImageIcon, Sparkles, 
  Search, Zap, Loader2, Folder, FolderOpen, ChevronDown, ChevronRight, 
  ArrowUpDown, Filter, FolderPlus, Check, Edit3, Edit2, X, Folders, AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import AfterImageModal from './AfterImageModal';

interface ProjectListProps {
  onOpenProject: (project: ProjectData, currentList?: ProjectSummary[]) => void;
}

export type SortOption =
  | 'date-desc'
  | 'date-asc'
  | 'name-asc'
  | 'name-desc'
  | 'folder-asc'
  | 'layers-desc';

/**
 * Instagram-Style Lazy Loaded Thumbnail Component
 *
 * 1. Only loads & decodes images when the element enters within 250px of viewport.
 * 2. Uses lightweight downscaled WebP/JPEG thumbnails (~15KB) instead of 4K raw images (40MB).
 * 3. Supports instant Before/After hover preview without memory bloat.
 * 4. Automatic URL revocation through LRU cache.
 */
function InstagramThumbnail({
  summary,
  layoutMode,
}: {
  summary: ProjectSummary;
  layoutMode: 'grid' | 'list';
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [imgUrls, setImgUrls] = useState<Record<string, string>>({});

  // IntersectionObserver: Only activate when scrolled near viewport
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (!('IntersectionObserver' in window)) {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '250px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // When in view, retrieve or generate object URLs for the small thumbnail blobs
  useEffect(() => {
    if (!isInView) return;

    const urls: Record<string, string> = {};
    const layers = summary.layerThumbnails || [];

    if (layers.length > 0) {
      layers.forEach((layer) => {
        if (layer.thumbnailBlob) {
          urls[layer.id] = thumbnailUrlCache.getOrCreateUrl(layer.id, layer.thumbnailBlob);
        }
      });
    } else if (summary.thumbnailBlob) {
      urls['primary'] = thumbnailUrlCache.getOrCreateUrl(summary.id, summary.thumbnailBlob);
    }

    setImgUrls(urls);
  }, [isInView, summary]);

  const layers = summary.layerThumbnails || [];
  const containerClass = `relative overflow-hidden bg-[#07090e] flex-shrink-0 ${
    layoutMode === 'grid'
      ? 'aspect-square w-full border-b border-white/5 opacity-90 group-hover:opacity-100 transition-opacity'
      : 'w-10 h-10 rounded shadow-md border border-white/10'
  }`;

  if (summary.layerCount === 0) {
    return (
      <div ref={containerRef} className={`flex items-center justify-center bg-[#07090e] text-slate-700 ${containerClass}`}>
        <Layers size={14} />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={containerClass}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {!isInView ? (
        <div className="absolute inset-0 bg-white/[0.02] animate-pulse flex items-center justify-center">
          <Layers size={12} className="text-slate-700" />
        </div>
      ) : layers.length > 0 ? (
        [...layers].reverse().map((layer, reverseIdx) => {
          const idx = layers.length - 1 - reverseIdx;
          const isLast = idx === layers.length - 1;
          const delay = hovered ? idx * 250 : 0;
          const url = imgUrls[layer.id];

          if (!url) {
            return (
              <div key={layer.id} className="absolute inset-0 bg-white/[0.02] flex items-center justify-center text-slate-700">
                <Layers size={12} />
              </div>
            );
          }

          return (
            <img
              key={layer.id}
              src={url}
              alt={layer.name}
              loading="lazy"
              decoding="async"
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
                hovered && !isLast ? 'opacity-0' : 'opacity-100'
              }`}
              style={{ transitionDelay: `${delay}ms` }}
            />
          );
        })
      ) : imgUrls['primary'] ? (
        <img
          src={imgUrls['primary']}
          alt={summary.name}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-white/[0.02] flex items-center justify-center text-slate-700">
          <Layers size={12} />
        </div>
      )}

      {/* Layer count badge for multi-layer / before-after pairs */}
      {layoutMode === 'grid' && layers.length > 1 && (
        <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/75 border border-white/10 text-[8px] font-mono text-cyan-300 font-semibold flex items-center gap-1 shadow">
          <span>{layers.length} LỚP</span>
        </div>
      )}
    </div>
  );
}

export default function ProjectList({ onOpenProject }: ProjectListProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [isAfterModalOpen, setIsAfterModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Folder and Filter States
  const [selectedFolderFilter, setSelectedFolderFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<SortOption>('date-desc');
  const [groupByFolder, setGroupByFolder] = useState<boolean>(true);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});

  // Move project folder modal state
  const [movingProject, setMovingProject] = useState<ProjectSummary | null>(null);
  const [moveTargetFolder, setMoveTargetFolder] = useState<string>('Khác');
  const [isMoveNewFolder, setIsMoveNewFolder] = useState<boolean>(false);
  const [newMoveFolderName, setNewMoveFolderName] = useState<string>('');

  // Batch move projects modal state
  const [isBatchMoveModalOpen, setIsBatchMoveModalOpen] = useState(false);
  const [batchMoveTargetFolder, setBatchMoveTargetFolder] = useState<string>('Khác');
  const [isBatchMoveNewFolder, setIsBatchMoveNewFolder] = useState<boolean>(false);
  const [newBatchMoveFolderName, setNewBatchMoveFolderName] = useState<string>('');
  const [isBatchMoving, setIsBatchMoving] = useState(false);

  // Shift-click range selection tracking
  const lastSelectedIdRef = useRef<string | null>(null);

  // Rename folder modal state
  const [renamingFolder, setRenamingFolder] = useState<{ oldName: string; currentCount: number } | null>(null);
  const [newFolderNameInput, setNewFolderNameInput] = useState<string>('');

  // Delete folder modal state
  const [deletingFolder, setDeletingFolder] = useState<{ name: string; count: number } | null>(null);
  const [deleteFolderAction, setDeleteFolderAction] = useState<'delete_projects' | 'move_to_khac'>('move_to_khac');

  // Pagination / Display limit for flat mode
  const [displayLimit, setDisplayLimit] = useState(48);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

  const [layoutMode, setLayoutMode] = useState<'grid' | 'list'>(
    (localStorage.getItem('projectLayout') as 'grid' | 'list') || 'grid'
  );

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      setLoading(true);
      const data = await getProjectsSummary();
      setProjects(data);
    } catch (e) {
      console.error('Error loading projects summary:', e);
    } finally {
      setLoading(false);
    }
  };

  // Distinct folders list (Khác is always present and ordered first or cleanly sorted)
  const distinctFolders = useMemo(() => {
    const set = new Set<string>();
    set.add('Khác');
    projects.forEach((p) => {
      const f = p.folder?.trim();
      if (f) set.add(f);
    });
    return Array.from(set).sort((a, b) => {
      if (a === 'Khác') return -1;
      if (b === 'Khác') return 1;
      return a.localeCompare(b, 'vi', { sensitivity: 'base' });
    });
  }, [projects]);

  // Project count per folder
  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    projects.forEach((p) => {
      const f = p.folder?.trim() || 'Khác';
      counts[f] = (counts[f] || 0) + 1;
    });
    return counts;
  }, [projects]);

  // Filtered and Sorted projects list
  const filteredAndSortedProjects = useMemo(() => {
    let result = [...projects];

    // Search filter: matches project name OR folder name
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      result = result.filter((p) => {
        const nameMatch = p.name.toLowerCase().includes(term);
        const folderMatch = (p.folder || 'Khác').toLowerCase().includes(term);
        return nameMatch || folderMatch;
      });
    }

    // Folder filter
    if (selectedFolderFilter !== 'ALL') {
      result = result.filter((p) => (p.folder?.trim() || 'Khác') === selectedFolderFilter);
    }

    // Sort
    result.sort((a, b) => {
      const folderA = a.folder?.trim() || 'Khác';
      const folderB = b.folder?.trim() || 'Khác';

      switch (sortBy) {
        case 'date-desc':
          return b.createdAt - a.createdAt;
        case 'date-asc':
          return a.createdAt - b.createdAt;
        case 'name-asc':
          return a.name.localeCompare(b.name, 'vi', { sensitivity: 'base' });
        case 'name-desc':
          return b.name.localeCompare(a.name, 'vi', { sensitivity: 'base' });
        case 'folder-asc': {
          const fCmp = folderA.localeCompare(folderB, 'vi', { sensitivity: 'base' });
          return fCmp !== 0 ? fCmp : b.createdAt - a.createdAt;
        }
        case 'layers-desc':
          return (b.layerCount || 0) - (a.layerCount || 0);
        default:
          return b.createdAt - a.createdAt;
      }
    });

    return result;
  }, [projects, searchTerm, selectedFolderFilter, sortBy]);

  // Grouped by folder representation
  const groupedFolderList = useMemo(() => {
    const map = new Map<string, ProjectSummary[]>();

    distinctFolders.forEach((f) => {
      map.set(f, []);
    });

    filteredAndSortedProjects.forEach((p) => {
      const f = p.folder?.trim() || 'Khác';
      if (!map.has(f)) {
        map.set(f, []);
      }
      map.get(f)!.push(p);
    });

    const groups: { folder: string; items: ProjectSummary[] }[] = [];
    map.forEach((items, folder) => {
      if (items.length > 0) {
        groups.push({ folder, items });
      }
    });

    return groups;
  }, [distinctFolders, filteredAndSortedProjects]);

  // Sliced items for virtualized / infinite scroll display in flat mode
  const visibleFlatProjects = useMemo(() => {
    return filteredAndSortedProjects.slice(0, displayLimit);
  }, [filteredAndSortedProjects, displayLimit]);

  // Infinite Scroll Sentinel Observer
  useEffect(() => {
    const el = loadMoreSentinelRef.current;
    if (!el || displayLimit >= filteredAndSortedProjects.length || groupByFolder) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setDisplayLimit((prev) => Math.min(prev + 36, filteredAndSortedProjects.length));
        }
      },
      { rootMargin: '400px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [displayLimit, filteredAndSortedProjects.length, groupByFolder]);

  const toggleLayout = (mode: 'grid' | 'list') => {
    setLayoutMode(mode);
    localStorage.setItem('projectLayout', mode);
  };

  const toggleFolderCollapse = (folderName: string) => {
    setCollapsedFolders((prev) => ({
      ...prev,
      [folderName]: !prev[folderName],
    }));
  };

  const collapseAllFolders = () => {
    const all: Record<string, boolean> = {};
    groupedFolderList.forEach((g) => {
      all[g.folder] = true;
    });
    setCollapsedFolders(all);
  };

  const expandAllFolders = () => {
    setCollapsedFolders({});
  };

  const handleNewProject = async () => {
    const target = selectedFolderFilter !== 'ALL' ? selectedFolderFilter : 'Khác';
    const newP: ProjectData = {
      id: Date.now().toString(),
      name: 'DU_AN_MOI',
      folder: target,
      createdAt: Date.now(),
      layers: [],
    };
    onOpenProject(newP, filteredAndSortedProjects);
  };

  // Open project: loads full high-resolution project on demand!
  const handleSelectProject = async (summary: ProjectSummary) => {
    if (openingId) return;
    setOpeningId(summary.id);

    try {
      const full = await getProject(summary.id);
      if (full) {
        onOpenProject(full, filteredAndSortedProjects);
      } else {
        onOpenProject({
          id: summary.id,
          name: summary.name,
          folder: summary.folder || 'Khác',
          createdAt: summary.createdAt,
          layers: [],
        }, filteredAndSortedProjects);
      }
    } catch (e) {
      console.error('Error loading full project on demand:', e);
    } finally {
      setOpeningId(null);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleteConfirm(id);
  };

  const confirmDelete = async () => {
    if (deleteConfirm) {
      try {
        if (deleteConfirm === 'SELECTED') {
          await Promise.all(selectedProjects.map((id) => deleteProject(id)));
          setSelectedProjects([]);
        } else {
          await deleteProject(deleteConfirm);
        }
        await loadProjects();
      } catch (e) {
        console.error(e);
      } finally {
        setDeleteConfirm(null);
      }
    }
  };

  const openMoveFolderModal = (e: React.MouseEvent, p: ProjectSummary) => {
    e.stopPropagation();
    setMovingProject(p);
    setMoveTargetFolder(p.folder?.trim() || 'Khác');
    setIsMoveNewFolder(false);
    setNewMoveFolderName('');
  };

  const confirmMoveFolder = async () => {
    if (!movingProject) return;
    const dest = (isMoveNewFolder ? newMoveFolderName.trim() : moveTargetFolder.trim()) || 'Khác';
    try {
      await updateProjectFolder(movingProject.id, dest);
      setMovingProject(null);
      setIsMoveNewFolder(false);
      setNewMoveFolderName('');
      await loadProjects();
    } catch (e) {
      console.error('Lỗi khi đổi thư mục:', e);
    }
  };

  // Open Batch Move Modal for all currently selected projects
  const openBatchMoveModal = () => {
    if (selectedProjects.length === 0) return;
    setBatchMoveTargetFolder('Khác');
    setIsBatchMoveNewFolder(false);
    setNewBatchMoveFolderName('');
    setIsBatchMoveModalOpen(true);
  };

  const confirmBatchMove = async () => {
    if (selectedProjects.length === 0) return;
    const dest = (isBatchMoveNewFolder ? newBatchMoveFolderName.trim() : batchMoveTargetFolder.trim()) || 'Khác';
    try {
      setIsBatchMoving(true);
      await Promise.all(selectedProjects.map((id) => updateProjectFolder(id, dest)));
      setIsBatchMoveModalOpen(false);
      setIsBatchMoveNewFolder(false);
      setNewBatchMoveFolderName('');
      setSelectedProjects([]);
      await loadProjects();
    } catch (e) {
      console.error('Lỗi khi di chuyển các dự án đã chọn:', e);
    } finally {
      setIsBatchMoving(false);
    }
  };

  // Shift-click range selection: selects all projects in-between
  const handleProjectCheckbox = (
    e: React.ChangeEvent<HTMLInputElement> | React.MouseEvent<HTMLInputElement>,
    projectId: string
  ) => {
    const isShift = Boolean((e.nativeEvent as MouseEvent)?.shiftKey || (e as any).shiftKey);
    const target = e.target as HTMLInputElement;
    const isChecked = target.checked;

    if (isShift && lastSelectedIdRef.current) {
      const allIds = filteredAndSortedProjects.map((p) => p.id);
      const lastIdx = allIds.indexOf(lastSelectedIdRef.current);
      const currIdx = allIds.indexOf(projectId);

      if (lastIdx !== -1 && currIdx !== -1) {
        const start = Math.min(lastIdx, currIdx);
        const end = Math.max(lastIdx, currIdx);
        const rangeIds = allIds.slice(start, end + 1);

        if (isChecked) {
          setSelectedProjects((prev) => Array.from(new Set([...prev, ...rangeIds])));
        } else {
          const rangeSet = new Set(rangeIds);
          setSelectedProjects((prev) => prev.filter((id) => !rangeSet.has(id)));
        }
        lastSelectedIdRef.current = projectId;
        return;
      }
    }

    if (isChecked) {
      setSelectedProjects((prev) => (prev.includes(projectId) ? prev : [...prev, projectId]));
    } else {
      setSelectedProjects((prev) => prev.filter((id) => id !== projectId));
    }
    lastSelectedIdRef.current = projectId;
  };

  const openRenameFolderModal = (folderName: string) => {
    setRenamingFolder({
      oldName: folderName,
      currentCount: folderCounts[folderName] || 0,
    });
    setNewFolderNameInput(folderName);
  };

  const confirmRenameFolder = async () => {
    if (!renamingFolder) return;
    const trimmed = newFolderNameInput.trim();
    if (!trimmed) return;

    try {
      await renameFolder(renamingFolder.oldName, trimmed);
      if (selectedFolderFilter === renamingFolder.oldName) {
        setSelectedFolderFilter(trimmed);
      }
      setRenamingFolder(null);
      await loadProjects();
    } catch (e) {
      console.error('Lỗi khi đổi tên thư mục:', e);
    }
  };

  const openDeleteFolderModal = (folderName: string) => {
    const count = folderCounts[folderName] || 0;
    setDeletingFolder({
      name: folderName,
      count,
    });
    setDeleteFolderAction(folderName === 'Khác' ? 'delete_projects' : (count > 0 ? 'move_to_khac' : 'delete_projects'));
  };

  const confirmDeleteFolder = async () => {
    if (!deletingFolder) return;
    try {
      if (deleteFolderAction === 'move_to_khac') {
        await renameFolder(deletingFolder.name, 'Khác');
      } else {
        await deleteFolderProjects(deletingFolder.name);
        const remainingSummaries = await getProjectsSummary();
        const remainingIds = new Set(remainingSummaries.map((p) => p.id));
        setSelectedProjects((prev) => prev.filter((id) => remainingIds.has(id)));
      }

      if (selectedFolderFilter === deletingFolder.name) {
        setSelectedFolderFilter('ALL');
      }
      setDeletingFolder(null);
      await loadProjects();
    } catch (e) {
      console.error('Lỗi khi xóa thư mục:', e);
    }
  };

  // Single card renderer for reusable layout
  const renderCard = (p: ProjectSummary) => {
    const isOpening = openingId === p.id;
    const folderName = p.folder?.trim() || 'Khác';

    return (
      <div
        key={p.id}
        onClick={() => handleSelectProject(p)}
        onMouseEnter={() => {
          getProject(p.id).catch(() => {});
        }}
        className={`group bg-white/[0.02] border border-white/5 rounded-lg cursor-pointer hover:bg-white/5 hover:border-cyan-400/40 transition-all shadow-lg flex overflow-hidden relative ${
          layoutMode === 'grid' ? 'flex-col' : 'flex-row items-center p-3 gap-4'
        }`}
      >
        {/* Checkbox */}
        <div
          className={`absolute z-10 ${
            layoutMode === 'grid' ? 'top-1.5 right-1.5' : 'left-3 top-1/2 -translate-y-1/2'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={selectedProjects.includes(p.id)}
            onChange={(e) => handleProjectCheckbox(e, p.id)}
            className="w-3.5 h-3.5 accent-cyan-500 bg-black/50 border border-white/20 rounded cursor-pointer"
          />
        </div>

        {/* Opening Spinner Overlay */}
        {isOpening && (
          <div className="absolute inset-0 z-20 bg-black/60 backdrop-blur-[2px] flex items-center justify-center">
            <Loader2 size={18} className="text-cyan-400 animate-spin" />
          </div>
        )}

        {/* Instagram-Style Downscaled Thumbnail */}
        <div className={layoutMode === 'grid' ? '' : 'shrink-0 rounded overflow-hidden flex items-center ml-7'}>
          <InstagramThumbnail summary={p} layoutMode={layoutMode} />
        </div>

        {/* Card Meta */}
        <div
          className={`${
            layoutMode === 'grid' ? 'p-2.5 bg-[#090c12] flex-col' : 'p-2 flex-row items-center justify-between'
          } flex-1 flex min-w-0`}
        >
          <div
            className={`flex items-start ${
              layoutMode === 'grid' ? 'justify-between mb-1.5' : 'justify-between flex-1 mr-4'
            }`}
          >
            <div className="overflow-hidden min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-1">
                {p.firstLayerType === 'video' ? (
                  <Film size={11} className="text-slate-400 group-hover:text-cyan-400 transition-colors shrink-0" />
                ) : (
                  <ImageIcon size={11} className="text-slate-400 group-hover:text-cyan-400 transition-colors shrink-0" />
                )}
                <h3
                  className={`${
                    layoutMode === 'grid' ? 'text-[11px]' : 'text-sm'
                  } font-bold text-white group-hover:text-cyan-400 transition-colors uppercase tracking-wider truncate`}
                  title={p.name}
                >
                  {p.name || 'DU_AN_KHONG_TEN'}
                </h3>
              </div>

              <div className="flex items-center justify-between gap-1 text-[8px] font-mono text-slate-500">
                <span>
                  {new Date(p.createdAt).toLocaleDateString('vi-VN', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  })}
                </span>
                
                {/* Folder Badge (Clickable to move) */}
                <button
                  onClick={(e) => openMoveFolderModal(e, p)}
                  className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300 border border-white/10 hover:border-cyan-400/30 truncate max-w-[95px] flex items-center gap-0.5 transition-colors"
                  title="Nhấn để chuyển thư mục"
                >
                  <Folder size={8} /> {folderName}
                </button>
              </div>
            </div>
          </div>

          <div className={`${layoutMode === 'grid' ? 'mt-auto pt-1 flex justify-between items-center border-t border-white/5' : 'flex items-center gap-1.5'}`}>
            <button
              onClick={(e) => openMoveFolderModal(e, p)}
              className="text-[9px] text-slate-500 hover:text-cyan-400 p-1 transition-colors flex items-center gap-1"
              title="Chuyển thư mục"
            >
              <Edit3 size={10} />
            </button>
            <button
              onClick={(e) => handleDeleteClick(e, p.id)}
              className="w-5 h-5 flex items-center justify-center bg-white/5 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30 border border-transparent rounded-sm transition-colors text-slate-500"
              title="Xóa dự án"
            >
              <Trash2 size={10} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-screen bg-[#050608] text-[#e2e8f0] font-sans flex flex-col overflow-hidden">
      {/* Header */}
      <header className="h-14 border-b border-white/10 bg-[#0a0c10] flex items-center justify-between px-4 sm:px-6 shrink-0 z-20 gap-3">
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 bg-cyan-500/20 border border-cyan-400/50 rounded flex items-center justify-center shadow-[0_0_10px_rgba(34,211,238,0.3)]">
            <div className="w-4 h-4 border-2 border-cyan-400 rounded-full animate-pulse"></div>
          </div>
          <div className="flex flex-col">
            <h1 className="text-xs sm:text-sm font-bold tracking-[0.2em] uppercase text-cyan-400">
              HỆ THỐNG X-RAY V2.0
            </h1>
            <span className="text-[8px] font-mono text-cyan-500/80 flex items-center gap-1">
              <Zap size={9} /> INSTAGRAM THUMBNAIL OPTIMIZED (~15KB)
            </span>
          </div>
        </div>

        {/* Search Input Box */}
        <div className="hidden sm:flex items-center flex-1 max-w-xs relative mx-2">
          <Search size={13} className="absolute left-3 text-slate-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Tìm theo tên dự án hoặc thư mục..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setDisplayLimit(48);
            }}
            className="w-full pl-8 pr-3 py-1.5 bg-black/40 border border-white/10 rounded text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-400/60 transition-colors"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 text-[10px] text-slate-400 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex gap-2 items-center shrink-0">
          {projects.length > 0 && (
            <label className="hidden sm:flex items-center gap-1.5 mr-1 text-[10px] text-slate-400 uppercase tracking-widest cursor-pointer hover:text-white transition-colors">
              <input
                type="checkbox"
                checked={selectedProjects.length === filteredAndSortedProjects.length && filteredAndSortedProjects.length > 0}
                onChange={(e) => {
                  if (e.target.checked) setSelectedProjects(filteredAndSortedProjects.map((p) => p.id));
                  else setSelectedProjects([]);
                }}
                className="w-3.5 h-3.5 accent-cyan-500 bg-black/50 border border-white/20 rounded cursor-pointer"
              />
              Tất cả
            </label>
          )}

          {selectedProjects.length > 0 && (
            <>
              <button
                onClick={openBatchMoveModal}
                className="px-2.5 py-1.5 bg-cyan-500/15 border border-cyan-400/40 text-cyan-300 rounded-sm text-[11px] uppercase tracking-widest hover:bg-cyan-500/25 hover:text-white transition-colors flex items-center gap-1.5 shadow-[0_0_10px_rgba(34,211,238,0.15)] font-semibold"
                title={`Di chuyển ${selectedProjects.length} dự án đã chọn sang thư mục khác`}
              >
                <Folder size={12} className="text-cyan-400" /> Di chuyển ({selectedProjects.length})
              </button>
              <button
                onClick={() => setDeleteConfirm('SELECTED')}
                className="px-2.5 py-1.5 bg-red-500/10 border border-red-500/30 text-red-500 rounded-sm text-[11px] uppercase tracking-widest hover:bg-red-500 hover:text-white transition-colors flex items-center gap-1.5"
              >
                <Trash2 size={12} /> Xóa ({selectedProjects.length})
              </button>
            </>
          )}

          <div className="flex gap-1 items-center mr-2 border-r border-white/10 pr-2">
            <button
              onClick={() => toggleLayout('grid')}
              className={`p-1.5 rounded-sm transition-colors ${
                layoutMode === 'grid' ? 'bg-white/10 text-cyan-400' : 'text-slate-500 hover:text-white'
              }`}
              title="Lưới"
            >
              <LayoutGrid size={14} />
            </button>
            <button
              onClick={() => toggleLayout('list')}
              className={`p-1.5 rounded-sm transition-colors ${
                layoutMode === 'list' ? 'bg-white/10 text-cyan-400' : 'text-slate-500 hover:text-white'
              }`}
              title="Danh sách"
            >
              <List size={14} />
            </button>
          </div>

          <button
            onClick={() => setIsAfterModalOpen(true)}
            className="px-3 py-1.5 bg-cyan-500/20 border border-cyan-400 text-cyan-300 rounded-sm text-[11px] uppercase tracking-widest hover:bg-cyan-500/30 transition-colors flex items-center gap-1.5 shadow-[0_0_12px_rgba(34,211,238,0.2)] font-semibold"
            title="Upload ảnh AFTER và tự động đọc metadata để tìm ảnh gốc"
          >
            <Sparkles size={13} className="text-cyan-400" />
            Ghép ảnh AFTER
          </button>

          <button
            onClick={handleNewProject}
            className="px-3.5 py-1.5 bg-cyan-500/10 border border-cyan-400/30 text-cyan-400 rounded-sm text-[11px] uppercase tracking-widest hover:bg-cyan-500/20 transition-colors"
          >
            Dự án mới
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex flex-1 overflow-hidden relative">
        <div
          className="absolute inset-0 pointer-events-none z-0"
          style={{
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        ></div>

        {/* Sidebar with Folder Categories */}
        <aside className="w-60 border-r border-white/5 bg-[#08090c] flex flex-col z-10 shrink-0 hidden md:flex overflow-y-auto">
          {/* Folders List Navigation */}
          <div className="p-4 border-b border-white/5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-slate-500 flex items-center gap-1.5">
                <Folders size={12} className="text-cyan-400" /> Thư mục dự án
              </h2>
              <span className="text-[9px] font-mono text-cyan-400 px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20">
                {distinctFolders.length} Thư mục
              </span>
            </div>

            <div className="space-y-1">
              {/* All Folders Option */}
              <button
                onClick={() => setSelectedFolderFilter('ALL')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded text-xs transition-all ${
                  selectedFolderFilter === 'ALL'
                    ? 'bg-cyan-500/15 text-cyan-300 font-bold border-l-2 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.1)]'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <Folders size={13} className={selectedFolderFilter === 'ALL' ? 'text-cyan-400' : 'text-slate-500'} />
                  <span>Tất cả dự án</span>
                </div>
                <span className="text-[10px] font-mono opacity-80 bg-black/40 px-1.5 py-0.5 rounded">
                  {projects.length}
                </span>
              </button>

              {/* Individual Folder Items */}
              {distinctFolders.map((folder) => {
                const count = folderCounts[folder] || 0;
                const isActive = selectedFolderFilter === folder;

                return (
                  <div
                    key={folder}
                    className={`group/folder relative w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition-all ${
                      isActive
                        ? 'bg-cyan-500/15 text-cyan-300 font-bold border-l-2 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.1)]'
                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <button
                      onClick={() => setSelectedFolderFilter(folder)}
                      className="flex items-center gap-2 truncate flex-1 text-left py-0.5"
                      title={folder}
                    >
                      {isActive ? (
                        <FolderOpen size={13} className="text-cyan-400 shrink-0" />
                      ) : (
                        <Folder size={13} className="text-slate-500 shrink-0" />
                      )}
                      <span className="truncate">{folder}</span>
                    </button>

                    <div className="flex items-center gap-1 shrink-0 ml-1">
                      {/* Hover action icons: Edit and Delete */}
                      <div className="hidden group-hover/folder:flex items-center gap-0.5 bg-[#0f121a] px-1 py-0.5 rounded border border-white/10 shadow-md">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openRenameFolderModal(folder);
                          }}
                          className="p-1 hover:text-cyan-300 text-slate-400 hover:bg-white/10 rounded transition-colors"
                          title={`Đổi tên thư mục "${folder}"`}
                        >
                          <Edit2 size={11} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openDeleteFolderModal(folder);
                          }}
                          className="p-1 hover:text-red-400 text-slate-400 hover:bg-red-500/10 rounded transition-colors"
                          title={`Xóa thư mục "${folder}"`}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>

                      <span className="text-[10px] font-mono opacity-80 bg-black/40 px-1.5 py-0.5 rounded">
                        {count}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick Grouping & Performance Summary */}
          <div className="p-4 border-b border-white/5 space-y-3">
            <h3 className="text-[9px] uppercase tracking-widest text-slate-500">Chế độ hiển thị</h3>
            <div className="space-y-1.5 text-xs">
              <button
                onClick={() => setGroupByFolder(true)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[11px] transition-colors border ${
                  groupByFolder
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40 font-semibold'
                    : 'bg-transparent text-slate-400 border-white/5 hover:bg-white/5'
                }`}
              >
                <Folder size={12} />
                <span>Phân chia theo thư mục</span>
              </button>
              <button
                onClick={() => setGroupByFolder(false)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[11px] transition-colors border ${
                  !groupByFolder
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40 font-semibold'
                    : 'bg-transparent text-slate-400 border-white/5 hover:bg-white/5'
                }`}
              >
                <LayoutGrid size={12} />
                <span>Hiển thị tất cả (Phẳng)</span>
              </button>
            </div>
          </div>

          <div className="mt-auto p-4 bg-black/20">
            <div className="flex items-center justify-between text-[10px] text-slate-500 uppercase tracking-widest mb-2">
              <span>Trạng thái</span>
            </div>
            <div className="space-y-1.5 text-[10px] font-mono leading-relaxed">
              <div className="flex justify-between">
                <span className="text-slate-500">BỘ NHỚ ẢNH:</span>
                <span className="text-cyan-400">THUMBNAIL/WEBP</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">THƯ VIỆN:</span>
                <span className="text-cyan-400">{projects.length} DỰ ÁN</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Projects View Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 z-10">
          <div className="max-w-7xl mx-auto space-y-4">
            {/* Mobile search */}
            <div className="sm:hidden relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                type="text"
                placeholder="Tìm theo tên dự án hoặc thư mục..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-2 bg-black/40 border border-white/10 rounded text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-400/60"
              />
            </div>

            {/* Scientific Filter & Sort Control Toolbar */}
            {projects.length > 0 && (
              <div className="bg-[#0b0e14] border border-white/10 rounded-xl p-3 space-y-3 shadow-lg">
                {/* Horizontal Folder Pills Filter */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 shrink-0 mr-1">
                    <Filter size={11} className="text-cyan-400" /> Thư mục:
                  </span>
                  
                  <button
                    onClick={() => setSelectedFolderFilter('ALL')}
                    className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all border shrink-0 ${
                      selectedFolderFilter === 'ALL'
                        ? 'bg-cyan-500/25 text-cyan-300 border-cyan-400/50 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                        : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    Tất cả ({projects.length})
                  </button>

                  {distinctFolders.map((folder) => {
                    const isSelected = selectedFolderFilter === folder;
                    const count = folderCounts[folder] || 0;
                    return (
                      <button
                        key={folder}
                        onClick={() => setSelectedFolderFilter(folder)}
                        className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all border shrink-0 flex items-center gap-1.5 ${
                          isSelected
                            ? 'bg-cyan-500/25 text-cyan-300 border-cyan-400/50 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                            : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        <Folder size={11} className={isSelected ? 'text-cyan-400' : 'text-slate-500'} />
                        <span>{folder}</span>
                        <span className="text-[10px] opacity-75 font-mono">({count})</span>
                      </button>
                    );
                  })}
                </div>

                {/* Secondary Bar: Sort & Grouping Controls */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/5">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span>
                      Hiển thị: <strong className="text-cyan-400">{filteredAndSortedProjects.length}</strong> / {projects.length} dự án
                    </span>
                    {selectedFolderFilter !== 'ALL' && (
                      <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 text-[10px] font-mono border border-cyan-500/20">
                        Thư mục: {selectedFolderFilter}
                      </span>
                    )}
                    {searchTerm && (
                      <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 text-[10px] font-mono border border-amber-500/20">
                        Tìm: "{searchTerm}"
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2.5 flex-wrap">
                    {/* Sort Dropdown */}
                    <div className="flex items-center gap-1.5 bg-black/50 border border-white/10 rounded-lg px-2.5 py-1 text-xs text-slate-300">
                      <ArrowUpDown size={12} className="text-cyan-400 shrink-0" />
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                        Sắp xếp:
                      </span>
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as SortOption)}
                        className="bg-transparent text-xs text-white focus:outline-none cursor-pointer pr-1"
                      >
                        <option value="date-desc" className="bg-[#0f131c]">⏱️ Mới nhất (Ngày tạo ↓)</option>
                        <option value="date-asc" className="bg-[#0f131c]">⏳ Cũ nhất (Ngày tạo ↑)</option>
                        <option value="name-asc" className="bg-[#0f131c]">🔤 Tên dự án: A → Z</option>
                        <option value="name-desc" className="bg-[#0f131c]">🔤 Tên dự án: Z → A</option>
                        <option value="folder-asc" className="bg-[#0f131c]">📁 Tên thư mục: A → Z</option>
                        <option value="layers-desc" className="bg-[#0f131c]">🥞 Số lớp: Nhiều → Ít</option>
                      </select>
                    </div>

                    {/* Grouping Toggle */}
                    <button
                      onClick={() => setGroupByFolder(!groupByFolder)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                        groupByFolder
                          ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40 shadow-[0_0_10px_rgba(34,211,238,0.15)]'
                          : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:text-white'
                      }`}
                      title={groupByFolder ? 'Đang bật phân nhóm theo thư mục' : 'Đang ở chế độ hiển thị phẳng'}
                    >
                      <Folder size={12} />
                      <span>{groupByFolder ? 'Phân theo thư mục' : 'Hiển thị phẳng'}</span>
                    </button>

                    {/* Expand/Collapse All when grouped */}
                    {groupByFolder && groupedFolderList.length > 1 && (
                      <div className="flex items-center gap-1 text-[11px] font-mono">
                        <button
                          onClick={expandAllFolders}
                          className="px-2 py-1 text-slate-400 hover:text-cyan-300 bg-white/5 hover:bg-white/10 rounded transition-colors"
                        >
                          Mở hết
                        </button>
                        <button
                          onClick={collapseAllFolders}
                          className="px-2 py-1 text-slate-400 hover:text-cyan-300 bg-white/5 hover:bg-white/10 rounded transition-colors"
                        >
                          Thu gọn
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Content Loading / Empty / Gallery */}
            {loading ? (
              <div className="flex flex-col items-center justify-center py-28 gap-3">
                <div className="w-8 h-8 border-2 border-cyan-400/20 border-t-cyan-400 rounded-full animate-spin" />
                <span className="text-xs font-mono text-slate-400">ĐANG TẢI THƯ VIỆN DỰ ÁN...</span>
              </div>
            ) : projects.length === 0 ? (
              <div className="text-center py-28 bg-white/[0.02] border border-dashed border-white/10 rounded-xl">
                <Layers size={44} className="mx-auto mb-4 text-slate-600" />
                <h3 className="text-sm font-bold text-white mb-2 uppercase tracking-wider">
                  CHƯA CÓ DỰ ÁN NÀO
                </h3>
                <p className="text-[11px] text-slate-400 mb-6 max-w-md mx-auto uppercase tracking-wide leading-relaxed">
                  Tải ảnh AFTER để tự động nhận dạng ảnh gốc hoặc khởi tạo môi trường dự án mới.
                </p>
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() => setIsAfterModalOpen(true)}
                    className="px-6 py-2.5 bg-cyan-500/20 border border-cyan-400 text-cyan-300 rounded-sm text-[11px] uppercase tracking-widest hover:bg-cyan-500/30 transition-colors flex items-center gap-2 shadow-[0_0_15px_rgba(34,211,238,0.25)] font-bold"
                  >
                    <Sparkles size={14} className="text-cyan-400" />
                    GHÉP ẢNH AFTER (TỰ TÌM ẢNH GỐC)
                  </button>
                  <button
                    onClick={handleNewProject}
                    className="px-6 py-2.5 bg-cyan-500/10 border border-cyan-400/30 text-cyan-400 rounded-sm text-[11px] uppercase tracking-widest hover:bg-cyan-500/20 transition-colors"
                  >
                    KHỞI TẠO DỰ ÁN MỚI
                  </button>
                </div>
              </div>
            ) : filteredAndSortedProjects.length === 0 ? (
              <div className="text-center py-20 bg-white/[0.02] border border-white/5 rounded-xl">
                <p className="text-xs text-slate-400">
                  Không tìm thấy dự án nào khớp với tiêu chí lọc
                  {searchTerm && ` "${searchTerm}"`}
                  {selectedFolderFilter !== 'ALL' && ` trong thư mục "${selectedFolderFilter}"`}.
                </p>
                <div className="flex justify-center gap-2 mt-4">
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm('')}
                      className="px-3 py-1 bg-white/10 rounded text-xs text-cyan-400 hover:bg-white/20"
                    >
                      Xóa từ khóa
                    </button>
                  )}
                  {selectedFolderFilter !== 'ALL' && (
                    <button
                      onClick={() => setSelectedFolderFilter('ALL')}
                      className="px-3 py-1 bg-white/10 rounded text-xs text-cyan-400 hover:bg-white/20"
                    >
                      Xem tất cả thư mục
                    </button>
                  )}
                </div>
              </div>
            ) : groupByFolder ? (
              /* Grouped by Folder View */
              <div className="space-y-6">
                {groupedFolderList.map((group) => {
                  const isCollapsed = Boolean(collapsedFolders[group.folder]);
                  const groupItemIds = group.items.map((it) => it.id);
                  const isAllGroupSelected =
                    groupItemIds.length > 0 && groupItemIds.every((id) => selectedProjects.includes(id));
                  const isSomeGroupSelected =
                    groupItemIds.some((id) => selectedProjects.includes(id)) && !isAllGroupSelected;

                  const handleToggleSelectGroup = (e: React.MouseEvent | React.ChangeEvent) => {
                    e.stopPropagation();
                    if (isAllGroupSelected) {
                      setSelectedProjects((prev) => prev.filter((id) => !groupItemIds.includes(id)));
                    } else {
                      setSelectedProjects((prev) => {
                        const set = new Set([...prev, ...groupItemIds]);
                        return Array.from(set);
                      });
                    }
                  };

                  return (
                    <div
                      key={group.folder}
                      className="bg-white/[0.015] border border-white/10 rounded-xl overflow-hidden shadow-lg transition-all"
                    >
                      {/* Folder Section Header */}
                      <div
                        onClick={() => toggleFolderCollapse(group.folder)}
                        className="px-4 py-3 bg-[#0d1017] hover:bg-[#121620] border-b border-white/5 flex items-center justify-between cursor-pointer transition-colors select-none"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Folder Select All Checkbox */}
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center pr-1 py-1"
                            title={
                              isAllGroupSelected
                                ? `Bỏ chọn tất cả dự án trong "${group.folder}"`
                                : `Chọn tất cả ${group.items.length} dự án trong "${group.folder}"`
                            }
                          >
                            <input
                              type="checkbox"
                              checked={isAllGroupSelected}
                              ref={(el) => {
                                if (el) el.indeterminate = isSomeGroupSelected;
                              }}
                              onChange={handleToggleSelectGroup}
                              className="w-4 h-4 accent-cyan-500 bg-black/60 border border-white/30 rounded cursor-pointer"
                            />
                          </div>

                          <button
                            className="p-1 rounded text-slate-400 hover:text-white"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFolderCollapse(group.folder);
                            }}
                          >
                            {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                          </button>

                          <div className="w-7 h-7 rounded bg-cyan-500/15 border border-cyan-400/30 flex items-center justify-center text-cyan-400 shrink-0">
                            {isCollapsed ? <Folder size={14} /> : <FolderOpen size={14} />}
                          </div>

                          <div className="flex items-center gap-2 truncate">
                            <h2 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider truncate">
                              {group.folder}
                            </h2>
                            <span className="px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 font-mono text-[10px] font-semibold border border-cyan-400/20 shrink-0">
                              {group.items.length} DỰ ÁN
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 text-slate-500 text-xs">
                          <span className="text-[10px] font-mono hidden sm:inline">
                            {isCollapsed ? 'Nhấn để mở rộng' : 'Nhấn để thu gọn'}
                          </span>
                        </div>
                      </div>

                      {/* Folder Items Grid */}
                      {!isCollapsed && (
                        <div className="p-4">
                          <div
                            className={`grid gap-3 ${
                              layoutMode === 'grid'
                                ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10'
                                : 'grid-cols-1'
                            }`}
                          >
                            {group.items.map((p) => renderCard(p))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Flat View */
              <>
                <div
                  className={`grid gap-3 ${
                    layoutMode === 'grid'
                      ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10'
                      : 'grid-cols-1'
                  }`}
                >
                  {visibleFlatProjects.map((p) => renderCard(p))}
                </div>

                {/* Infinite Scroll Trigger & Counter for flat view */}
                <div ref={loadMoreSentinelRef} className="py-6 flex flex-col items-center justify-center gap-2">
                  <div className="text-[10px] font-mono text-slate-500">
                    Đang hiển thị {visibleFlatProjects.length} / {filteredAndSortedProjects.length} dự án
                  </div>
                  {visibleFlatProjects.length < filteredAndSortedProjects.length && (
                    <button
                      onClick={() => setDisplayLimit((prev) => Math.min(prev + 36, filteredAndSortedProjects.length))}
                      className="px-4 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded text-xs text-cyan-400 font-mono transition-colors"
                    >
                      Tải thêm dự án (+36)
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </main>
      </div>

      {/* Footer */}
      <footer className="h-8 border-t border-white/10 bg-[#050608] flex items-center justify-between px-4 text-[9px] font-mono text-slate-500 shrink-0 z-20">
        <div className="flex gap-4">
          <span>HE_THONG_SAN_SANG</span>
          <span className="text-cyan-500">THUMBNAIL_OPTIMIZER: ACTIVE</span>
          <span className="text-green-500 hidden sm:inline">MEMORY: MINIMAL (~15KB/ITEM)</span>
        </div>
        <div className="flex items-center gap-3">
          <span>THƯ MỤC: {distinctFolders.length}</span>
          <span>DỰ ÁN: {projects.length}</span>
        </div>
      </footer>

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setDeleteConfirm(null)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-[#0f1115] border border-white/10 p-6 rounded-lg shadow-2xl max-w-sm w-full m-4 pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-sm font-bold text-white mb-2 uppercase tracking-wider">Xác nhận xóa</h3>
              <p className="text-[11px] text-slate-400 mb-6 uppercase tracking-wide">
                Bạn có chắc chắn muốn xóa {deleteConfirm === 'SELECTED' ? `${selectedProjects.length} dự án đã chọn` : 'dự án này'}?
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="px-4 py-2 rounded text-[11px] font-semibold text-slate-400 hover:text-white transition-colors uppercase tracking-widest"
                >
                  HỦY
                </button>
                <button
                  onClick={confirmDelete}
                  className="px-4 py-2 rounded bg-red-500/10 text-red-500 font-semibold text-[11px] border border-red-500/20 hover:bg-red-500 hover:text-white transition-colors uppercase tracking-widest"
                >
                  XÓA BẢN GHI
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Move Project to Folder Modal */}
      <AnimatePresence>
        {movingProject && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => setMovingProject(null)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-[#0f121a] border border-cyan-500/40 rounded-xl p-5 max-w-md w-full shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  <Folder className="text-cyan-400" size={16} />
                  <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider">
                    Chuyển Thư Mục Cho Dự Án
                  </h3>
                </div>
                <button onClick={() => setMovingProject(null)} className="text-slate-400 hover:text-white">
                  <X size={16} />
                </button>
              </div>

              <div className="text-xs text-slate-300 space-y-1">
                <div className="text-slate-400">Tên dự án:</div>
                <div className="font-bold text-white truncate bg-black/40 p-2 rounded border border-white/5">
                  {movingProject.name}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs text-slate-400 font-semibold">Chọn thư mục đích:</div>

                {isMoveNewFolder ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={newMoveFolderName}
                      onChange={(e) => setNewMoveFolderName(e.target.value)}
                      placeholder="Nhập tên thư mục mới..."
                      autoFocus
                      className="w-full px-3 py-2 bg-black/60 border border-cyan-400/60 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                    />
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-slate-500">Tạo thư mục mới</span>
                      <button
                        onClick={() => {
                          setIsMoveNewFolder(false);
                          setNewMoveFolderName('');
                        }}
                        className="text-cyan-400 hover:underline cursor-pointer"
                      >
                        Chọn thư mục có sẵn
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <select
                      value={moveTargetFolder}
                      onChange={(e) => {
                        if (e.target.value === '__NEW__') {
                          setIsMoveNewFolder(true);
                        } else {
                          setMoveTargetFolder(e.target.value);
                        }
                      }}
                      className="w-full px-3 py-2 bg-black/60 border border-white/15 rounded-lg text-xs text-white focus:outline-none focus:border-cyan-400 cursor-pointer"
                    >
                      <option value="Khác">📁 Khác (Mặc định)</option>
                      {distinctFolders
                        .filter((f) => f !== 'Khác')
                        .map((folder) => (
                          <option key={folder} value={folder}>
                            📁 {folder}
                          </option>
                        ))}
                    </select>

                    <button
                      onClick={() => setIsMoveNewFolder(true)}
                      className="w-full py-1.5 text-xs text-cyan-400 hover:text-cyan-300 font-semibold bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 rounded-md transition-colors flex items-center justify-center gap-1.5"
                    >
                      <FolderPlus size={13} /> + Tạo thư mục mới
                    </button>
                  </div>
                )}
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-white/5">
                <button
                  onClick={() => setMovingProject(null)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white transition-colors uppercase tracking-wider"
                >
                  HỦY
                </button>
                <button
                  onClick={confirmMoveFolder}
                  className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs uppercase tracking-wider transition-all shadow-[0_0_12px_rgba(34,211,238,0.3)]"
                >
                  XÁC NHẬN CHUYỂN
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rename Folder Modal */}
      <AnimatePresence>
        {renamingFolder && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => setRenamingFolder(null)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-[#0f121a] border border-cyan-500/40 rounded-xl p-5 max-w-md w-full shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  <Edit2 className="text-cyan-400" size={16} />
                  <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider">
                    Đổi Tên Thư Mục
                  </h3>
                </div>
                <button onClick={() => setRenamingFolder(null)} className="text-slate-400 hover:text-white">
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-3">
                <div className="text-xs text-slate-400">
                  Thư mục hiện tại:{' '}
                  <strong className="text-white font-mono bg-white/5 px-2 py-0.5 rounded">
                    {renamingFolder.oldName}
                  </strong>{' '}
                  ({renamingFolder.currentCount} dự án)
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Tên thư mục mới:</label>
                  <input
                    type="text"
                    value={newFolderNameInput}
                    onChange={(e) => setNewFolderNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') confirmRenameFolder();
                      if (e.key === 'Escape') setRenamingFolder(null);
                    }}
                    placeholder="Nhập tên thư mục mới..."
                    autoFocus
                    className="w-full px-3 py-2 bg-black/60 border border-cyan-400/60 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Tất cả {renamingFolder.currentCount} dự án trong thư mục này sẽ được tự động cập nhật sang tên mới.
                </p>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-white/5">
                <button
                  onClick={() => setRenamingFolder(null)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white transition-colors uppercase tracking-wider"
                >
                  HỦY
                </button>
                <button
                  onClick={confirmRenameFolder}
                  disabled={!newFolderNameInput.trim() || newFolderNameInput.trim() === renamingFolder.oldName}
                  className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-black font-bold text-xs uppercase tracking-wider transition-all shadow-[0_0_12px_rgba(34,211,238,0.3)]"
                >
                  LƯU TÊN MỚI
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Folder Modal */}
      <AnimatePresence>
        {deletingFolder && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => setDeletingFolder(null)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-[#0f121a] border border-red-500/40 rounded-xl p-5 max-w-md w-full shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2 text-red-400">
                  <Trash2 size={16} />
                  <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider">
                    Xác Nhận Xóa Thư Mục
                  </h3>
                </div>
                <button onClick={() => setDeletingFolder(null)} className="text-slate-400 hover:text-white">
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-3">
                <p className="text-xs text-slate-300">
                  Bạn có chắc chắn muốn xóa thư mục{' '}
                  <strong className="text-white font-mono bg-white/5 px-2 py-0.5 rounded">
                    {deletingFolder.name}
                  </strong>
                  ? Thư mục này hiện có{' '}
                  <strong className="text-cyan-400">{deletingFolder.count} dự án</strong>.
                </p>

                {deletingFolder.count > 0 && deletingFolder.name !== 'Khác' && (
                  <div className="space-y-2 p-3 bg-black/40 border border-white/10 rounded-lg text-xs">
                    <div className="text-slate-400 font-semibold mb-1">Lựa chọn xử lý dự án bên trong:</div>
                    <label className="flex items-start gap-2 cursor-pointer text-slate-300 hover:text-white">
                      <input
                        type="radio"
                        name="deleteFolderAction"
                        checked={deleteFolderAction === 'move_to_khac'}
                        onChange={() => setDeleteFolderAction('move_to_khac')}
                        className="mt-0.5 accent-cyan-500"
                      />
                      <span>
                        Chuyển tất cả <strong>{deletingFolder.count} dự án</strong> về thư mục <strong>"Khác"</strong>{' '}
                        <span className="text-cyan-400 text-[10px] block">(Khuyên dùng để giữ lại dự án)</span>
                      </span>
                    </label>

                    <label className="flex items-start gap-2 cursor-pointer text-slate-300 hover:text-red-400 pt-1 border-t border-white/5">
                      <input
                        type="radio"
                        name="deleteFolderAction"
                        checked={deleteFolderAction === 'delete_projects'}
                        onChange={() => setDeleteFolderAction('delete_projects')}
                        className="mt-0.5 accent-red-500"
                      />
                      <span>
                        Xóa vĩnh viễn cả thư mục và toàn bộ <strong>{deletingFolder.count} dự án</strong> bên trong
                      </span>
                    </label>
                  </div>
                )}

                {deletingFolder.count > 0 && deletingFolder.name === 'Khác' && (
                  <div className="p-2.5 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300 flex items-start gap-2">
                    <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                    <span>
                      Hành động này sẽ <strong>xóa vĩnh viễn toàn bộ {deletingFolder.count} dự án</strong> trong thư mục Khác. Không thể khôi phục!
                    </span>
                  </div>
                )}

                {deletingFolder.count === 0 && (
                  <p className="text-xs text-slate-400">
                    Thư mục này hiện không có dự án nào và sẽ được dọn sạch.
                  </p>
                )}
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-white/5">
                <button
                  onClick={() => setDeletingFolder(null)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white transition-colors uppercase tracking-wider"
                >
                  HỦY
                </button>
                <button
                  onClick={confirmDeleteFolder}
                  className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-400 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-[0_0_12px_rgba(239,68,68,0.3)]"
                >
                  XÁC NHẬN XÓA
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Batch Move Projects Modal */}
      <AnimatePresence>
        {isBatchMoveModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => {
              if (!isBatchMoving) setIsBatchMoveModalOpen(false);
            }}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-[#0f121a] border border-cyan-500/40 rounded-xl p-5 max-w-md w-full shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  <Folder className="text-cyan-400" size={16} />
                  <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider">
                    Di Chuyển {selectedProjects.length} Dự Án
                  </h3>
                </div>
                <button
                  onClick={() => {
                    if (!isBatchMoving) setIsBatchMoveModalOpen(false);
                  }}
                  disabled={isBatchMoving}
                  className="text-slate-400 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-3">
                <div className="text-xs text-slate-300">
                  Chuyển <strong className="text-cyan-400">{selectedProjects.length} dự án đang chọn</strong> sang thư mục đích:
                </div>

                {isBatchMoveNewFolder ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={newBatchMoveFolderName}
                      onChange={(e) => setNewBatchMoveFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') confirmBatchMove();
                        if (e.key === 'Escape') setIsBatchMoveModalOpen(false);
                      }}
                      placeholder="Nhập tên thư mục mới..."
                      autoFocus
                      className="w-full px-3 py-2 bg-black/60 border border-cyan-400/60 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                    />
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-slate-500">Tạo thư mục mới</span>
                      <button
                        onClick={() => {
                          setIsBatchMoveNewFolder(false);
                          setNewBatchMoveFolderName('');
                        }}
                        className="text-cyan-400 hover:underline cursor-pointer"
                      >
                        Chọn thư mục có sẵn
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <select
                      value={batchMoveTargetFolder}
                      onChange={(e) => {
                        if (e.target.value === '__NEW__') {
                          setIsBatchMoveNewFolder(true);
                        } else {
                          setBatchMoveTargetFolder(e.target.value);
                        }
                      }}
                      className="w-full px-3 py-2 bg-black/60 border border-white/15 rounded-lg text-xs text-white focus:outline-none focus:border-cyan-400 cursor-pointer"
                    >
                      <option value="Khác">📁 Khác (Mặc định)</option>
                      {distinctFolders
                        .filter((f) => f !== 'Khác')
                        .map((folder) => (
                          <option key={folder} value={folder}>
                            📁 {folder}
                          </option>
                        ))}
                    </select>

                    <button
                      onClick={() => setIsBatchMoveNewFolder(true)}
                      className="w-full py-1.5 text-xs text-cyan-400 hover:text-cyan-300 font-semibold bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 rounded-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <FolderPlus size={13} /> + Tạo thư mục mới
                    </button>
                  </div>
                )}
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-white/5">
                <button
                  onClick={() => setIsBatchMoveModalOpen(false)}
                  disabled={isBatchMoving}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white transition-colors uppercase tracking-wider"
                >
                  HỦY
                </button>
                <button
                  onClick={confirmBatchMove}
                  disabled={isBatchMoving || (isBatchMoveNewFolder && !newBatchMoveFolderName.trim())}
                  className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-black font-bold text-xs uppercase tracking-wider transition-all shadow-[0_0_12px_rgba(34,211,238,0.3)] flex items-center gap-2"
                >
                  {isBatchMoving && <Loader2 size={13} className="animate-spin" />}
                  {isBatchMoving ? 'ĐANG CHUYỂN...' : `XÁC NHẬN CHUYỂN (${selectedProjects.length})`}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AfterImageModal
        isOpen={isAfterModalOpen}
        onClose={() => {
          setIsAfterModalOpen(false);
          loadProjects();
        }}
        onProjectReady={onOpenProject}
      />
    </div>
  );
}
