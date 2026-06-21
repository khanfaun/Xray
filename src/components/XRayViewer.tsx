import React, { useEffect, useRef, useState } from 'react';
import { ProjectData, LayerData } from '../types';
import { saveProject, getProjects } from '../db';
import { ArrowLeft, ArrowUp, ArrowDown, Trash2, RefreshCw, Maximize, ChevronLeft, ChevronRight, Box, Settings2, Undo2, Redo2, AlignCenter, Eye, EyeOff } from 'lucide-react';

function Thumbnail({ layer }: { layer: LayerData }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (!(layer.blob instanceof Blob)) return;
    const objectUrl = URL.createObjectURL(layer.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [layer.blob]);

  if (!url) return <div className="w-10 h-10 bg-white/5 rounded-sm animate-pulse shrink-0" />;

  return layer.type === 'video' ? (
    <video src={url || undefined} className="w-10 h-10 object-cover rounded-sm border border-white/10 shrink-0 bg-black/50" />
  ) : (
    <img src={url || undefined} className="w-10 h-10 object-cover rounded-sm border border-white/10 shrink-0 bg-black/50" />
  );
}

export default function XRayViewer({ initialProject, onBack }: { initialProject: ProjectData, onBack: () => void }) {
  const [project, setProject] = useState(initialProject);
  const projectRef = useRef(project);
  useEffect(() => { projectRef.current = project; }, [project]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elementsRef = useRef<{ type: 'image' | 'video', el: HTMLImageElement | HTMLVideoElement }[]>([]);
  
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loadedCount, setLoadedCount] = useState(0);
  const [error, setError] = useState('');

  const [zoomLevel, setZoomLevel] = useState(100);
  const apiRef = useRef<any>(null);
  
  const [allProjects, setAllProjects] = useState<ProjectData[]>([]);

  useEffect(() => {
    getProjects().then(setAllProjects).catch(console.error);
  }, [project]);  

  const defaultSettings = {
    lensBaseRadius: 160,
    lensShape: 0,
    viewMode: 'lens' as 'lens' | 'compare',
    compareBefore: 0,
    compareAfter: 1,
    autoAnimate: false,
    autoAnimateDir: 1,
    autoAnimateSpeed: 0.002,
    enable3D: false,
    intensity3D: 1,
    threshold3D: 0.2,
    easing3D: 0.5,
    depth: 0
  };
  
  let savedSettings = {};
  try {
    savedSettings = JSON.parse(localStorage.getItem('xraySettings') || '{}');
  } catch(e) {}
  const initSettings = { ...defaultSettings, ...savedSettings };

  const viewState = useRef({
    scale: 0,
    offsetX: 0,
    offsetY: 0,
    depth: initSettings.depth,
    lensBaseRadius: initSettings.lensBaseRadius,
    lensShape: initSettings.lensShape,
    viewMode: initSettings.viewMode,
    comparePos: 0.5,
    compareBefore: initSettings.compareBefore,
    compareAfter: initSettings.compareAfter,
    autoAnimate: initSettings.autoAnimate,
    autoAnimateDir: initSettings.autoAnimateDir,
    autoAnimateSpeed: initSettings.autoAnimateSpeed,
    enable3D: initSettings.enable3D,
    intensity3D: initSettings.intensity3D,
    threshold3D: initSettings.threshold3D,
    easing3D: initSettings.easing3D,
    parallaxX: 0,
    parallaxY: 0,
    smoothClientX: window.innerWidth / 2,
    smoothClientY: window.innerHeight / 2,
  });

  const [trigger, setTrigger] = useState(0);
  const forceUpdate = () => setTrigger(t => t + 1);

  const updateVS = (key: keyof typeof viewState.current, val: any) => {
    (viewState.current as any)[key] = val;
    const toSave = {
      lensBaseRadius: viewState.current.lensBaseRadius,
      lensShape: viewState.current.lensShape,
      viewMode: viewState.current.viewMode,
      compareBefore: viewState.current.compareBefore,
      compareAfter: viewState.current.compareAfter,
      autoAnimate: viewState.current.autoAnimate,
      autoAnimateDir: viewState.current.autoAnimateDir,
      autoAnimateSpeed: viewState.current.autoAnimateSpeed,
      enable3D: viewState.current.enable3D,
      intensity3D: viewState.current.intensity3D,
      threshold3D: viewState.current.threshold3D,
      easing3D: viewState.current.easing3D,
      depth: viewState.current.depth,
    };
    localStorage.setItem('xraySettings', JSON.stringify(toSave));
    forceUpdate();
  };

  const L = project.layers.length;
  const loaded = loadedCount === L && L > 0;

  useEffect(() => {
    viewState.current.scale = 0;
    // Clear and reset the mask to black when switching projects
    if (maskCanvasRef.current) {
      const mCtx = maskCtxRef.current;
      if (mCtx) {
        mCtx.fillStyle = '#000000';
        mCtx.fillRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
        updateAlphaMask();
      }
    }
  }, [project.id]);

  // Map URLs by layer.id to avoid reloading on reorder
  const blobsDep = [...project.layers].sort((a, b) => a.id.localeCompare(b.id)).map(l => l.id + '_' + (l.blob as any).lastModified + '_' + l.blob.size).join('|');

  useEffect(() => {
    elementsRef.current = [];
    const newUrls: Record<string, string> = {};
    project.layers.forEach(l => {
      if (l.blob instanceof Blob || l.blob instanceof File) {
        newUrls[l.id] = URL.createObjectURL(l.blob);
      }
    });
    setUrls(newUrls);
    setLoadedCount(0);
    return () => Object.values(newUrls).forEach(u => URL.revokeObjectURL(u));
  }, [blobsDep]);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const updateProject = (newP: ProjectData) => {
    if (newP.layers.length > 0) {
      newP.name = newP.layers[0].name;
    }
    setProject(newP);
    
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
       saveProject(newP).catch(console.error);
    }, 500);
  };

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    const newLayers: LayerData[] = files.map(file => ({
      id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
      name: file.name,
      type: (file.type.startsWith('video/') ? 'video' : 'image') as 'video' | 'image',
      blob: file
    }));

    updateProject({ ...project, layers: [...project.layers, ...newLayers] });
    e.target.value = '';
  };

  const handleReplaceLayer = (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (isEditModeRef.current) pushHistory(projectRef.current);
    updateProject({
      ...project,
      layers: project.layers.map((l, index) => {
        if (l.id === id) {
          const resetScale = index > 0 ? {
            layerScale: undefined,
            layerScaleX: undefined,
            layerScaleY: undefined,
            layerX: undefined,
            layerY: undefined
          } : {};
          return {
            ...l,
            name: file.name,
            type: file.type.startsWith('video/') ? 'video' : 'image',
            blob: file,
            ...resetScale
          };
        }
        return l;
      })
    });
    e.target.value = '';
  };

  // Auto-scale newly added/replaced layer 2,3... (index > 0) proportionally to match the height of layer 1 (index 0)
  useEffect(() => {
    if (!loaded) return;
    const firstEl = elementsRef.current[0]?.el;
    if (!firstEl) return;
    const firstH = firstEl instanceof HTMLVideoElement ? firstEl.videoHeight : (firstEl as HTMLImageElement).naturalHeight;
    if (!(firstH > 0)) return;

    let changed = false;
    const updatedLayers = projectRef.current.layers.map((layer, idx) => {
      if (idx === 0) return layer;
      
      const el = elementsRef.current[idx]?.el;
      if (!el) return layer;

      const h = el instanceof HTMLVideoElement ? el.videoHeight : (el as HTMLImageElement).naturalHeight;
      if (!(h > 0)) return layer;

      if (layer.layerScale === undefined && layer.layerScaleX === undefined && layer.layerScaleY === undefined) {
        const ratio = firstH / h;
        changed = true;
        return {
          ...layer,
          layerScale: ratio,
          layerScaleX: ratio,
          layerScaleY: ratio,
          layerX: 0,
          layerY: 0
        };
      }
      return layer;
    });

    if (changed) {
      updateProject({
        ...projectRef.current,
        layers: updatedLayers
      });
    }
  }, [loaded, project.id]);

  const [layerDeleteConfirm, setLayerDeleteConfirm] = useState<string | null>(null);

  const [isEditMode, setIsEditMode] = useState(false);
  const isEditModeRef = useRef(false);
  useEffect(() => { isEditModeRef.current = isEditMode; }, [isEditMode]);

  const [selectedEditLayerId, setSelectedEditLayerId] = useState<string | null>(null);
  const selectedEditLayerIdRef = useRef<string | null>(null);
  useEffect(() => { selectedEditLayerIdRef.current = selectedEditLayerId; }, [selectedEditLayerId]);

  // Mask logic state & refs
  const [isMaskOn, setIsMaskOn] = useState(false);
  const isMaskOnRef = useRef(false);
  useEffect(() => { isMaskOnRef.current = isMaskOn; }, [isMaskOn]);

  const [maskBrushType, setMaskBrushType] = useState<'brush' | 'eraser'>('brush');
  const maskBrushTypeRef = useRef<'brush' | 'eraser'>('brush');
  useEffect(() => { maskBrushTypeRef.current = maskBrushType; }, [maskBrushType]);

  const [maskBrushSize, setMaskBrushSize] = useState(30);
  const maskBrushSizeRef = useRef(30);
  useEffect(() => { maskBrushSizeRef.current = maskBrushSize; }, [maskBrushSize]);

  const [maskBrushHardness, setMaskBrushHardness] = useState(50);
  const maskBrushHardnessRef = useRef(50);
  useEffect(() => { maskBrushHardnessRef.current = maskBrushHardness; }, [maskBrushHardness]);

  const [maskBrushColor, setMaskBrushColor] = useState(255); // Grayscale [0, 255]
  const maskBrushColorRef = useRef(255);
  useEffect(() => { maskBrushColorRef.current = maskBrushColor; }, [maskBrushColor]);

  const [showMaskOverlay, setShowMaskOverlay] = useState(true);
  const showMaskOverlayRef = useRef(true);
  useEffect(() => { showMaskOverlayRef.current = showMaskOverlay; }, [showMaskOverlay]);

  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const alphaMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tempBlendCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const isDrawingMaskRef = useRef(false);
  const lastDrawingXRef = useRef(0);
  const lastDrawingYRef = useRef(0);

  const updateAlphaMask = () => {
    const mCanvas = maskCanvasRef.current;
    const mCtx = maskCtxRef.current;
    if (!mCanvas || !mCtx) return;
    
    if (!alphaMaskCanvasRef.current) {
      alphaMaskCanvasRef.current = document.createElement('canvas');
    }
    const aCanvas = alphaMaskCanvasRef.current;
    if (aCanvas.width !== mCanvas.width || aCanvas.height !== mCanvas.height) {
      aCanvas.width = mCanvas.width;
      aCanvas.height = mCanvas.height;
    }
    const aCtx = aCanvas.getContext('2d');
    if (!aCtx) return;
    
    if (!maskOverlayCanvasRef.current) {
      maskOverlayCanvasRef.current = document.createElement('canvas');
    }
    const oCanvas = maskOverlayCanvasRef.current;
    if (oCanvas.width !== mCanvas.width || oCanvas.height !== mCanvas.height) {
      oCanvas.width = mCanvas.width;
      oCanvas.height = mCanvas.height;
    }
    const oCtx = oCanvas.getContext('2d');
    if (!oCtx) return;
    
    try {
      const imgData = mCtx.getImageData(0, 0, mCanvas.width, mCanvas.height);
      const data = imgData.data;
      
      const overlayImgData = oCtx.createImageData(mCanvas.width, mCanvas.height);
      const oData = overlayImgData.data;
      
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i+1];
        const b = data[i+2];
        const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        
        // Alpha mask
        data[i] = 255;
        data[i+1] = 255;
        data[i+2] = 255;
        data[i+3] = luma;
        
        // Overlay (Red color #ef4444 = rgb(239, 68, 68))
        oData[i] = 239;
        oData[i+1] = 68;
        oData[i+2] = 68;
        oData[i+3] = Math.round(115 * (luma / 255));
      }
      aCtx.putImageData(imgData, 0, 0);
      oCtx.putImageData(overlayImgData, 0, 0);
    } catch (e) {
      console.error("Failed to update alpha mask:", e);
    }
  };

  const drawBrushStroke = (x1: number, y1: number, x2: number, y2: number) => {
    const ctx = maskCtxRef.current;
    if (!ctx) return;
    
    const r = maskBrushSizeRef.current;
    const h = maskBrushHardnessRef.current / 100;
    const brushType = maskBrushTypeRef.current;
    const brushColor = maskBrushColorRef.current;
    
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(dist / Math.max(1, r * 0.1)));
    
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = x1 + (x2 - x1) * t;
      const cy = y1 + (y2 - y1) * t;
      
      ctx.beginPath();
      if (h >= 0.95) {
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        if (brushType === 'eraser') {
          ctx.fillStyle = 'rgb(0, 0, 0)';
        } else {
          ctx.fillStyle = `rgb(${brushColor}, ${brushColor}, ${brushColor})`;
        }
        ctx.fill();
      } else {
        const grad = ctx.createRadialGradient(cx, cy, r * h, cx, cy, r);
        if (brushType === 'eraser') {
          grad.addColorStop(0, 'rgba(0, 0, 0, 1.0)');
          grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
        } else {
          grad.addColorStop(0, `rgba(${brushColor}, ${brushColor}, ${brushColor}, 1.0)`);
          grad.addColorStop(1, `rgba(${brushColor}, ${brushColor}, ${brushColor}, 0.0)`);
        }
        
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }
    }
    ctx.restore();
    
    updateAlphaMask();
  };

  const ensureMaskCanvasSize = (w: number, h: number) => {
    if (!maskCanvasRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);
        maskCanvasRef.current = canvas;
        maskCtxRef.current = ctx;
        updateAlphaMask();
      }
    } else if (maskCanvasRef.current.width !== w || maskCanvasRef.current.height !== h) {
      const oldCanvas = maskCanvasRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);
        try {
          ctx.drawImage(oldCanvas, 0, 0, w, h);
        } catch(e){}
        maskCanvasRef.current = canvas;
        maskCtxRef.current = ctx;
        updateAlphaMask();
      }
    }
  };

  const undoStackRef = useRef<ProjectData[]>([]);
  const redoStackRef = useRef<ProjectData[]>([]);

  const cloneProjectData = (data: ProjectData): ProjectData => {
    const cloned = JSON.parse(JSON.stringify(data));
    cloned.layers.forEach((l: LayerData, idx: number) => {
      l.blob = data.layers[idx].blob;
    });
    if (data.depthMap) {
      cloned.depthMap = data.depthMap;
    }
    return cloned;
  };

  const pushHistory = (state: ProjectData) => {
    undoStackRef.current.push(cloneProjectData(state));
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    redoStackRef.current = [];
  };

  const handleUndo = () => {
    if (undoStackRef.current.length === 0) return;
    const prev = undoStackRef.current.pop()!;
    redoStackRef.current.push(cloneProjectData(projectRef.current));
    updateProject(prev);
  };

  const handleRedo = () => {
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current.pop()!;
    undoStackRef.current.push(cloneProjectData(projectRef.current));
    updateProject(next);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isEditModeRef.current) return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
             handleRedo();
          } else {
             handleUndo();
          }
        } else if (e.key === 'y') {
          e.preventDefault();
          handleRedo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleAlignCenter = () => {
    if (!selectedEditLayerIdRef.current) return;
    const selIdx = projectRef.current.layers.findIndex(l => l.id === selectedEditLayerIdRef.current);
    if (selIdx === -1) return;
    
    pushHistory(projectRef.current);
    
    const newLayers = JSON.parse(JSON.stringify(projectRef.current.layers));
    newLayers[selIdx].layerX = 0;
    newLayers[selIdx].layerY = 0;
    
    updateProject({ ...projectRef.current, layers: newLayers });
  };

  const editStateRef = useRef({
     isDragging: false,
     isResizing: false,
     resizeHandle: null as string | null,
     startX: 0,
     startY: 0,
     startLayerX: 0,
     startLayerY: 0,
     startLayerScale: 1,
     startLayerScaleX: 1,
     startLayerScaleY: 1,
     startB_x: 0,
     startB_y: 0,
     startB_r: 0,
     startB_b: 0,
     startB_cx: 0,
     startB_cy: 0,
     startB_w: 0,
     startB_h: 0,
     snapLinesX: [] as number[],
     snapLinesY: [] as number[],
     activeSnapX: null as number | null,
     activeSnapY: null as number | null,
  });

  const getMasterDimensions = () => {
    let mw = 0;
    let mh = 0;
    elementsRef.current.forEach(e => {
      if (!e || !e.el) return;
      const w = e.el instanceof HTMLVideoElement ? e.el.videoWidth : (e.el as HTMLImageElement).naturalWidth;
      const h = e.el instanceof HTMLVideoElement ? e.el.videoHeight : (e.el as HTMLImageElement).naturalHeight;
      if (w > mw) mw = w;
      if (h > mh) mh = h;
    });
    return { imgW: mw || 800, imgH: mh || 600 };
  };

  const getLayerBounds = (idx: number) => {
    const lData = projectRef.current.layers[idx];
    const el = elementsRef.current[idx]?.el;
    if (!lData || !el) return null;
    const lScaleX = lData.layerScaleX ?? lData.layerScale ?? 1;
    const lScaleY = lData.layerScaleY ?? lData.layerScale ?? 1;
    const lX = lData.layerX ?? 0;
    const lY = lData.layerY ?? 0;
    const elW = el instanceof HTMLVideoElement ? el.videoWidth : (el as HTMLImageElement).naturalWidth;
    const elH = el instanceof HTMLVideoElement ? el.videoHeight : (el as HTMLImageElement).naturalHeight;
    const { imgW: masterW, imgH: masterH } = getMasterDimensions();

    const cx = (masterW / 2) + lX;
    const cy = (masterH / 2) + lY;
    const w = elW * lScaleX;
    const h = elH * lScaleY;
    return {
       cx, cy, w, h,
       x: cx - w/2,
       y: cy - h/2,
       r: cx + w/2,
       b: cy + h/2,
       lX, lY, elW, elH, lScale: (lScaleX + lScaleY) / 2,
       lScaleX,
       lScaleY
    };
  };

  const removeLayerClick = (id: string) => {
    setLayerDeleteConfirm(id);
  };

  const confirmRemoveLayer = () => {
    if (layerDeleteConfirm) {
      if (isEditModeRef.current) pushHistory(projectRef.current);
      updateProject({ ...project, layers: project.layers.filter(l => l.id !== layerDeleteConfirm) });
      setLayerDeleteConfirm(null);
    }
  };

  const toggleLayerVisibility = (id: string) => {
    if (isEditModeRef.current) pushHistory(projectRef.current);
    const newLayers = project.layers.map(l => {
      if (l.id === id) {
        return { ...l, visible: l.visible === false ? true : false };
      }
      return l;
    });
    updateProject({ ...project, layers: newLayers });
    
    const refIdx = projectRef.current.layers.findIndex(l => l.id === id);
    if (refIdx !== -1) {
      projectRef.current.layers[refIdx].visible = projectRef.current.layers[refIdx].visible === false ? true : false;
    }
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    if (isEditModeRef.current) pushHistory(projectRef.current);
    const newLayers = [...project.layers];
    [newLayers[index - 1], newLayers[index]] = [newLayers[index], newLayers[index - 1]];
    updateProject({ ...project, layers: newLayers });
  };

  const moveDown = (index: number) => {
    if (index === project.layers.length - 1) return;
    if (isEditModeRef.current) pushHistory(projectRef.current);
    const newLayers = [...project.layers];
    [newLayers[index + 1], newLayers[index]] = [newLayers[index], newLayers[index + 1]];
    updateProject({ ...project, layers: newLayers });
  };

  const handleDepthFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    updateProject({ ...project, depthMap: file });
    e.target.value = '';
  };

  const removeDepthMap = () => {
    updateProject({ ...project, depthMap: undefined });
  };

  const [depthUrl, setDepthUrl] = useState('');
  const depthImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (project.depthMap && project.depthMap instanceof Blob) {
      const url = URL.createObjectURL(project.depthMap);
      setDepthUrl(url);
      const img = new Image();
      img.onload = () => { depthImgRef.current = img; forceUpdate(); };
      img.src = url;
      return () => URL.revokeObjectURL(url);
    } else {
      setDepthUrl('');
      depthImgRef.current = null;
    }
  }, [project.depthMap]);

  const glContext = useRef<{
    canvas: HTMLCanvasElement;
    gl: WebGLRenderingContext;
    program: WebGLProgram;
    locImage: WebGLUniformLocation | null;
    locImageTop: WebGLUniformLocation | null;
    locDepth: WebGLUniformLocation | null;
    locFade: WebGLUniformLocation | null;
    locOffset: WebGLUniformLocation | null;
    locIntensity: WebGLUniformLocation | null;
    locThreshold: WebGLUniformLocation | null;
    locTexSize: WebGLUniformLocation | null;
    texImage: WebGLTexture;
    texImageTop: WebGLTexture;
    texDepth: WebGLTexture;
    depthUploaded?: boolean;
    depthUrl?: string;
  } | null>(null);

  const initWebGL = (imgW: number, imgH: number) => {
    const glCanvas = document.createElement('canvas');
    glCanvas.width = imgW;
    glCanvas.height = imgH;
    const gl = glCanvas.getContext('webgl', { premultipliedAlpha: false });
    if (!gl) return false;

    const vsSource = `
      attribute vec2 a_position;
      varying vec2 v_texCoord;
      void main() {
        v_texCoord = a_position * 0.5 + 0.5;
        v_texCoord.y = 1.0 - v_texCoord.y;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const fsSource = `
      precision highp float;
      varying vec2 v_texCoord;
      uniform sampler2D u_image;
      uniform sampler2D u_imageTop;
      uniform sampler2D u_depth;
      uniform float u_fade;
      uniform vec2 u_offset;
      uniform float u_intensity;
      uniform float u_threshold;

      void main() {
        // Sample depth and apply threshold processing
        float rawDepth = texture2D(u_depth, v_texCoord).r;
        float depth = smoothstep(u_threshold, 1.0, rawDepth);
        
        // Map depth from [0, 1] to [-1, 1] so foreground moves one way and background moves opposite
        // (subtracting 0.5 is standard to pivot around the mid-plane)
        float mappedDepth = (depth - 0.5) * 2.0;

        // Calculate offset (simple displacement)
        vec2 p = u_offset * u_intensity * mappedDepth;
        vec2 finalTexCoords = v_texCoord - p;
        
        vec4 baseColor = texture2D(u_image, finalTexCoords);
        if (u_fade > 0.0) {
           vec4 topColor = texture2D(u_imageTop, finalTexCoords);
           gl_FragColor = mix(baseColor, topColor, u_fade);
        } else {
           gl_FragColor = baseColor;
        }
      }
    `;

    const compileShader = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return null;
      return shader;
    };

    const vShader = compileShader(gl.VERTEX_SHADER, vsSource);
    const fShader = compileShader(gl.FRAGMENT_SHADER, fsSource);
    if (!vShader || !fShader) return false;

    const program = gl.createProgram();
    if (!program) return false;
    gl.attachShader(program, vShader);
    gl.attachShader(program, fShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;

    const locPos = gl.getAttribLocation(program, 'a_position');
    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1,  -1,  1,
      -1,  1,  1, -1,   1,  1
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(locPos);
    gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);

    const createTex = () => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return tex!;
    };

    glContext.current = {
      canvas: glCanvas, gl, program,
      locImage: gl.getUniformLocation(program, 'u_image'),
      locImageTop: gl.getUniformLocation(program, 'u_imageTop'),
      locDepth: gl.getUniformLocation(program, 'u_depth'),
      locFade: gl.getUniformLocation(program, 'u_fade'),
      locOffset: gl.getUniformLocation(program, 'u_offset'),
      locIntensity: gl.getUniformLocation(program, 'u_intensity'),
      locThreshold: gl.getUniformLocation(program, 'u_threshold'),
      locTexSize: gl.getUniformLocation(program, 'u_texSize'),
      texImage: createTex(),
      texImageTop: createTex(),
      texDepth: createTex(),
    };
    return true;
  };

  const onMediaLoaded = () => setLoadedCount(c => c + 1);

  useEffect(() => {
    if (!loaded) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const onResize = () => {
      if (!canvas.parentElement) return;
      canvas.width = canvas.parentElement.clientWidth;
      canvas.height = canvas.parentElement.clientHeight;
    };
    onResize();

    const { imgW, imgH } = getMasterDimensions();
    if (imgW > 0 && imgH > 0) {
      ensureMaskCanvasSize(imgW, imgH);
    }

    const cw = canvas.width;
    const ch = canvas.height;
    const fitScale = Math.min((cw * 0.8) / (imgW || 1), (ch * 0.8) / (imgH || 1)) || 1;
    
    if (viewState.current.scale === 0) {
      viewState.current.scale = fitScale;
      viewState.current.offsetX = (cw - imgW * fitScale) / 2;
      viewState.current.offsetY = (ch - imgH * fitScale) / 2;
    }

    setZoomLevel(viewState.current.scale * 100);

    let mouseX = cw / 2;
    let mouseY = ch / 2;
    let globalClientX = window.innerWidth / 2;
    let globalClientY = window.innerHeight / 2;
    let isRightDown = false;
    let isLeftDown = false;
    
    let isPanning = false;
    let lastPanX = 0;
    let lastPanY = 0;
    let isSpaceDown = false;

    let isMouse4Down = false;
    let isMouse5Down = false;

    apiRef.current = {
      setZoom: (newScale: number) => {
        const os = viewState.current.scale;
        if (os > 0) {
          const centerX = canvas.width / 2;
          const centerY = canvas.height / 2;
          const imgX = (centerX - viewState.current.offsetX) / os;
          const imgY = (centerY - viewState.current.offsetY) / os;
          viewState.current.offsetX = centerX - imgX * newScale;
          viewState.current.offsetY = centerY - imgY * newScale;
        }
        viewState.current.scale = newScale;
        setZoomLevel(newScale * 100);
      },
      fitScreen: () => {
        viewState.current.scale = fitScale;
        viewState.current.offsetX = (canvas.width - imgW * fitScale) / 2;
        viewState.current.offsetY = (canvas.height - imgH * fitScale) / 2;
        setZoomLevel(fitScale * 100);
      }
    };

    const depthHud = document.getElementById('hud-depth');
    const coordHud = document.getElementById('hud-coords');
    const sizeSpan = document.getElementById('hud-size');
    const sizeSlider = document.getElementById('slider-size') as HTMLInputElement;
    const depthPctSpan = document.getElementById('hud-depth-pct');
    const depthSlider = document.getElementById('slider-depth') as HTMLInputElement;

    const updateHUD = () => {
      if (coordHud) coordHud.innerText = `TỌA ĐỘ: ${((mouseX - viewState.current.offsetX) / viewState.current.scale).toFixed(0)}x ${((mouseY - viewState.current.offsetY) / viewState.current.scale).toFixed(0)}y`;
      
      const currentLayer = Math.min(L - 1, Math.round(viewState.current.depth));
      if (viewState.current.viewMode === 'compare') {
        if (depthHud) depthHud.innerText = `So sánh: Lớp ${viewState.current.compareBefore + 1} vs Lớp ${viewState.current.compareAfter + 1}`;
      } else {
        if (depthHud) depthHud.innerText = `Đang xem: Lớp ${currentLayer + 1}/${L}`;
      }

      if (sizeSpan) sizeSpan.innerText = `${Math.round(viewState.current.lensBaseRadius)}px`;
      if (sizeSlider && sizeSlider.value !== Math.round(viewState.current.lensBaseRadius).toString()) {
        sizeSlider.value = Math.round(viewState.current.lensBaseRadius).toString();
      }

      if (depthPctSpan) depthPctSpan.innerText = `${L > 1 ? Math.round((viewState.current.depth / (L - 1)) * 100) : 0}%`;
      if (depthSlider && depthSlider.value !== Math.round(viewState.current.depth * 1000).toString()) {
        depthSlider.value = Math.round(viewState.current.depth * 1000).toString();
      }
      
      const intensitySlider = document.getElementById('slider-intensity') as HTMLInputElement;
      const intensitySpan = document.getElementById('hud-intensity');
      if (intensitySpan) intensitySpan.innerText = `${Math.round(viewState.current.intensity3D * 100)}%`;
      if (intensitySlider && intensitySlider.value !== Math.round(viewState.current.intensity3D * 100).toString()) {
        intensitySlider.value = Math.round(viewState.current.intensity3D * 100).toString();
      }

      const thresholdSlider = document.getElementById('slider-threshold') as HTMLInputElement;
      const thresholdSpan = document.getElementById('hud-threshold');
      if (thresholdSpan) thresholdSpan.innerText = `${Math.round(viewState.current.threshold3D * 100)}%`;
      if (thresholdSlider && thresholdSlider.value !== Math.round(viewState.current.threshold3D * 100).toString()) {
        thresholdSlider.value = Math.round(viewState.current.threshold3D * 100).toString();
      }

      const easingSlider = document.getElementById('slider-easing') as HTMLInputElement;
      const easingSpan = document.getElementById('hud-easing');
      if (easingSpan) easingSpan.innerText = `${Math.round(viewState.current.easing3D * 100)}%`;
      if (easingSlider && easingSlider.value !== Math.round(viewState.current.easing3D * 100).toString()) {
        easingSlider.value = Math.round(viewState.current.easing3D * 100).toString();
      }
      
      const isCompare = viewState.current.viewMode === 'compare';
      const lensStatus = document.getElementById('hud-lens-status');
      if (lensStatus) {
         lensStatus.innerText = isCompare ? 'SO_SÁNH: BẬT' : 'KÍNH_LÚP: BẬT';
      }
      
      for(let i=0; i<L; i++) {
        const bar = document.getElementById(`layer-bar-${i}`);
        if(bar) {
            if (isCompare) {
               bar.style.width = (i === viewState.current.compareBefore || i === viewState.current.compareAfter) ? '100%' : '0%';
            } else {
               if(i < viewState.current.depth) bar.style.width = '100%';
               else if (i === Math.floor(viewState.current.depth) + 1) bar.style.width = `${(viewState.current.depth % 1) * 100}%`;
               else bar.style.width = '0%';
            }
        }
        const layerItem = document.getElementById(`layer-item-${i}`);
        if (layerItem) {
           let isActive = false;
           if (isEditModeRef.current) {
             const layerId = projectRef.current.layers[i]?.id;
             isActive = layerId === selectedEditLayerIdRef.current;
           } else {
             isActive = isCompare ? (i === viewState.current.compareBefore || i === viewState.current.compareAfter) : (i === currentLayer);
           }
           
           if (isActive) {
             layerItem.classList.add('bg-cyan-500/10', 'border-cyan-400', 'shadow-[0_0_15px_rgba(34,211,238,0.15)]');
             layerItem.classList.remove('bg-white/[0.02]', 'border-white/5', 'opacity-60');
             layerItem.classList.add('opacity-100');
             const nameSpan = layerItem.querySelector('[data-layer-name]');
             if (nameSpan) {
               nameSpan.classList.add('text-cyan-400');
               nameSpan.classList.remove('text-white');
             }
           } else {
             layerItem.classList.remove('bg-cyan-500/10', 'border-cyan-400', 'shadow-[0_0_15px_rgba(34,211,238,0.15)]');
             layerItem.classList.add('bg-white/[0.02]', 'border-white/5');
             if (i === 0) {
               layerItem.classList.remove('opacity-60');
               layerItem.classList.add('opacity-100');
             } else {
               layerItem.classList.add('opacity-60');
               layerItem.classList.remove('opacity-100');
             }
             const nameSpan = layerItem.querySelector('[data-layer-name]');
             if (nameSpan) {
               nameSpan.classList.remove('text-cyan-400');
               nameSpan.classList.add('text-white');
             }
           }
        }
      }
    };

    let lastDrawTime = performance.now();
    
    // Create offscreen canvases for WebGL textures so they match base size
    const offCanvasBase = document.createElement('canvas');
    const offCanvasTop = document.createElement('canvas');
    const drawLayer = (targetCtx: CanvasRenderingContext2D, el: HTMLImageElement | HTMLVideoElement, idx: number) => {
      const lData = projectRef.current.layers[idx];
      if (lData?.visible === false) return;
      const lScaleX = lData?.layerScaleX ?? lData?.layerScale ?? 1;
      const lScaleY = lData?.layerScaleY ?? lData?.layerScale ?? 1;
      const lX = lData?.layerX ?? 0;
      const lY = lData?.layerY ?? 0;
      const lOpacity = lData?.layerOpacity ?? 1.0;
      
      const elW = el instanceof HTMLVideoElement ? el.videoWidth : (el as HTMLImageElement).naturalWidth;
      const elH = el instanceof HTMLVideoElement ? el.videoHeight : (el as HTMLImageElement).naturalHeight;
      const { imgW: masterW, imgH: masterH } = getMasterDimensions();
      
      targetCtx.save();
      targetCtx.globalAlpha *= lOpacity;
      targetCtx.translate((masterW / 2) + lX, (masterH / 2) + lY);
      targetCtx.scale(lScaleX, lScaleY);
      targetCtx.drawImage(el, -elW / 2, -elH / 2, elW, elH);
      targetCtx.restore();
    };

    const draw = () => {
      const now = performance.now();
      const dt = Math.min(now - lastDrawTime, 50);
      lastDrawTime = now;

      const vs = viewState.current;
      
      if (vs.autoAnimate) {
        vs.depth += vs.autoAnimateSpeed * vs.autoAnimateDir * (dt / 16.666);

        if (vs.depth >= L - 1) {
          vs.depth = L - 1;
          vs.autoAnimateDir = -1;
        } else if (vs.depth <= 0) {
          vs.depth = 0;
          vs.autoAnimateDir = 1;
        }
      } else {
        if (isRightDown) vs.depth = Math.min(L - 1, vs.depth + 0.012);
        else if (isLeftDown && !isPanning) vs.depth = Math.max(0, vs.depth - 0.012);
      }

      if (isMouse4Down) {
        vs.lensBaseRadius = Math.max(40, vs.lensBaseRadius - 3);
        localStorage.setItem('xrayLensRadius', vs.lensBaseRadius.toString());
      }
      if (isMouse5Down) {
        vs.lensBaseRadius = Math.min(800, vs.lensBaseRadius + 3);
        localStorage.setItem('xrayLensRadius', vs.lensBaseRadius.toString());
      }

      const vids = elementsRef.current.filter(r => r && r.type === 'video').map(r => r.el as HTMLVideoElement);
      if (vids.length > 0) {
        const master = vids[0];
        for (let i = 1; i < vids.length; i++) {
          if (Math.abs(vids[i].currentTime - master.currentTime) > 0.1) vids[i].currentTime = master.currentTime;
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(vs.offsetX, vs.offsetY);
      ctx.scale(vs.scale, vs.scale);

      const firstEl = elementsRef.current[0]?.el;

      ctx.globalAlpha = 1.0;
      if (firstEl) drawLayer(ctx, firstEl, 0);

      const lensTrueRadius = vs.lensBaseRadius / vs.scale; 
      const lx = (mouseX - vs.offsetX) / vs.scale;
      const ly = (mouseY - vs.offsetY) / vs.scale;

      const baseIdx = Math.min(L - 1, Math.ceil(vs.depth));
      const topIdx = Math.min(L - 1, Math.floor(vs.depth));
      const baseEl = elementsRef.current[baseIdx]?.el;
      const topEl = elementsRef.current[topIdx]?.el;

      const lData0 = projectRef.current.layers[0];
      const lScaleX0 = lData0?.layerScaleX ?? lData0?.layerScale ?? 1;
      const lScaleY0 = lData0?.layerScaleY ?? lData0?.layerScale ?? 1;
      const lX0 = lData0?.layerX ?? 0;
      const lY0 = lData0?.layerY ?? 0;

      const masterW = imgW || 0;
      const masterH = imgH || 0;
      const lLeft0 = masterW / 2 + lX0 - (masterW / 2) * lScaleX0;
      const lRight0 = masterW / 2 + lX0 + (masterW / 2) * lScaleX0;
      const lTop0 = masterH / 2 + lY0 - (masterH / 2) * lScaleY0;
      const lBottom0 = masterH / 2 + lY0 + (masterH / 2) * lScaleY0;

      const isInsideImage = lx >= lLeft0 && ly >= lTop0 && lx <= lRight0 && ly <= lBottom0;

      if (!isEditModeRef.current && vs.enable3D) {
        const lerp = (start: number, end: number, amt: number) => (1 - amt) * start + amt * end;
        const cubicBezierEase = (t: number) => 1 - Math.pow(1 - t, 3);

        if (vs.smoothClientX === undefined) vs.smoothClientX = globalClientX;
        if (vs.smoothClientY === undefined) vs.smoothClientY = globalClientY;

        vs.smoothClientX = lerp(vs.smoothClientX, globalClientX, 0.15);
        vs.smoothClientY = lerp(vs.smoothClientY, globalClientY, 0.15);

        const nx = -(vs.smoothClientX - window.innerWidth / 2) / (window.innerWidth / 2);
        const ny = -(vs.smoothClientY - window.innerHeight / 2) / (window.innerHeight / 2);

        const t = Math.min(1.0, dt * 0.006);
        const easedFactor = cubicBezierEase(t * (vs.easing3D * 2 + 0.1));

        vs.parallaxX = lerp(vs.parallaxX, nx, easedFactor);
        vs.parallaxY = lerp(vs.parallaxY, ny, easedFactor);
      }

      // Prepare 3D canvas if enabled
      let glCanvasReady = false;
      if (!isMaskOnRef.current && !isEditModeRef.current && vs.enable3D && depthImgRef.current && (baseEl || topEl) && vs.viewMode !== 'compare') {
        if (!glContext.current) initWebGL(imgW, imgH);
        const glc = glContext.current;
        if (glc) {
          const gl = glc.gl;
          if (gl.canvas.width !== imgW || gl.canvas.height !== imgH) {
            gl.canvas.width = imgW;
            gl.canvas.height = imgH;
            gl.viewport(0, 0, imgW, imgH);
          }

          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, glc.texImage);
          if (baseEl) {
             offCanvasBase.width = imgW;
             offCanvasBase.height = imgH;
             const octx = offCanvasBase.getContext('2d');
             if (octx) {
                octx.clearRect(0, 0, imgW, imgH);
                drawLayer(octx, baseEl as HTMLImageElement | HTMLVideoElement, baseIdx);
             }
             gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, offCanvasBase);
          }

          const fade = baseIdx === topIdx ? 0 : 1 - (vs.depth - topIdx);
          gl.activeTexture(gl.TEXTURE1);
          if (fade > 0 && topEl) {
            gl.bindTexture(gl.TEXTURE_2D, glc.texImageTop);
            offCanvasTop.width = imgW;
            offCanvasTop.height = imgH;
            const octx = offCanvasTop.getContext('2d');
            if (octx) {
               octx.clearRect(0, 0, imgW, imgH);
               drawLayer(octx, topEl as HTMLImageElement | HTMLVideoElement, topIdx);
            }
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, offCanvasTop);
          }

          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, glc.texDepth);
          if (!glc.depthUploaded || glc.depthUrl !== depthUrl) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, depthImgRef.current);
            glc.depthUploaded = true;
            glc.depthUrl = depthUrl;
          }

          gl.useProgram(glc.program);
          gl.uniform1i(glc.locImage, 0);
          gl.uniform1i(glc.locImageTop, 1);
          gl.uniform1i(glc.locDepth, 2);
          gl.uniform1f(glc.locFade, fade);
          gl.uniform2f(glc.locOffset, vs.parallaxX, vs.parallaxY);
          gl.uniform1f(glc.locIntensity, vs.intensity3D * 0.1); 
          gl.uniform1f(glc.locThreshold, vs.threshold3D);
          gl.uniform2f(glc.locTexSize, imgW, imgH);

          gl.drawArrays(gl.TRIANGLES, 0, 6);
          glCanvasReady = true;
        }
      }

      ctx.globalAlpha = 1.0;

      if (isEditModeRef.current) {
        for (let i = projectRef.current.layers.length - 1; i >= 0; i--) {
          const el = elementsRef.current[i]?.el;
          if (el) {
            drawLayer(ctx, el, i);
          }
        }

        const isMaskOnVal = isMaskOnRef.current;
        if (isMaskOnVal && showMaskOverlayRef.current && maskOverlayCanvasRef.current) {
          ctx.save();
          ctx.globalAlpha = 1.0;
          ctx.drawImage(maskOverlayCanvasRef.current, 0, 0);
          ctx.restore();
        }

        if (isMaskOnVal) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(lx, ly, maskBrushSizeRef.current, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
          ctx.lineWidth = 1.5 / vs.scale;
          ctx.stroke();

          // Draw hardness circle inside if h between 0 and 1
          const h = maskBrushHardnessRef.current / 100;
          if (h > 0 && h < 1) {
            ctx.beginPath();
            ctx.arc(lx, ly, maskBrushSizeRef.current * h, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.lineWidth = 1 / vs.scale;
            ctx.setLineDash([4 / vs.scale, 4 / vs.scale]);
            ctx.stroke();
          }
          ctx.restore();
        }
        
        const selId = selectedEditLayerIdRef.current;
        if (selId) {
          const selIdx = projectRef.current.layers.findIndex(l => l.id === selId);
          const b = getLayerBounds(selIdx);
          if (b) {
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 2 / vs.scale;
            ctx.strokeRect(b.x, b.y, b.w, b.h);
            
            ctx.fillStyle = '#22d3ee';
            const hs = 10 / vs.scale;
            // Corners
            ctx.fillRect(b.x - hs/2, b.y - hs/2, hs, hs);
            ctx.fillRect(b.r - hs/2, b.y - hs/2, hs, hs);
            ctx.fillRect(b.x - hs/2, b.b - hs/2, hs, hs);
            ctx.fillRect(b.r - hs/2, b.b - hs/2, hs, hs);
            // Midpoints
            ctx.fillRect(b.cx - hs/2, b.y - hs/2, hs, hs);
            ctx.fillRect(b.cx - hs/2, b.b - hs/2, hs, hs);
            ctx.fillRect(b.x - hs/2, b.cy - hs/2, hs, hs);
            ctx.fillRect(b.r - hs/2, b.cy - hs/2, hs, hs);
          }
        }

        const st = editStateRef.current;
        if (st.isDragging && (st.activeSnapX !== null || st.activeSnapY !== null)) {
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 1 / vs.scale;
            if (st.activeSnapX !== null) {
               ctx.beginPath(); ctx.moveTo(st.activeSnapX, -100000); ctx.lineTo(st.activeSnapX, 100000); ctx.stroke();
            }
            if (st.activeSnapY !== null) {
               ctx.beginPath(); ctx.moveTo(-100000, st.activeSnapY); ctx.lineTo(100000, st.activeSnapY); ctx.stroke();
            }
        }

      } else if (vs.viewMode === 'compare') {
        const beforeEl = elementsRef.current[vs.compareBefore]?.el || firstEl;
        if (beforeEl) drawLayer(ctx, beforeEl, vs.compareBefore);

        const splitX = (canvas.width * vs.comparePos - vs.offsetX) / vs.scale;
        ctx.save();
        ctx.beginPath();
        ctx.rect(splitX, -100000, 200000, 200000);
        ctx.clip();
        
        ctx.globalAlpha = 1.0;
        const afterEl = elementsRef.current[vs.compareAfter]?.el;
        if (afterEl) drawLayer(ctx, afterEl, vs.compareAfter);
        ctx.restore(); // pop the clip

        // Draw split line
        ctx.restore(); // pop scale/translate to draw line in screen space
        ctx.save(); // push again for stroke context, balanced with final restore
        ctx.beginPath();
        ctx.moveTo(canvas.width * vs.comparePos, 0);
        ctx.lineTo(canvas.width * vs.comparePos, canvas.height);
        ctx.lineWidth = 0.5;
        ctx.strokeStyle = 'rgba(255, 255, 255, 1)';
        ctx.stroke();
      } else if (vs.enable3D) {
        // Full Image 3D Mode - No Lens!
        if (glCanvasReady && glContext.current) {
          if (isMaskOnRef.current && alphaMaskCanvasRef.current) {
            // Draw 3D result on a temporary canvas, with mask applied
            if (!tempBlendCanvasRef.current) {
              tempBlendCanvasRef.current = document.createElement('canvas');
            }
            const tc = tempBlendCanvasRef.current;
            if (tc.width !== imgW || tc.height !== imgH) {
              tc.width = imgW;
              tc.height = imgH;
            }
            const tCtx = tc.getContext('2d');
            if (tCtx) {
              tCtx.clearRect(0, 0, imgW, imgH);
              tCtx.globalAlpha = 1.0;
              tCtx.drawImage(glContext.current.canvas, 0, 0, imgW, imgH);

              // Apply alpha mask
              tCtx.globalAlpha = 1.0;
              tCtx.globalCompositeOperation = 'destination-in';
              tCtx.drawImage(alphaMaskCanvasRef.current, 0, 0, imgW, imgH);
              tCtx.globalCompositeOperation = 'source-over';

              // Draw Layer 1 background first
              ctx.globalAlpha = 1.0;
              if (firstEl) drawLayer(ctx, firstEl, 0);

              // Draw the masked 3D result on top of the first layer
              ctx.globalAlpha = 1.0;
              ctx.drawImage(tc, 0, 0);
            }
          } else {
            ctx.globalAlpha = 1.0;
            ctx.drawImage(glContext.current.canvas, 0, 0, imgW, imgH);
          }
        } else {
          // Fallback if not ready
          if (firstEl) drawLayer(ctx, firstEl, 0);
        }
      } else {
        // Lens mode
        drawLayer(ctx, firstEl, 0);

        if (isInsideImage) {
          ctx.beginPath();
          if (vs.lensShape === 1) {
            ctx.rect(lx - lensTrueRadius, ly - lensTrueRadius, lensTrueRadius * 2, lensTrueRadius * 2);
          } else if (vs.lensShape === 2) {
            ctx.rect(lx - lensTrueRadius * 1.5, ly - lensTrueRadius * 0.75, lensTrueRadius * 3, lensTrueRadius * 1.5);
          } else {
            ctx.arc(lx, ly, lensTrueRadius, 0, Math.PI * 2);
          }
          ctx.save();
          ctx.clip(); 

          if (glCanvasReady && glContext.current) {
            if (isMaskOnRef.current && alphaMaskCanvasRef.current) {
              // Draw Layer 1 (index 0) as background inside the lens
              ctx.globalAlpha = 1.0;
              if (firstEl) drawLayer(ctx, firstEl, 0);

              // Draw 3D result on a temporary canvas, with mask applied
              if (!tempBlendCanvasRef.current) {
                tempBlendCanvasRef.current = document.createElement('canvas');
              }
              const tc = tempBlendCanvasRef.current;
              if (tc.width !== imgW || tc.height !== imgH) {
                tc.width = imgW;
                tc.height = imgH;
              }
              const tCtx = tc.getContext('2d');
              if (tCtx) {
                tCtx.clearRect(0, 0, imgW, imgH);
                tCtx.globalAlpha = 1.0;
                tCtx.drawImage(glContext.current.canvas, 0, 0, imgW, imgH);

                // Apply alpha mask
                tCtx.globalAlpha = 1.0;
                tCtx.globalCompositeOperation = 'destination-in';
                tCtx.drawImage(alphaMaskCanvasRef.current, 0, 0, imgW, imgH);
                tCtx.globalCompositeOperation = 'source-over';

                // Draw the masked 3D result on top of Layer 1 inside the lens clip
                ctx.globalAlpha = 1.0;
                ctx.drawImage(tc, 0, 0);
              }
            } else {
              ctx.globalAlpha = 1.0;
              ctx.drawImage(glContext.current.canvas, 0, 0, imgW, imgH);
            }
          } else {
            if (isMaskOnRef.current && alphaMaskCanvasRef.current) {
              // Draw Layer 1 (index 0) as background inside the lens
              ctx.globalAlpha = 1.0;
              if (firstEl) drawLayer(ctx, firstEl, 0);

              // Draw active layers on a temporary canvas, with mask applied
              if (!tempBlendCanvasRef.current) {
                tempBlendCanvasRef.current = document.createElement('canvas');
              }
              const tc = tempBlendCanvasRef.current;
              if (tc.width !== imgW || tc.height !== imgH) {
                tc.width = imgW;
                tc.height = imgH;
              }
              const tCtx = tc.getContext('2d');
              if (tCtx) {
                tCtx.clearRect(0, 0, imgW, imgH);
                
                if (baseIdx === topIdx) {
                  if (baseIdx > 0 && baseEl) {
                    tCtx.globalAlpha = 1.0;
                    drawLayer(tCtx, baseEl, baseIdx);
                  }
                } else {
                  if (baseIdx > 0 && baseEl) {
                    tCtx.globalAlpha = 1.0;
                    drawLayer(tCtx, baseEl, baseIdx);
                  }
                  if (topIdx > 0 && topEl) {
                    const fade = 1 - (vs.depth - topIdx);
                    tCtx.globalAlpha = fade;
                    drawLayer(tCtx, topEl, topIdx);
                  }
                }

                // Apply alpha mask
                tCtx.globalAlpha = 1.0;
                tCtx.globalCompositeOperation = 'destination-in';
                tCtx.drawImage(alphaMaskCanvasRef.current, 0, 0, imgW, imgH);
                tCtx.globalCompositeOperation = 'source-over';

                // Draw the masked result on top of Layer 1 inside the lens clip
                ctx.globalAlpha = 1.0;
                ctx.drawImage(tc, 0, 0);
              }
            } else {
              if (baseIdx === topIdx) {
                ctx.globalAlpha = 1.0;
                if (baseEl) drawLayer(ctx, baseEl, baseIdx);
              } else {
                ctx.globalAlpha = 1.0;
                if (baseEl) drawLayer(ctx, baseEl, baseIdx);
                const fade = 1 - (vs.depth - topIdx);
                ctx.globalAlpha = fade;
                if (topEl) drawLayer(ctx, topEl, topIdx);
              }
            }
          }

          ctx.restore(); // pop the clip

          ctx.lineWidth = 2 / vs.scale;
          ctx.strokeStyle = 'rgba(34, 211, 238, 0.8)';
          ctx.beginPath();
          if (vs.lensShape === 1) {
            ctx.rect(lx - lensTrueRadius, ly - lensTrueRadius, lensTrueRadius * 2, lensTrueRadius * 2);
          } else if (vs.lensShape === 2) {
            ctx.rect(lx - lensTrueRadius * 1.5, ly - lensTrueRadius * 0.75, lensTrueRadius * 3, lensTrueRadius * 1.5);
          } else {
            ctx.arc(lx, ly, lensTrueRadius, 0, Math.PI * 2);
          }
          ctx.stroke();

          ctx.shadowColor = 'rgba(34, 211, 238, 0.5)';
          ctx.shadowBlur = 15 / vs.scale;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }

      ctx.restore(); // pop the scale/translate (or the save() in compare mode)

      if (isRightDown || isLeftDown || vs.autoAnimate || isMouse4Down || isMouse5Down) updateHUD();
      animationFrameId = requestAnimationFrame(draw);
    };

    draw();
    updateHUD();

    const preventCtx = (e: MouseEvent) => e.preventDefault();
    const onKeyDown = (e: KeyboardEvent) => { if (e.code === 'Space') isSpaceDown = true; };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') isSpaceDown = false; };

    const onGlobalMouseBtn = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'mousedown') {
          if (e.button === 3) isMouse4Down = true;
          if (e.button === 4) isMouse5Down = true;
        } else if (e.type === 'mouseup') {
          if (e.button === 3) isMouse4Down = false;
          if (e.button === 4) isMouse5Down = false;
          forceUpdate();
        }
      }
    };

    let isDraggingCompare = false;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) return;
      e.preventDefault();

      if (isEditModeRef.current) {
         const wx = (mouseX - viewState.current.offsetX) / viewState.current.scale;
         const wy = (mouseY - viewState.current.offsetY) / viewState.current.scale;

         if (isMaskOnRef.current) {
            if (e.button === 0) {
               isDrawingMaskRef.current = true;
               lastDrawingXRef.current = wx;
               lastDrawingYRef.current = wy;
               drawBrushStroke(wx, wy, wx, wy);
            } else if (e.button === 2) {
               isPanning = true;
               lastPanX = e.clientX;
               lastPanY = e.clientY;
               document.body.style.cursor = 'grabbing';
            }
            return;
         }

         const selId = selectedEditLayerIdRef.current;
         let hit = false;

         if (selId) {
            const selIdx = projectRef.current.layers.findIndex(l => l.id === selId);
            const b = getLayerBounds(selIdx);
            if (b) {
               const hSize = 14 / viewState.current.scale;
               const onTL = Math.abs(wx - b.x) <= hSize && Math.abs(wy - b.y) <= hSize;
               const onTC = Math.abs(wx - b.cx) <= hSize && Math.abs(wy - b.y) <= hSize;
               const onBC = Math.abs(wx - b.cx) <= hSize && Math.abs(wy - b.b) <= hSize;
               const onLC = Math.abs(wx - b.x) <= hSize && Math.abs(wy - b.cy) <= hSize;
               const onRC = Math.abs(wx - b.r) <= hSize && Math.abs(wy - b.cy) <= hSize;
               const onTR = Math.abs(wx - b.r) <= hSize && Math.abs(wy - b.y) <= hSize;
               const onBL = Math.abs(wx - b.x) <= hSize && Math.abs(wy - b.b) <= hSize;
               const onBR = Math.abs(wx - b.r) <= hSize && Math.abs(wy - b.b) <= hSize;
               
               let clickedHandle: string | null = null;
               if (onTL) clickedHandle = 'tl';
               else if (onTR) clickedHandle = 'tr';
               else if (onBL) clickedHandle = 'bl';
               else if (onBR) clickedHandle = 'br';
               else if (onTC) clickedHandle = 'tc';
               else if (onBC) clickedHandle = 'bc';
               else if (onLC) clickedHandle = 'lc';
               else if (onRC) clickedHandle = 'rc';

               if (clickedHandle) {
                  pushHistory(projectRef.current);
                  editStateRef.current.isResizing = true;
                  editStateRef.current.resizeHandle = clickedHandle;
                  editStateRef.current.startX = wx;
                  editStateRef.current.startY = wy;
                  editStateRef.current.startLayerScale = b.lScale;
                  editStateRef.current.startLayerScaleX = b.lScaleX;
                  editStateRef.current.startLayerScaleY = b.lScaleY;
                  editStateRef.current.startLayerX = b.lX;
                  editStateRef.current.startLayerY = b.lY;
                  editStateRef.current.startB_x = b.x;
                  editStateRef.current.startB_y = b.y;
                  editStateRef.current.startB_r = b.r;
                  editStateRef.current.startB_b = b.b;
                  editStateRef.current.startB_cx = b.cx;
                  editStateRef.current.startB_cy = b.cy;
                  editStateRef.current.startB_w = b.w;
                  editStateRef.current.startB_h = b.h;
                  hit = true;
               } else if (wx >= b.x && wx <= b.r && wy >= b.y && wy <= b.b) {
                  pushHistory(projectRef.current);
                  editStateRef.current.isDragging = true;
                  editStateRef.current.startX = wx;
                  editStateRef.current.startY = wy;
                  editStateRef.current.startLayerX = b.lX;
                  editStateRef.current.startLayerY = b.lY;
                  
                  const xs: number[] = [];
                  const ys: number[] = [];
                  for(let i=0; i<projectRef.current.layers.length; i++) {
                     if (i === selIdx) continue;
                     const ob = getLayerBounds(i);
                     if (ob) {
                        xs.push(ob.x, ob.r, ob.cx);
                        ys.push(ob.y, ob.b, ob.cy);
                     }
                  }
                  editStateRef.current.snapLinesX = xs;
                  editStateRef.current.snapLinesY = ys;
                  hit = true;
               }
            }
         }
         
         if (!hit) {
            let clickedId: string | null = null;
            for(let i = projectRef.current.layers.length - 1; i >= 0; i--) {
               const b = getLayerBounds(i);
               if (b && wx >= b.x && wx <= b.r && wy >= b.y && wy <= b.b) {
                  clickedId = projectRef.current.layers[i].id;
                  break;
               }
            }
            if (clickedId !== selId) {
               setSelectedEditLayerId(clickedId);
               selectedEditLayerIdRef.current = clickedId;
            } else if (!clickedId || clickedId === selId) {
               isPanning = true;
               lastPanX = e.clientX;
               lastPanY = e.clientY;
               document.body.style.cursor = 'grabbing';
            }
         }
         return;
      }

      if (viewState.current.viewMode === 'compare' && e.button === 0) {
        const dist = Math.abs(mouseX - canvas.width * viewState.current.comparePos);
        if (dist < 15) {
          isDraggingCompare = true;
          canvas.style.cursor = 'ew-resize';
          return;
        }
      }

      if (e.button === 1 || isSpaceDown) {
        isPanning = true;
        lastPanX = e.clientX;
        lastPanY = e.clientY;
        document.body.style.cursor = 'grabbing';
      } else if (e.button === 0) {
        isLeftDown = true;
      } else if (e.button === 2) {
        isRightDown = true;
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) return;

      if (isDrawingMaskRef.current && e.button === 0) {
         isDrawingMaskRef.current = false;
         return;
      }

      if (editStateRef.current.isDragging || editStateRef.current.isResizing) {
         editStateRef.current.isDragging = false;
         editStateRef.current.isResizing = false;
         editStateRef.current.activeSnapX = null;
         editStateRef.current.activeSnapY = null;
         
         const selId = selectedEditLayerIdRef.current;
         if (selId) {
            const selIdx = projectRef.current.layers.findIndex(l => l.id === selId);
            if (selIdx !== -1) {
               const newLayers = [...projectRef.current.layers];
               updateProject({
                  ...projectRef.current,
                  layers: newLayers
               });
            }
         }
      }
      
      if (isDraggingCompare && e.button === 0) {
        isDraggingCompare = false;
        canvas.style.cursor = 'default';
        return;
      }

      if (e.button === 1 || (e.button === 0 && isPanning) || isSpaceDown) {
        isPanning = false;
        document.body.style.cursor = 'default';
      } else if (e.button === 0) {
        isLeftDown = false;
      } else if (e.button === 2) {
        isRightDown = false;
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const newX = e.clientX - rect.left;
      const newY = e.clientY - rect.top;
      const dx = newX - mouseX;
      const dy = newY - mouseY;
      mouseX = newX;
      mouseY = newY;
      globalClientX = e.clientX;
      globalClientY = e.clientY;

      if (isDrawingMaskRef.current) {
         const wx = (mouseX - viewState.current.offsetX) / viewState.current.scale;
         const wy = (mouseY - viewState.current.offsetY) / viewState.current.scale;
         drawBrushStroke(lastDrawingXRef.current, lastDrawingYRef.current, wx, wy);
         lastDrawingXRef.current = wx;
         lastDrawingYRef.current = wy;
         return;
      }

      if (editStateRef.current.isDragging || editStateRef.current.isResizing) {
         const selId = selectedEditLayerIdRef.current;
         const selIdx = projectRef.current.layers.findIndex(l => l.id === selId);
         const st = editStateRef.current;
         if (selIdx !== -1) {
            const wx = (mouseX - viewState.current.offsetX) / viewState.current.scale;
            const wy = (mouseY - viewState.current.offsetY) / viewState.current.scale;

            const el = elementsRef.current[selIdx]?.el;
            const elW = el ? (el instanceof HTMLVideoElement ? el.videoWidth : (el as HTMLImageElement).naturalWidth) : 800;
            const elH = el ? (el instanceof HTMLVideoElement ? el.videoHeight : (el as HTMLImageElement).naturalHeight) : 600;

            const { imgW: masterW, imgH: masterH } = getMasterDimensions();

            if (st.isDragging) {
               let nlx = st.startLayerX + (wx - st.startX);
               let nly = st.startLayerY + (wy - st.startY);

               const ncx = (masterW/2) + nlx;
               const ncy = (masterH/2) + nly;
               const nw = elW * st.startLayerScale;
               const nh = elH * st.startLayerScale;
               const nx = ncx - nw/2;
               const nr = ncx + nw/2;
               const ny = ncy - nh/2;
               const nb = ncy + nh/2;
               
               const snapDist = 10 / viewState.current.scale;
               st.activeSnapX = null;
               st.activeSnapY = null;
               
               for(const sx of st.snapLinesX) {
                  if (Math.abs(nx - sx) < snapDist) { nlx += sx - nx; st.activeSnapX = sx; break; }
                  if (Math.abs(nr - sx) < snapDist) { nlx += sx - nr; st.activeSnapX = sx; break; }
                  if (Math.abs(ncx - sx) < snapDist) { nlx += sx - ncx; st.activeSnapX = sx; break; }
               }
               for(const sy of st.snapLinesY) {
                  if (Math.abs(ny - sy) < snapDist) { nly += sy - ny; st.activeSnapY = sy; break; }
                  if (Math.abs(nb - sy) < snapDist) { nly += sy - nb; st.activeSnapY = sy; break; }
                  if (Math.abs(ncy - sy) < snapDist) { nly += sy - ncy; st.activeSnapY = sy; break; }
               }

                projectRef.current.layers[selIdx].layerX = nlx;
               projectRef.current.layers[selIdx].layerY = nly;
            } else if (st.isResizing) {
               const startCx = (masterW/2) + st.startLayerX;
               const startCy = (masterH/2) + st.startLayerY;
               if (e.shiftKey) {
                  let px = st.startB_cx;
                  let py = st.startB_cy;

                  const h = st.resizeHandle;
                  if (h === 'tl') {
                     px = st.startB_r;
                     py = st.startB_b;
                  } else if (h === 'tr') {
                     px = st.startB_x;
                     py = st.startB_b;
                  } else if (h === 'bl') {
                     px = st.startB_r;
                     py = st.startB_y;
                  } else if (h === 'br') {
                     px = st.startB_x;
                     py = st.startB_y;
                  } else if (h === 'tc') {
                     px = st.startB_cx;
                     py = st.startB_b;
                  } else if (h === 'bc') {
                     px = st.startB_cx;
                     py = st.startB_y;
                  } else if (h === 'lc') {
                     px = st.startB_r;
                     py = st.startB_cy;
                  } else if (h === 'rc') {
                     px = st.startB_x;
                     py = st.startB_cy;
                  }

                  if (h === 'lc' || h === 'rc') {
                     const newW = Math.max(5, Math.abs(wx - px));
                     const newScaleX = newW / elW;
                     const newCx = (wx + px) / 2;
                     projectRef.current.layers[selIdx].layerScaleX = newScaleX;
                     projectRef.current.layers[selIdx].layerScaleY = st.startLayerScaleY;
                     projectRef.current.layers[selIdx].layerX = newCx - (masterW / 2);
                     projectRef.current.layers[selIdx].layerY = st.startLayerY;
                  } else if (h === 'tc' || h === 'bc') {
                     const newH = Math.max(5, Math.abs(wy - py));
                     const newScaleY = newH / elH;
                     const newCy = (wy + py) / 2;
                     projectRef.current.layers[selIdx].layerScaleY = newScaleY;
                     projectRef.current.layers[selIdx].layerScaleX = st.startLayerScaleX;
                     projectRef.current.layers[selIdx].layerY = newCy - (masterH / 2);
                     projectRef.current.layers[selIdx].layerX = st.startLayerX;
                  } else {
                     // Corner handles (tl, tr, bl, br) with shift -> free unproportional scale on both axes
                     const newW = Math.max(5, Math.abs(wx - px));
                     const newScaleX = newW / elW;
                     const newCx = (wx + px) / 2;
                     projectRef.current.layers[selIdx].layerScaleX = newScaleX;
                     projectRef.current.layers[selIdx].layerX = newCx - (masterW / 2);

                     const newH = Math.max(5, Math.abs(wy - py));
                     const newScaleY = newH / elH;
                     const newCy = (wy + py) / 2;
                     projectRef.current.layers[selIdx].layerScaleY = newScaleY;
                     projectRef.current.layers[selIdx].layerY = newCy - (masterH / 2);
                  }

                  const sX = projectRef.current.layers[selIdx].layerScaleX ?? st.startLayerScaleX;
                  const sY = projectRef.current.layers[selIdx].layerScaleY ?? st.startLayerScaleY;
                  projectRef.current.layers[selIdx].layerScale = (sX + sY) / 2;
               } else {
                  const startDistObj = Math.hypot(st.startX - startCx, st.startY - startCy);
                  const newDistObj = Math.hypot(wx - startCx, wy - startCy);
                  if (startDistObj > 0) {
                     const ratio = newDistObj / startDistObj;
                     const newScaleX = Math.max(0.05, st.startLayerScaleX * ratio);
                     const newScaleY = Math.max(0.05, st.startLayerScaleY * ratio);
                     
                     projectRef.current.layers[selIdx].layerScaleX = newScaleX;
                     projectRef.current.layers[selIdx].layerScaleY = newScaleY;
                     projectRef.current.layers[selIdx].layerScale = (newScaleX + newScaleY) / 2;
                  }
               }
            }
         }
         return;
      }

      if (!isEditModeRef.current) {
        if (viewState.current.enable3D && viewState.current.viewMode === 'lens') {
          canvas.style.cursor = 'default';
        } else if (viewState.current.viewMode === 'compare') {
          if (isDraggingCompare) {
             viewState.current.comparePos = Math.max(0, Math.min(1, mouseX / canvas.width));
             canvas.style.cursor = 'col-resize';
          } else {
             const dist = Math.abs(mouseX - canvas.width * viewState.current.comparePos);
             canvas.style.cursor = dist < 15 ? 'col-resize' : 'default';
          }
        } else if (viewState.current.viewMode === 'lens' && !isPanning) {
          const { imgW, imgH } = getMasterDimensions();
          const lData0 = projectRef.current.layers[0];
          const lScaleX0 = lData0?.layerScaleX ?? lData0?.layerScale ?? 1;
          const lScaleY0 = lData0?.layerScaleY ?? lData0?.layerScale ?? 1;
          const lX0 = lData0?.layerX ?? 0;
          const lY0 = lData0?.layerY ?? 0;
          
          const lx = (mouseX - viewState.current.offsetX) / viewState.current.scale;
          const ly = (mouseY - viewState.current.offsetY) / viewState.current.scale;
          
          const masterW = imgW || 0;
          const masterH = imgH || 0;
          const lLeft0 = masterW / 2 + lX0 - (masterW / 2) * lScaleX0;
          const lRight0 = masterW / 2 + lX0 + (masterW / 2) * lScaleX0;
          const lTop0 = masterH / 2 + lY0 - (masterH / 2) * lScaleY0;
          const lBottom0 = masterH / 2 + lY0 + (masterH / 2) * lScaleY0;
          const isInside = lx >= lLeft0 && ly >= lTop0 && lx <= lRight0 && ly <= lBottom0;
          canvas.style.cursor = isInside ? 'none' : 'default';
        }
      }

      if (isPanning) {
        viewState.current.offsetX += dx;
        viewState.current.offsetY += dy;
        lastPanX = e.clientX;
        lastPanY = e.clientY;
      }
      updateHUD();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      
      if (e.shiftKey) {
        const vs = viewState.current;
        vs.lensBaseRadius = Math.max(40, Math.min(800, vs.lensBaseRadius - e.deltaY * 0.5));
        updateVS('lensBaseRadius', Math.round(vs.lensBaseRadius));
        updateHUD();
        return;
      }

      const zoomSensitivity = 0.0015;
      const delta = -e.deltaY * zoomSensitivity;
      const newScale = Math.max(0.1, Math.min(20, viewState.current.scale * (1 + delta)));

      viewState.current.offsetX = mouseX - (mouseX - viewState.current.offsetX) * (newScale / viewState.current.scale);
      viewState.current.offsetY = mouseY - (mouseY - viewState.current.offsetY) * (newScale / viewState.current.scale);
      viewState.current.scale = newScale;
      setZoomLevel(newScale * 100);
      updateHUD();
    };

    window.addEventListener('mousedown', onGlobalMouseBtn, { capture: true, passive: false });
    window.addEventListener('mouseup', onGlobalMouseBtn, { capture: true, passive: false });
    window.addEventListener('resize', onResize);
    window.addEventListener('contextmenu', preventCtx);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('mousedown', onGlobalMouseBtn, { capture: true });
      window.removeEventListener('mouseup', onGlobalMouseBtn, { capture: true });
      window.removeEventListener('resize', onResize);
      window.removeEventListener('contextmenu', preventCtx);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [loaded, L]);

  const activeLayerIndex = Math.min(L - 1, Math.round(viewState.current.depth));

  const clampedZoom = Math.max(10, Math.min(2000, zoomLevel));
  const sliderValue = clampedZoom <= 100 
    ? ((clampedZoom - 10) / 90) * 50 
    : 50 + ((clampedZoom - 100) / 1900) * 50;

  const currentProjIdx = allProjects.findIndex(p => p.id === project.id);
  const prevProject = currentProjIdx > 0 ? allProjects[currentProjIdx - 1] : null;
  const nextProject = currentProjIdx >= 0 && currentProjIdx < allProjects.length - 1 ? allProjects[currentProjIdx + 1] : null;

  return (
    <div className="h-screen bg-[#050608] text-[#e2e8f0] font-sans flex flex-col overflow-hidden">
      <div style={{ opacity: 0, width: 0, height: 0, overflow: 'hidden', position: 'absolute', pointerEvents: 'none' }}>
        {project.layers.map((layer, i) => (
          layer.type === 'video' ? (
            <video 
              key={layer.id} 
              ref={el => { if (el) elementsRef.current[i] = { type: 'video', el }; }}
              src={urls[layer.id] || undefined} 
              muted loop playsInline autoPlay 
              onLoadedData={onMediaLoaded} 
              onError={() => setError('Không thể nạp lớp video')}
            />
          ) : (
            <img 
              key={layer.id} 
              ref={el => { if (el) elementsRef.current[i] = { type: 'image', el }; }}
              src={urls[layer.id] || undefined} 
              onLoad={onMediaLoaded} 
              onError={() => setError('Không thể nạp lớp ảnh')}
            />
          )
        ))}
      </div>

      <header className="h-14 border-b border-white/10 bg-[#0a0c10] flex items-center justify-between px-6 shrink-0 z-20">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-cyan-500/20 border border-cyan-400/50 rounded flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-cyan-400 rounded-full animate-pulse"></div>
          </div>
          <div className="text-sm font-bold tracking-[0.2em] uppercase text-cyan-400 truncate w-40 md:w-60 px-2 py-1 -ml-2">
             {project.name}
          </div>
        </div>
        <div className="hidden md:flex items-center gap-6 text-[11px] font-mono tracking-wider opacity-60">
           <div className="flex items-center gap-2">ĐỘ SÂU: {L} LỚP</div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        <main className="flex-1 relative bg-black overflow-hidden flex flex-col">
          <div className="absolute inset-0 pointer-events-none z-0" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '32px 32px' }}></div>
          
          {!loaded && !error && L > 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-50 text-white gap-4 backdrop-blur-sm">
              <div className="w-8 h-8 border-2 border-cyan-400/20 border-t-cyan-400 rounded-full animate-spin" />
              <p className="text-[10px] uppercase tracking-widest text-cyan-400 font-mono">ĐANG NẠP DỮ LIỆU ({loadedCount}/{L})</p>
            </div>
          )}

          {L === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-50 text-white gap-6 backdrop-blur-sm p-4 text-center">
               <div className="w-16 h-16 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mb-2">
                 <ArrowDown size={32} className="text-cyan-400 animate-bounce" />
               </div>
               <h2 className="text-sm font-bold tracking-[0.2em] uppercase text-cyan-400">DỰ ÁN TRỐNG</h2>
               <p className="text-[11px] text-slate-400 max-w-md uppercase tracking-wider mb-4 leading-relaxed">
                 Thêm ít nhất 2 ảnh hoặc video có cùng góc chụp vào mục bên phải để bắt đầu so sánh.
               </p>
               <button 
                 onClick={onBack} 
                 className="flex items-center gap-2 px-6 py-2.5 bg-white/5 border border-white/20 rounded text-[11px] uppercase tracking-widest text-slate-300 hover:text-white hover:bg-white/10 transition-colors shadow-lg"
               >
                 <ArrowLeft size={16}/> THOÁT VỀ DANH SÁCH
               </button>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-50 text-red-400 text-[10px] uppercase tracking-widest font-mono">
              LỖI HỆ THỐNG: {error}
            </div>
          )}

          <div className="flex-1 relative">
            <canvas ref={canvasRef} className="block w-full h-full cursor-none z-10" />

            <div className="absolute top-4 left-4 flex gap-2 z-20">
              <button 
                onClick={onBack} 
                className="flex items-center gap-1.5 px-3 py-1 bg-black/60 border border-white/20 rounded text-[9px] uppercase tracking-widest text-slate-300 hover:text-white hover:border-white/40 transition-colors shadow-lg backdrop-blur-md"
              >
                <ArrowLeft size={12}/> THOÁT
              </button>
              <span id="hud-depth" className="px-3 py-1 pointer-events-none bg-black/60 border border-cyan-400/30 rounded text-[9px] flex items-center font-mono tracking-widest text-cyan-400">Đang xem: Lớp {activeLayerIndex + 1}/{L}</span>
            </div>

            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-black/80 backdrop-blur-md border border-white/10 rounded-full px-6 py-2 z-20 shadow-2xl">
               <span className="text-[10px] font-mono text-cyan-400 w-12">{Math.round(zoomLevel)}%</span>
               <div className="relative w-48 flex items-center">
                 <input 
                   type="range" 
                   min={0} 
                   max={100} 
                   value={Math.abs(sliderValue - 50) < 3 ? 50 : sliderValue}
                   onChange={(e) => {
                     const v = parseInt(e.target.value);
                     let snapV = v;
                     if (Math.abs(v - 50) < 3) snapV = 50;
                     const scale = snapV <= 50 ? 0.1 + (snapV / 50) * 0.9 : 1 + ((snapV - 50) / 50) * 19;
                     apiRef.current?.setZoom(scale);
                   }}
                   className="w-full relative z-10 accent-cyan-400"
                 />
                 <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-3.5 bg-cyan-500/50 pointer-events-none"></div>
               </div>
               <div className="w-[1px] h-4 bg-white/20 mx-2"></div>
               <button onClick={() => apiRef.current?.fitScreen()} className="text-slate-300 hover:text-white transition-colors p-1" title="Vừa màn hình">
                  <Maximize size={16} />
               </button>
               {(prevProject || nextProject) && <div className="w-[1px] h-4 bg-white/20 mx-2"></div>}
               {prevProject && (
                  <button onClick={() => updateProject(prevProject)} className="text-slate-300 hover:text-white transition-colors p-1" title={`Dự án trước: ${prevProject.name}`}>
                     <ChevronLeft size={16} />
                  </button>
               )}
               {nextProject && (
                  <button onClick={() => updateProject(nextProject)} className="text-slate-300 hover:text-white transition-colors p-1" title={`Dự án sau: ${nextProject.name}`}>
                     <ChevronRight size={16} />
                  </button>
               )}
            </div>
          </div>
        </main>

        <aside className="w-[280px] max-w-[320px] border-l border-white/5 bg-[#08090c] flex flex-col z-10 shrink-0">
          <div className="p-5 flex-1 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
               <h2 className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Thành Phần Lớp</h2>
               <button 
                  onClick={() => setIsEditMode(!isEditMode)}
                  className={`px-3 py-1.5 rounded text-[10px] font-medium tracking-wide uppercase transition-colors ${isEditMode ? 'bg-cyan-500 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}
               >
                  {isEditMode ? 'Đóng Chỉnh Sửa' : 'Chỉnh Sửa'}
               </button>
            </div>
            
            <label className="w-full py-3 border border-dashed border-white/20 rounded-lg text-[10px] uppercase tracking-widest text-slate-400 hover:border-cyan-400 hover:bg-cyan-500/5 hover:text-cyan-400 transition-all flex items-center justify-center cursor-pointer mb-6">
              + Thêm Ảnh/Video
              <input type="file" multiple accept="image/*,video/*" onChange={handleFiles} className="hidden" />
            </label>

            <div className="space-y-4 mb-6">
              {project.layers.map((layer, idx) => {
                const isActive = idx === activeLayerIndex;
                const renderIsActive = isEditMode ? selectedEditLayerId === layer.id : isActive;
                return (
                  <div key={layer.id} id={`layer-item-${idx}`} onClick={() => { if(isEditMode) setSelectedEditLayerId(layer.id); }} className={`group p-3 rounded-lg relative overflow-hidden transition-all flex flex-col gap-2 ${isEditMode ? 'cursor-pointer' : ''} ${renderIsActive ? 'bg-cyan-500/10 border-cyan-400 border shadow-[0_0_15px_rgba(34,211,238,0.15)]' : `bg-white/[0.02] border border-white/5 ${idx === 0 ? 'opacity-100' : 'opacity-60 hover:opacity-100 focus-within:opacity-100'}`}`}>
                     <div className="flex items-start justify-between">
                        <div className="flex flex-col min-w-0 pr-2">
                          <span data-layer-name className={`text-[11px] font-bold uppercase tracking-wider truncate block w-full ${renderIsActive ? 'text-cyan-400' : 'text-white'}`} title={layer.name}>
                             {String(idx + 1).padStart(2, '0')}. {layer.name}
                          </span>
                          <span className="text-[9px] font-mono opacity-50 mt-0.5">
                            LOẠI: {layer.type}
                            {(() => {
                              const elData = elementsRef.current[idx];
                              if (!elData || !elData.el) return null;
                              let w = 0, h = 0;
                              if (elData.type === 'image') {
                                w = (elData.el as HTMLImageElement).naturalWidth;
                                h = (elData.el as HTMLImageElement).naturalHeight;
                              } else {
                                w = (elData.el as HTMLVideoElement).videoWidth;
                                h = (elData.el as HTMLVideoElement).videoHeight;
                              }
                              if (w > 0 && h > 0) {
                                return ` | SIZE: ${w}x${h}`;
                              }
                              return null;
                            })()}
                          </span>
                        </div>
                        <span className="text-[9px] font-mono px-1.5 py-0.5 bg-white/10 rounded shrink-0">L_{idx + 1}</span>
                     </div>
                     
                     <div className="flex items-center gap-3 mt-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleLayerVisibility(layer.id);
                          }}
                          className={`w-7 h-7 flex items-center justify-center rounded-md border transition-all shrink-0 ${
                            layer.visible !== false
                              ? 'bg-cyan-500/10 border-cyan-400/30 text-cyan-400 hover:bg-cyan-400/20 hover:text-cyan-300'
                              : 'bg-white/5 border-white/5 text-slate-500 hover:bg-white/10 hover:text-slate-400'
                          }`}
                          title={layer.visible !== false ? "Ẩn lớp" : "Hiện lớp"}
                        >
                          {layer.visible !== false ? <Eye size={13} /> : <EyeOff size={13} />}
                        </button>
                        <div className={layer.visible !== false ? 'shrink-0' : 'shrink-0 opacity-40 transition-opacity'}>
                           <Thumbnail layer={layer} />
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                           <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
                              <div id={`layer-bar-${idx}`} className="h-full bg-cyan-400 transition-all font-mono" style={{ width: idx===0 ? '100%' : '0%' }}></div>
                           </div>
                        </div>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                           <button onClick={(e) => { e.stopPropagation(); moveUp(idx); }} disabled={idx === 0} title="Lên trên" className="w-6 h-6 flex items-center justify-center hover:bg-white/10 text-slate-400 hover:text-white rounded disabled:opacity-30"><ArrowUp size={12}/></button>
                           <button onClick={(e) => { e.stopPropagation(); moveDown(idx); }} disabled={idx === L - 1} title="Xuống dưới" className="w-6 h-6 flex items-center justify-center hover:bg-white/10 text-slate-400 hover:text-white rounded disabled:opacity-30"><ArrowDown size={12}/></button>

                           <label title="Thay đổi tệp" className="w-6 h-6 flex items-center justify-center hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-400 rounded cursor-pointer ml-1" onClick={(e) => e.stopPropagation()}>
                               <RefreshCw size={12}/>
                               <input type="file" accept="image/*,video/*" onChange={(e) => handleReplaceLayer(layer.id, e)} className="hidden" />
                           </label>
                           <button onClick={(e) => { e.stopPropagation(); removeLayerClick(layer.id); }} title="Xóa" className="w-6 h-6 flex items-center justify-center hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded ml-0.5"><Trash2 size={12}/></button>
                        </div>
                     </div>
                  </div>
                );
              })}
              
              {project.layers.length === 0 && (
                <div className="border border-dashed border-white/10 rounded-lg p-6 text-center text-[10px] uppercase tracking-widest text-slate-600">
                   CHƯA CÓ LỚP NÀO
                </div>
              )}
            </div>

            {isEditMode && (
              <div className="pt-4 border-t border-white/5 space-y-5 mb-6">
                 <div>
                   <h2 className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-3 block">Công cụ chỉnh sửa</h2>

                    {/* BỘ ĐIỀU CHỈNH MẶT NẠ (MASK) */}
                    <div className="pt-2 pb-4 border-b border-slate-700/30 space-y-4 mb-4">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input 
                            type="checkbox" 
                            checked={isMaskOn} 
                            onChange={(e) => setIsMaskOn(e.target.checked)}
                            className="w-3 mx-1 h-3 rounded bg-white/5 border border-white/20 accent-cyan-400 cursor-pointer"
                          />
                          <span className="text-[10px] uppercase tracking-[0.15em] text-slate-300 font-medium font-sans">BẬT MẶT NẠ (MASK)</span>
                        </label>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider ${isMaskOn ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30' : 'bg-white/5 text-slate-500 border border-white/5'}`}>
                          {isMaskOn ? 'ON' : 'OFF'}
                        </span>
                      </div>

                      {isMaskOn && (
                        <div className="space-y-4 bg-white/[0.02] border border-white/5 p-3 rounded-md">
                          {/* Tools selection */}
                          <div>
                            <span className="text-[9px] uppercase tracking-widest text-slate-500 block mb-2">QUYẾT ĐỊNH CÔNG CỤ</span>
                            <div className="flex bg-black/40 p-0.5 rounded border border-white/5 gap-0.5">
                              <button 
                                onClick={() => setMaskBrushType('brush')}
                                className={`flex-1 py-1 flex items-center justify-center gap-1.5 text-[9px] uppercase tracking-widest rounded-sm transition-colors ${maskBrushType === 'brush' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/20' : 'text-slate-400 hover:text-white'}`}
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span> Bút Vẽ (Brush)
                              </button>
                              <button 
                                onClick={() => setMaskBrushType('eraser')}
                                className={`flex-1 py-1 flex items-center justify-center gap-1.5 text-[9px] uppercase tracking-widest rounded-sm transition-colors ${maskBrushType === 'eraser' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/20' : 'text-slate-400 hover:text-white'}`}
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span> Cục Tẩy (Eraser)
                              </button>
                            </div>
                          </div>

                          {/* Brush options */}
                          {maskBrushType === 'brush' && (
                             <div className="space-y-3">
                               {/* Color spectrum */}
                               <div>
                                 <div className="flex justify-between text-[9px] font-mono text-slate-400 mb-1.5">
                                   <span>MÀU SẮC (ĐEN - XÁM - TRẮNG)</span>
                                   <span className="text-cyan-400 text-[10px]" style={{ color: `rgb(${maskBrushColor}, ${maskBrushColor}, ${maskBrushColor})` }}>
                                     {maskBrushColor === 0 ? 'Đen (Ẩn)' : maskBrushColor === 255 ? 'Trắng (Hiện)' : `Xám (${maskBrushColor})`}
                                   </span>
                                 </div>
                                 
                                 {/* Preset selections */}
                                 <div className="flex gap-1.5 mb-2 h-6">
                                   {[
                                     { val: 0, label: 'Đen', color: '#000000' },
                                     { val: 64, label: 'Xám Đậm', color: '#404040' },
                                     { val: 128, label: 'Xám', color: '#808080' },
                                     { val: 192, label: 'Xám Nhạt', color: '#c0c0c0' },
                                     { val: 255, label: 'Trắng', color: '#ffffff' }
                                   ].map((pVal) => (
                                     <button 
                                       key={pVal.val}
                                       onClick={() => setMaskBrushColor(pVal.val)}
                                       className={`flex-1 rounded border overflow-hidden relative group transition-all ${maskBrushColor === pVal.val ? 'border-cyan-400 scale-[1.05]' : 'border-white/10 hover:border-white/30'}`}
                                       title={pVal.label}
                                       style={{ backgroundColor: pVal.color }}
                                     >
                                       {maskBrushColor === pVal.val && (
                                         <div className="absolute inset-0 flex items-center justify-center bg-cyan-400/20">
                                           <div className="w-1.5 h-1.5 rounded-full bg-cyan-400"></div>
                                         </div>
                                       )}
                                     </button>
                                   ))}
                                 </div>

                                 <input 
                                   type="range" 
                                   min="0" 
                                   max="255" 
                                   value={maskBrushColor} 
                                   onChange={(e) => setMaskBrushColor(parseInt(e.target.value))} 
                                   className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400" 
                                 />
                               </div>
                             </div>
                           )}

                           {/* Size & Hardness */}
                           <div className="space-y-3">
                             <div>
                               <div className="flex justify-between text-[9px] font-mono text-slate-400 mb-1">
                                 <span>KÍCH THƯỚC CỌ (SIZE)</span>
                                 <span className="text-cyan-400">{maskBrushSize}px</span>
                               </div>
                               <input 
                                 type="range" 
                                 min="5" 
                                 max="200" 
                                 value={maskBrushSize} 
                                 onChange={(e) => setMaskBrushSize(parseInt(e.target.value))} 
                                 className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400" 
                               />
                             </div>

                             <div>
                               <div className="flex justify-between text-[9px] font-mono text-slate-400 mb-1">
                                 <span>ĐỘ CỨNG (HARDNESS)</span>
                                 <span className="text-cyan-400">{maskBrushHardness}%</span>
                               </div>
                               <input 
                                 type="range" 
                                 min="0" 
                                 max="100" 
                                 value={maskBrushHardness} 
                                 onChange={(e) => setMaskBrushHardness(parseInt(e.target.value))} 
                                 className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400" 
                               />
                             </div>
                           </div>

                           {/* Visibility options */}
                           <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                             <label className="flex items-center gap-1.5 cursor-pointer">
                               <input 
                                 type="checkbox" 
                                 checked={showMaskOverlay} 
                                 onChange={(e) => setShowMaskOverlay(e.target.checked)}
                                 className="w-3 h-3 rounded bg-white/5 border border-white/20 accent-cyan-400 cursor-pointer"
                               />
                               <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider select-none">Màu Mask Đỏ (Quick Mask)</span>
                             </label>
                           </div>

                           {/* Quick Actions */}
                           <div className="pt-2 border-t border-white/5 flex gap-1.5">
                             <button 
                               onClick={() => {
                                 if (maskCanvasRef.current && maskCtxRef.current) {
                                   maskCtxRef.current.fillStyle = '#000000';
                                   maskCtxRef.current.fillRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
                                   updateAlphaMask();
                                 }
                               }}
                               className="flex-1 py-1 text-center text-[9px] uppercase tracking-wider rounded border border-white/10 hover:border-white/35 text-slate-400 hover:text-white transition-colors bg-white/5"
                             >
                               Xóa Sạch
                             </button>
                             <button 
                               onClick={() => {
                                 if (maskCanvasRef.current && maskCtxRef.current) {
                                   maskCtxRef.current.fillStyle = '#ffffff';
                                   maskCtxRef.current.fillRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
                                   updateAlphaMask();
                                 }
                               }}
                               className="flex-1 py-1 text-center text-[9px] uppercase tracking-wider rounded border border-white/10 hover:border-white/35 text-slate-400 hover:text-white transition-colors bg-white/5"
                             >
                               Tô Đầy
                             </button>
                           </div>
                         </div>
                       )}
                     </div>
                   <div className="flex gap-2 mb-4">
                     <button onClick={handleUndo} disabled={undoStackRef.current.length===0} className="flex-1 py-1.5 flex items-center justify-center gap-2 text-[9px] uppercase tracking-widest rounded-sm transition-colors border bg-transparent text-slate-400 border-white/10 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed">
                       <Undo2 size={12}/> Undo
                     </button>
                     <button onClick={handleRedo} disabled={redoStackRef.current.length===0} className="flex-1 py-1.5 flex items-center justify-center gap-2 text-[9px] uppercase tracking-widest rounded-sm transition-colors border bg-transparent text-slate-400 border-white/10 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed">
                       <Redo2 size={12}/> Redo
                     </button>
                     <button onClick={handleAlignCenter} disabled={!selectedEditLayerId} className="flex-1 py-1.5 flex items-center justify-center gap-2 text-[9px] uppercase tracking-widest rounded-sm transition-colors border bg-transparent text-slate-400 border-white/10 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed">
                       <AlignCenter size={12}/> Giữa
                     </button>
                   </div>
                   
                    {selectedEditLayerId && (
                      <div>
                        <div className="flex justify-between text-[9px] font-mono text-slate-400 mb-2">
                          <span>OPACITY LỚP CHỌN (100% = RÕ, 0% = ẨN)</span>
                          <span className="text-cyan-400">
                            {Math.round((project.layers.find(l => l.id === selectedEditLayerId)?.layerOpacity ?? 1.0) * 100)}%
                          </span>
                        </div>
                        <input 
                           type="range" 
                           min="0" 
                           max="100" 
                           value={Math.round((project.layers.find(l => l.id === selectedEditLayerId)?.layerOpacity ?? 1.0) * 100)} 
                           onChange={(e) => {
                             const newOpacity = parseInt(e.target.value) / 100;
                             const newLayers = project.layers.map(l => 
                               l.id === selectedEditLayerId ? { ...l, layerOpacity: newOpacity } : l
                             );
                             updateProject({ ...project, layers: newLayers });
                             const refIdx = projectRef.current.layers.findIndex(l => l.id === selectedEditLayerId);
                             if (refIdx !== -1) projectRef.current.layers[refIdx].layerOpacity = newOpacity;
                           }} 
                           className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400" 
                        />
                      </div>
                    )}
                 </div>
              </div>
            )}

            {!isEditMode && (
            <div className="pt-4 border-t border-white/5 space-y-5 mb-6">
              {!viewState.current.enable3D && (
                <>
                  <div>
                    <h2 className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-3">Chế Độ Xem</h2>
                    <div className="flex gap-1 bg-black/40 p-1 rounded-md border border-white/5">
                      <button onClick={() => updateVS('viewMode', 'lens')} className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest rounded-sm transition-colors ${viewState.current.viewMode === 'lens' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>X-Ray</button>
                      <button onClick={() => updateVS('viewMode', 'compare')} className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest rounded-sm transition-colors ${viewState.current.viewMode === 'compare' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>So Sánh</button>
                    </div>
                  </div>

                  {viewState.current.viewMode === 'lens' && (
                    <div className="space-y-4">
                      <div>
                        <h2 className="text-[10px] uppercase tracking-[0.2em] text-cyan-500/70 mb-3">Kính Lúp</h2>
                        <div className="flex gap-1 mb-4">
                          <button onClick={() => updateVS('lensShape', 0)} className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest rounded-sm transition-colors border ${viewState.current.lensShape === 0 ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50' : 'bg-transparent text-slate-400 border-white/10 hover:bg-white/5'}`}>Tròn</button>
                          <button onClick={() => updateVS('lensShape', 1)} className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest rounded-sm transition-colors border ${viewState.current.lensShape === 1 ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50' : 'bg-transparent text-slate-400 border-white/10 hover:bg-white/5'}`}>Vuông</button>
                          <button onClick={() => updateVS('lensShape', 2)} className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest rounded-sm transition-colors border ${viewState.current.lensShape === 2 ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50' : 'bg-transparent text-slate-400 border-white/10 hover:bg-white/5'}`}>C.Nhật</button>
                        </div>
                        
                        <div className="flex justify-between text-[9px] font-mono text-slate-400 mb-2">
                          <span>KÍCH THƯỚC</span>
                          <span id="hud-size" className="text-cyan-400">{Math.round(viewState.current.lensBaseRadius)}px</span>
                        </div>
                        <input id="slider-size" type="range" min="40" max="800" defaultValue={viewState.current.lensBaseRadius || 160} onChange={(e) => updateVS('lensBaseRadius', parseInt(e.target.value))} className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400 mb-4" />
                      </div>
                    </div>
                  )}

                  {viewState.current.viewMode === 'compare' && (
                    <div className="space-y-4">
                      <div>
                        <h2 className="text-[10px] uppercase tracking-[0.2em] text-cyan-500/70 mb-3">Tùy Chọn So Sánh</h2>
                        
                        <div className="flex justify-between text-[9px] font-mono text-slate-400 mb-2">
                          <span>LỚP TRƯỚC (BEFORE)</span>
                        </div>
                        <select 
                          value={viewState.current.compareBefore} 
                          onChange={(e) => updateVS('compareBefore', parseInt(e.target.value))}
                          className="w-full bg-white/5 border border-white/10 rounded outline-none text-[#e2e8f0] text-[11px] p-2 mb-4"
                        >
                          {project.layers.map((l, i) => (
                            <option key={l.id} value={i} className="bg-[#0f1115]">{i + 1}. {l.name}</option>
                          ))}
                        </select>

                        <div className="flex justify-between text-[9px] font-mono text-slate-400 mb-2">
                          <span>LỚP SAU (AFTER)</span>
                        </div>
                        <select 
                          value={viewState.current.compareAfter} 
                          onChange={(e) => updateVS('compareAfter', parseInt(e.target.value))}
                          className="w-full bg-white/5 border border-white/10 rounded outline-none text-[#e2e8f0] text-[11px] p-2"
                        >
                          {project.layers.map((l, i) => (
                            <option key={l.id} value={i} className="bg-[#0f1115]">{i + 1}. {l.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                  
                  {viewState.current.viewMode === 'lens' && (
                    <>
                      <div className="space-y-4">
                          <div className="flex justify-between text-[9px] font-mono text-slate-400 mb-2 pt-4 border-t border-white/5">
                            <span>LỚP ĐANG XEM (DEPTH)</span>
                            <span id="hud-depth-pct" className="text-cyan-400">{L > 1 ? Math.round(((viewState.current.depth || 0) / (L - 1)) * 100) : 0}%</span>
                          </div>
                          <input id="slider-depth" type="range" min="0" max={L > 1 ? (L - 1) * 1000 : 0} defaultValue={(viewState.current.depth || 0) * 1000} onChange={(e) => updateVS('depth', parseInt(e.target.value) / 1000)} className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400" disabled={L <= 1} />
                      </div>

                      <div>
                        <h2 className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-3 mt-4">Tự Động Mượt Lớp</h2>
                        <div className="flex gap-2 items-center mb-4">
                          <button onClick={() => updateVS('autoAnimate', !viewState.current.autoAnimate)} className={`flex-1 py-2 text-[10px] uppercase tracking-widest border rounded transition-colors ${viewState.current.autoAnimate ? 'bg-red-500/10 text-red-400 border border-red-500/30' : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20'}`}>
                            {viewState.current.autoAnimate ? 'Dừng mượt' : 'Play mượt lớp'}
                          </button>
                        </div>
                        {viewState.current.autoAnimate && (
                           <div className="animate-in fade-in slide-in-from-top-2">
                              <div className="flex justify-between text-[9px] font-mono text-slate-400 mb-2">
                                <span>TỐC ĐỘ</span>
                              </div>
                              <div className="flex gap-1">
                                <button onClick={() => updateVS('autoAnimateSpeed', 0.001)} className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest rounded-sm transition-colors border ${viewState.current.autoAnimateSpeed === 0.001 ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50' : 'bg-transparent text-slate-400 border-white/10 hover:bg-white/5'}`}>Chậm (1ms)</button>
                                <button onClick={() => updateVS('autoAnimateSpeed', 0.002)} className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest rounded-sm transition-colors border ${viewState.current.autoAnimateSpeed === 0.002 ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50' : 'bg-transparent text-slate-400 border-white/10 hover:bg-white/5'}`}>BT (2ms)</button>
                                <button onClick={() => updateVS('autoAnimateSpeed', 0.003)} className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest rounded-sm transition-colors border ${viewState.current.autoAnimateSpeed >= 0.003 ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50' : 'bg-transparent text-slate-400 border-white/10 hover:bg-white/5'}`}>Nhanh (3ms)</button>
                              </div>
                           </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}

              <div className="pt-4 border-t border-white/5 mt-6 pb-6">
                <h2 className="text-[10px] uppercase tracking-[0.2em] text-cyan-400 mb-3 flex items-center gap-2">
                  <Box size={14} /> Hybrid 3D
                </h2>
                {project.depthMap ? (
                  <div className="space-y-4 bg-white/5 border border-white/10 p-3 rounded-lg">
                    <div className="flex gap-3">
                       <img src={depthUrl || undefined} className="w-12 h-12 rounded object-cover border border-white/20" />
                       <div className="flex-1 flex flex-col justify-center min-w-0">
                          <span className="text-[10px] text-white font-medium truncate block w-full">{project.depthMap.name}</span>
                          <span className="text-[9px] text-slate-400">Depth Map</span>
                       </div>
                       <button onClick={removeDepthMap} className="text-slate-500 hover:text-red-400 p-2 shrink-0">
                          <Trash2 size={12} />
                       </button>
                    </div>
                    
                    <div className="flex items-center justify-between border-t border-white/10 pt-3">
                       <span className="text-[9px] font-mono text-slate-400">BẬT HIỆU ỨNG 3D</span>
                       <button onClick={() => {
                          const nextVal = !viewState.current.enable3D;
                          updateVS('enable3D', nextVal);
                          if (nextVal) {
                            updateVS('viewMode', 'lens');
                            updateVS('autoAnimate', false);
                          }
                       }} className={`w-8 h-4 rounded-full transition-colors relative ${viewState.current.enable3D ? 'bg-cyan-500' : 'bg-slate-700'}`}>
                          <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${viewState.current.enable3D ? 'translate-x-4' : 'translate-x-0'}`} />
                       </button>
                    </div>

                        {viewState.current.enable3D && (
                          <div className="pt-2">
                            <div className="flex justify-between text-[9px] font-mono text-slate-400 mb-2">
                              <span>CƯỜNG ĐỘ 3D</span>
                              <span id="hud-intensity" className="text-cyan-400">{Math.round(viewState.current.intensity3D * 100)}%</span>
                            </div>
                            <input id="slider-intensity" type="range" min="0" max="100" defaultValue={Math.round((viewState.current.intensity3D || 0) * 100)} onChange={(e) => updateVS('intensity3D', parseInt(e.target.value) / 100)} className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400 mb-4" />

                            <div className="flex justify-between text-[9px] font-mono text-slate-400 mb-2">
                              <span>NGƯỠNG (THRESHOLD)</span>
                              <span id="hud-threshold" className="text-cyan-400">{Math.round((viewState.current.threshold3D || 0) * 100)}%</span>
                            </div>
                            <input id="slider-threshold" type="range" min="0" max="100" defaultValue={Math.round((viewState.current.threshold3D || 0) * 100)} onChange={(e) => updateVS('threshold3D', parseInt(e.target.value) / 100)} className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400 mb-4" />

                            <div className="flex justify-between text-[9px] font-mono text-slate-400 mb-2">
                              <span>MƯỢT MÀ (EASING)</span>
                              <span id="hud-easing" className="text-cyan-400">{Math.round((viewState.current.easing3D || 0) * 100)}%</span>
                            </div>
                            <input id="slider-easing" type="range" min="0" max="100" defaultValue={Math.round((viewState.current.easing3D || 0) * 100)} onChange={(e) => updateVS('easing3D', parseInt(e.target.value) / 100)} className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400" />
                          </div>
                        )}
                      </div>
                    ) : (
                      <label className="w-full py-4 border border-dashed border-white/20 rounded-lg text-[10px] uppercase tracking-widest text-slate-400 hover:border-cyan-400 hover:bg-cyan-500/5 hover:text-cyan-400 transition-all flex flex-col items-center justify-center cursor-pointer gap-2">
                        <ArrowUp size={16} />
                        <span>Thêm Depth Map (Grayscale)</span>
                        <input type="file" accept="image/*" onChange={handleDepthFiles} className="hidden" />
                      </label>
                    )}
                  </div>
            </div>
            )}
          </div>
        </aside>
      </div>

      <footer className="h-8 border-t border-white/10 bg-[#050608] flex items-center justify-between px-4 text-[9px] font-mono text-slate-500 shrink-0 z-20">
        <div className="flex gap-4">
          <span id="hud-coords">TỌA ĐỘ: 0x 0y</span>
          <span id="hud-lens-status" className="text-cyan-600 hidden sm:inline">KÍNH_LÚP: BẬT</span>
        </div>
        <div>
          <span>KẾT_XUẤT: CANVAS/2D</span>
          <span className="ml-4 hidden sm:inline">MÔ_PHỎNG: ỔN_ĐỊNH</span>
        </div>
      </footer>

      {layerDeleteConfirm && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-auto" 
          onClick={() => setLayerDeleteConfirm(null)}
        >
          <div 
            className="bg-[#0f1115] border border-white/10 p-6 rounded-lg shadow-2xl max-w-sm w-full m-4 pointer-events-auto" 
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-white mb-2 uppercase tracking-wider">Xác nhận xóa lớp</h3>
            <p className="text-[11px] text-slate-400 mb-6 uppercase tracking-wide">Bạn có chắc chắn muốn xóa lớp ảnh/video này? Hành động này không thể hoàn tác.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setLayerDeleteConfirm(null)} className="px-4 py-2 rounded text-[11px] font-semibold text-slate-400 hover:text-white transition-colors uppercase tracking-widest">
                HỦY
              </button>
              <button onClick={confirmRemoveLayer} className="px-4 py-2 rounded bg-red-500/10 text-red-500 font-semibold text-[11px] border border-red-500/20 hover:bg-red-500 hover:text-white transition-colors uppercase tracking-widest">
                XÓA LỚP
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
