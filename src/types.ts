export interface LayerData {
  id: string;
  name: string;
  type: 'image' | 'video';
  blob: Blob | File;
  thumbnailBlob?: Blob;
  layerScale?: number;
  layerScaleX?: number;
  layerScaleY?: number;
  layerX?: number;
  layerY?: number;
  layerOpacity?: number;
  visible?: boolean;
}

export interface ProjectData {
  id: string;
  name: string;
  folder?: string;
  createdAt: number;
  layers: LayerData[];
  thumbnailBlob?: Blob;
  depthMap?: Blob | File;
}

export interface ProjectSummary {
  id: string;
  name: string;
  folder?: string;
  createdAt: number;
  layerCount: number;
  firstLayerType?: 'image' | 'video';
  thumbnailBlob?: Blob;
  layerThumbnails?: {
    id: string;
    name: string;
    type: 'image' | 'video';
    thumbnailBlob?: Blob;
  }[];
}
