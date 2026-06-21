import React, { useEffect, useState, useRef } from 'react';
import { ProjectData } from '../types';
import { getProjects, deleteProject, saveProject } from '../db';
import { Trash2, Layers, LayoutGrid, List, Film, Image as ImageIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ProjectListProps {
  onOpenProject: (project: ProjectData) => void;
}

function ThumbnailView({ layers, layoutMode }: { layers: ProjectData['layers'], layoutMode: 'grid' | 'list' }) {
  const [hovered, setHovered] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  useEffect(() => {
    const newUrls: Record<string, string> = {};
    layers.forEach(l => {
      if (l.blob) {
        newUrls[l.id] = URL.createObjectURL(l.blob as Blob);
      }
    });
    setUrls(newUrls);

    return () => {
      Object.values(newUrls).forEach(url => URL.revokeObjectURL(url));
    };
  }, [layers]);

  useEffect(() => {
    Object.values(videoRefs.current).forEach((video: HTMLVideoElement | null) => {
      if (video) {
        if (hovered) {
          video.play().catch(() => {});
        } else {
          video.pause();
          video.currentTime = 0;
        }
      }
    });
  }, [hovered]);

  if (layers.length === 0) {
    return <div className={`flex items-center justify-center bg-[#050608] text-slate-700 ${layoutMode === 'grid' ? 'aspect-square w-full border-b border-white/5' : 'w-10 h-10 rounded shadow-md border border-white/10'}`}><Layers size={14} /></div>;
  }

  const containerClass = `relative overflow-hidden bg-[#050608] flex-shrink-0 ${layoutMode === 'grid' ? 'aspect-square w-full border-b border-white/5 opacity-80 group-hover:opacity-100 transition-opacity' : 'w-10 h-10 rounded shadow-md border border-white/10'}`;

  return (
    <div 
      className={containerClass}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {[...layers].reverse().map((layer, reverseIdx) => {
        const idx = layers.length - 1 - reverseIdx;
        const isLast = idx === layers.length - 1;
        const delay = hovered ? idx * 300 : 0;
        const url = urls[layer.id];
        if (!url) return null;
        
        return layer.type === 'video' ? (
          <video 
            key={layer.id} 
            ref={el => videoRefs.current[layer.id] = el}
            src={url || undefined}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${hovered && !isLast ? 'opacity-0' : 'opacity-100'}`}
            style={{ transitionDelay: `${delay}ms` }}
            muted loop playsInline
          />
        ) : (
          <img 
            key={layer.id} 
            src={url || undefined}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${hovered && !isLast ? 'opacity-0' : 'opacity-100'}`}
            style={{ transitionDelay: `${delay}ms` }}
          />
        );
      })}
    </div>
  );
}

