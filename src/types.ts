export interface LayerData {
  id: string;
  name: string;
  type: 'image' | 'video';
  blob: Blob | File;
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
  createdAt: number;
  layers: LayerData[];
  depthMap?: Blob | File;
}
