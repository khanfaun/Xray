import { ProjectData } from '../types';

/**
 * High-performance Object URL and decoded image cache for recent projects.
 * Reusing Object URLs and keeping decoded images warm in memory prevents the visible
 * flash / hitch ("load lại 1 nhịp") when navigating back and forth between projects.
 */
class ProjectMediaCache {
  private urlMap = new Map<string, string>(); // blobKey -> objectUrl
  private imageWarmupMap = new Map<string, HTMLImageElement>();

  /**
   * Generates or retrieves an existing Object URL for a given blob/file.
   */
  getUrl(key: string, blob: Blob | File): string {
    let url = this.urlMap.get(key);
    if (!url) {
      url = URL.createObjectURL(blob);
      this.urlMap.set(key, url);
    }
    return url;
  }

  /**
   * Pre-warms image decoding for a project in the background so that
   * when the user switches to this project, the browser renders it immediately with 0 delay.
   */
  preloadProject(project: ProjectData): void {
    project.layers.forEach((layer) => {
      if (layer.blob && layer.type === 'image') {
        const url = this.getUrl(layer.id, layer.blob);
        if (!this.imageWarmupMap.has(layer.id)) {
          const img = new Image();
          img.decoding = 'async';
          img.src = url;
          this.imageWarmupMap.set(layer.id, img);
        }
      }
    });
  }

  /**
   * Cleans up URLs that do not belong to currently active or recent projects.
   */
  retainKeys(activeKeys: Set<string>): void {
    for (const [key, url] of this.urlMap.entries()) {
      if (!activeKeys.has(key)) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignore
        }
        this.urlMap.delete(key);
        this.imageWarmupMap.delete(key);
      }
    }
  }

  /**
   * Completely clears all cached URLs.
   */
  clear(): void {
    for (const url of this.urlMap.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore
      }
    }
    this.urlMap.clear();
    this.imageWarmupMap.clear();
  }
}

export const projectMediaCache = new ProjectMediaCache();