export default function ProjectList({ onOpenProject }: ProjectListProps) {
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);

  const [layoutMode, setLayoutMode] = useState<'grid' | 'list'>((localStorage.getItem('projectLayout') as 'grid' | 'list') || 'grid');

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const data = await getProjects();
      setProjects(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const toggleLayout = (mode: 'grid' | 'list') => {
    setLayoutMode(mode);
    localStorage.setItem('projectLayout', mode);
  };

  const handleNewProject = async () => {
    const newP: ProjectData = {
      id: Date.now().toString(),
      name: 'DU_AN_MOI',
      createdAt: Date.now(),
      layers: []
    };
    onOpenProject(newP);
  };

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleteConfirm(id);
  };

  const confirmDelete = async () => {
    if (deleteConfirm) {
      try {
        if (deleteConfirm === 'SELECTED') {
          await Promise.all(selectedProjects.map(id => deleteProject(id)));
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

  return (
    <div className="h-screen bg-[#050608] text-[#e2e8f0] font-sans flex flex-col overflow-hidden">
      <header className="h-14 border-b border-white/10 bg-[#0a0c10] flex items-center justify-between px-6 shrink-0 z-20">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-cyan-500/20 border border-cyan-400/50 rounded flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-cyan-400 rounded-full animate-pulse"></div>
          </div>
          <h1 className="text-sm font-bold tracking-[0.2em] uppercase text-cyan-400">HỆ THỐNG X-RAY V2.0</h1>
        </div>
        <div className="hidden md:flex items-center gap-6 text-[11px] font-mono tracking-wider opacity-60">
          <div className="flex items-center gap-2"><span className="w-2 h-2 bg-green-500 rounded-full"></span> ENGINE: CANVAS/2D</div>
          <div className="flex items-center gap-2"><span className="w-2 h-2 bg-cyan-500 rounded-full"></span> STORAGE: INDEXED_DB</div>
        </div>
        <div className="flex gap-2 items-center">
          {projects.length > 0 && (
            <label className="flex items-center gap-1.5 mr-2 text-[10px] text-slate-400 uppercase tracking-widest cursor-pointer hover:text-white transition-colors">
              <input 
                type="checkbox"
                checked={selectedProjects.length === projects.length && projects.length > 0}
                onChange={(e) => {
                  if (e.target.checked) setSelectedProjects(projects.map(p => p.id));
                  else setSelectedProjects([]);
                }}
                className="w-3.5 h-3.5 accent-cyan-500 bg-black/50 border border-white/20 rounded cursor-pointer"
              />
              Tất cả
            </label>
          )}

          {selectedProjects.length > 0 && (
            <button
              onClick={() => setDeleteConfirm('SELECTED')}
              className="px-3 py-1.5 bg-red-500/10 border border-red-500/30 text-red-500 rounded-sm text-[11px] uppercase tracking-widest hover:bg-red-500 hover:text-white transition-colors mr-2 flex items-center gap-1.5"
            >
              <Trash2 size={12} /> Xóa ({selectedProjects.length})
            </button>
          )}

          <div className="flex gap-1 items-center mr-4 border-r border-white/10 pr-4">
            <button
              onClick={() => toggleLayout('grid')}
              className={`p-1.5 rounded-sm transition-colors ${layoutMode === 'grid' ? 'bg-white/10 text-cyan-400' : 'text-slate-500 hover:text-white'}`}
            >
              <LayoutGrid size={14} />
            </button>
            <button
              onClick={() => toggleLayout('list')}
              className={`p-1.5 rounded-sm transition-colors ${layoutMode === 'list' ? 'bg-white/10 text-cyan-400' : 'text-slate-500 hover:text-white'}`}
            >
              <List size={14} />
            </button>
          </div>
          <button
            onClick={handleNewProject}
            className="px-4 py-1.5 bg-cyan-500/10 border border-cyan-400/30 text-cyan-400 rounded-sm text-[11px] uppercase tracking-widest hover:bg-cyan-500/20 transition-colors"
          >
            Dự án mới
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        <div className="absolute inset-0 pointer-events-none z-0" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '32px 32px' }}></div>
        
        <aside className="w-60 border-r border-white/5 bg-[#08090c] flex flex-col z-10 shrink-0 hidden md:flex">
          <div className="p-4 border-b border-white/5">
            <h2 className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-4">Bảng điều khiển</h2>
            <div className="space-y-1">
              <div className="p-3 bg-cyan-500/10 border-l-2 border-cyan-400 rounded-r flex flex-col gap-1 cursor-pointer">
                <span className="text-xs font-medium text-white">Thư viện dự án</span>
                <span className="text-[10px] text-slate-500">Tổng: {projects.length}</span>
              </div>
            </div>
          </div>
          <div className="mt-auto p-4 bg-black/20">
            <div className="flex items-center justify-between text-[10px] text-slate-500 uppercase tracking-widest mb-2">
              <span>Trạng thái</span>
            </div>
            <div className="space-y-2 text-[10px] leading-relaxed">
              <div className="flex justify-between"><span>Cơ sở dữ liệu</span> <span className="text-cyan-400">Đã kết nối</span></div>
              <div className="flex justify-between"><span>Hệ thống tệp</span> <span className="text-cyan-400">Sẵn sàng</span></div>
            </div>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto p-6 md:p-12 z-10">
          <div className="max-w-6xl mx-auto">
            {loading ? (
              <div className="flex justify-center py-20">
                <div className="w-8 h-8 border-2 border-cyan-400/20 border-t-cyan-400 rounded-full animate-spin" />
              </div>
            ) : projects.length === 0 ? (
              <div className="text-center py-32 bg-white/[0.02] border border-dashed border-white/10 rounded-lg">
                <Layers size={48} className="mx-auto mb-6 text-slate-600" />
                <h3 className="text-[13px] font-bold text-white mb-2 uppercase tracking-wider">CHƯA CÓ DỰ ÁN NÀO</h3>
                <p className="text-[11px] text-slate-500 mb-8 max-w-md mx-auto uppercase tracking-wide">Khởi tạo môi trường dự án mới để bắt đầu thêm các lớp ảnh/video.</p>
                <button
                  onClick={handleNewProject}
                  className="px-6 py-2 bg-cyan-500/10 border border-cyan-400/30 text-cyan-400 rounded-sm text-[11px] uppercase tracking-widest hover:bg-cyan-500/20 transition-colors"
                >
                  KHỞI TẠO HỆ THỐNG
                </button>
              </div>
            ) : (
              <div className={`grid gap-3 ${layoutMode === 'grid' ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10' : 'grid-cols-1'}`}>
                <AnimatePresence>
                  {projects.map((p) => (
                    <motion.div
                      key={p.id}
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      onClick={() => onOpenProject(p)}
                      className={`group bg-white/[0.02] border border-white/5 rounded-lg cursor-pointer hover:bg-white/5 hover:border-white/10 transition-all shadow-xl flex overflow-hidden relative ${layoutMode === 'grid' ? 'flex-col' : 'flex-row items-center p-3 gap-6'}`}
                    >
                      <div 
                        className={`absolute z-10 ${layoutMode === 'grid' ? 'top-1.5 right-1.5' : 'left-3 top-1/2 -translate-y-1/2'}`} 
                        onClick={e => e.stopPropagation()}
                      >
                        <input 
                          type="checkbox"
                          checked={selectedProjects.includes(p.id)}
                          onChange={(e) => {
                             if (e.target.checked) setSelectedProjects(prev => [...prev, p.id]);
                             else setSelectedProjects(prev => prev.filter(id => id !== p.id));
                          }}
                          className="w-3 h-3 accent-cyan-500 bg-black/50 border border-white/20 rounded cursor-pointer"
                        />
                      </div>
                      
                      <div className={layoutMode === 'grid' ? '' : 'shrink-0 rounded overflow-hidden flex items-center ml-8'}>
                        <ThumbnailView layers={p.layers} layoutMode={layoutMode} />
                      </div>
                      <div className={`${layoutMode === 'grid' ? 'p-2' : 'p-3'} flex-1 flex ${layoutMode === 'grid' ? 'bg-[#0a0c10] flex-col' : 'flex-row items-center justify-between'}`}>
                        <div className={`flex items-start ${layoutMode === 'grid' ? 'justify-between mb-2' : 'justify-between flex-1 mr-6'}`}>
                          <div className="overflow-hidden">
                            <div className="flex items-center gap-1 mb-0.5">
                              {p.layers[0] && (
                                p.layers[0].type === 'video' ? <Film size={10} className="text-slate-400 group-hover:text-cyan-400 transition-colors shrink-0" /> : <ImageIcon size={10} className="text-slate-400 group-hover:text-cyan-400 transition-colors shrink-0" />
                              )}
                              <h3 className={`${layoutMode === 'grid' ? 'text-[10px]' : 'text-sm'} font-bold text-white group-hover:text-cyan-400 transition-colors uppercase tracking-wider truncate`} title={p.name}>
                                {p.name || 'DU_AN_KHONG_TEN'}
                              </h3>
                            </div>
                            <p className="text-[8px] text-slate-500 uppercase tracking-widest">
                              {new Date(p.createdAt).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </p>
                          </div>
                        </div>

                        <div className={`${layoutMode === 'grid' ? 'mt-auto flex justify-end' : 'flex items-center'}`}>
                          <button
                            onClick={(e) => handleDeleteClick(e, p.id)}
                            className="w-5 h-5 flex items-center justify-center bg-white/5 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30 border border-transparent rounded-sm transition-colors text-slate-500"
                            title="Xóa dự án"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </main>
      </div>

      <footer className="h-8 border-t border-white/10 bg-[#050608] flex items-center justify-between px-4 text-[9px] font-mono text-slate-500 shrink-0 z-20">
        <div className="flex gap-4">
          <span>HE_THONG_SAN_SANG</span>
          <span className="text-cyan-600">KET_NOI_DB: OK</span>
        </div>
      </footer>

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
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-sm font-bold text-white mb-2 uppercase tracking-wider">Xác nhận xóa hệ thống</h3>
              <p className="text-[11px] text-slate-400 mb-6 uppercase tracking-wide">Bạn có chắc chắn muốn xóa bản ghi này? Hành động này không thể hoàn tác.</p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 rounded text-[11px] font-semibold text-slate-400 hover:text-white transition-colors uppercase tracking-widest">
                  HỦY
                </button>
                <button onClick={confirmDelete} className="px-4 py-2 rounded bg-red-500/10 text-red-500 font-semibold text-[11px] border border-red-500/20 hover:bg-red-500 hover:text-white transition-colors uppercase tracking-widest">
                  XÓA BẢN GHI
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
