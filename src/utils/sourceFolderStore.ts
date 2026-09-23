/**
 * Source Folder Store
 * Allows users to select a local source folder (e.g. ComfyUI/input or project folder) ONCE.
 * Keeps an in-memory index of File objects with their filenames and relative paths
 * so that any AFTER image uploaded can be automatically matched without requiring browser
 * native filesystem permissions or repeated file picking.
 */

export interface SourceFolderFileItem {
  file: File;
  name: string;
  relativePath: string;
  lowerName: string;
  lowerBaseName: string;
  lowerRelativePath: string;
}

export interface SourceFolderState {
  folderName: string | null;
  filesCount: number;
  lastUpdated: number;
}

type Listener = (state: SourceFolderState) => void;

class SourceFolderManager {
  private files: SourceFolderFileItem[] = [];
  private folderName: string | null = null;
  private byExactFilename = new Map<string, File>();
  private byBaseName = new Map<string, File>();
  private byRelativePath = new Map<string, File>();
  private listeners: Set<Listener> = new Set();

  constructor() {
    // Try to restore saved folder name if any
    try {
      const savedName = localStorage.getItem('xray_source_folder_name');
      if (savedName) {
        this.folderName = savedName;
      }
    } catch {
      // ignore
    }
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const state = this.getState();
    this.listeners.forEach((l) => l(state));
  }

  public getState(): SourceFolderState {
    return {
      folderName: this.folderName,
      filesCount: this.files.length,
      lastUpdated: Date.now(),
    };
  }

  public getFolderName(): string | null {
    return this.folderName;
  }

  public getFilesCount(): number {
    return this.files.length;
  }

  public getAllFiles(): File[] {
    return this.files.map((item) => item.file);
  }

  /**
   * Register files selected by user through directory picker (<input webkitdirectory />)
   */
  public setDirectoryFiles(fileList: FileList | File[], customFolderName?: string) {
    const arr = Array.from(fileList);
    this.files = [];
    this.byExactFilename.clear();
    this.byBaseName.clear();
    this.byRelativePath.clear();

    // Determine folder name from webkitRelativePath if available
    let detectedFolder = customFolderName || '';
    if (!detectedFolder && arr.length > 0 && arr[0].webkitRelativePath) {
      const parts = arr[0].webkitRelativePath.split(/[/\\]/);
      if (parts.length > 1) {
        detectedFolder = parts[0];
      }
    }
    this.folderName = detectedFolder || 'Thư mục ảnh nguồn';

    try {
      localStorage.setItem('xray_source_folder_name', this.folderName);
    } catch {
      // ignore
    }

    // Index all image files
    for (const f of arr) {
      // Filter image files or common graphic extensions
      const isImg = f.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|tiff?|avif|heic|gif|svg)$/i.test(f.name);
      if (!isImg) continue;

      const lowerName = f.name.toLowerCase();
      const lowerBaseName = lowerName.replace(/\.[a-zA-Z0-9]+$/, '');
      const relPath = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
      const lowerRelPath = relPath.toLowerCase();

      const item: SourceFolderFileItem = {
        file: f,
        name: f.name,
        relativePath: relPath,
        lowerName,
        lowerBaseName,
        lowerRelativePath: lowerRelPath,
      };

      this.files.push(item);

      // Map indexing (prefer earlier files or unique matches)
      if (!this.byExactFilename.has(lowerName)) {
        this.byExactFilename.set(lowerName, f);
      }
      if (!this.byBaseName.has(lowerBaseName)) {
        this.byBaseName.set(lowerBaseName, f);
      }
      if (!this.byRelativePath.has(lowerRelPath)) {
        this.byRelativePath.set(lowerRelPath, f);
      }
    }

    this.notify();
  }

  /**
   * Search for a matching file by target filename or relative path
   * Optimized with O(1) Map lookups first to keep performance blazing fast even with 5,000+ files.
   */
  public findMatch(targetFilename: string, relativePath?: string): { file: File; matchReason: string } | null {
    if (!targetFilename && !relativePath) return null;

    const lowerTarget = (targetFilename || '').toLowerCase().trim();
    const lowerRel = (relativePath || '').replace(/\\/g, '/').toLowerCase().trim();
    const lowerBase = lowerTarget.replace(/\.[a-zA-Z0-9]+$/, '');

    // 1. Instant O(1) exact filename match (most common and fastest)
    if (lowerTarget) {
      const exactFile = this.byExactFilename.get(lowerTarget);
      if (exactFile) {
        return { file: exactFile, matchReason: `Tên tệp (${exactFile.name})` };
      }
    }

    // 2. Instant O(1) exact relative path match
    if (lowerRel) {
      const exactRel = this.byRelativePath.get(lowerRel);
      if (exactRel) {
        return { file: exactRel, matchReason: `Đường dẫn tương đối (${lowerRel})` };
      }
    }

    // 3. Instant O(1) base name match (in case extension differed, e.g. .png vs .jpg / .webp)
    if (lowerBase) {
      const baseFile = this.byBaseName.get(lowerBase);
      if (baseFile) {
        return { file: baseFile, matchReason: `Tên tệp cơ sở (${baseFile.name})` };
      }
    }

    // 4. Subpath / suffix match (only if previous O(1) steps did not find a match)
    if (lowerRel) {
      for (const item of this.files) {
        if (item.lowerRelativePath.endsWith(lowerRel) || item.lowerRelativePath.endsWith(`/${lowerRel}`)) {
          return { file: item.file, matchReason: `Đường dẫn thư mục con (${item.relativePath})` };
        }
      }
    }

    return null;
  }

  /**
   * Clear all indexed files
   */
  public clear() {
    this.files = [];
    this.folderName = null;
    this.byExactFilename.clear();
    this.byBaseName.clear();
    this.byRelativePath.clear();
    try {
      localStorage.removeItem('xray_source_folder_name');
    } catch {
      // ignore
    }
    this.notify();
  }
}

export const sourceFolderManager = new SourceFolderManager();
