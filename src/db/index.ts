import localforage from 'localforage';
import { ProjectData } from '../types';

export const db = localforage.createInstance({
  name: 'XRayLensDB',
  storeName: 'projects',
  description: 'Stores X-Ray Lens projects and their layers',
});

export async function getProjects(): Promise<ProjectData[]> {
  const projects: ProjectData[] = [];
  await db.iterate((value: ProjectData) => {
    projects.push(value);
  });
  return projects.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getProject(id: string): Promise<ProjectData | null> {
  return await db.getItem<ProjectData>(id);
}

export async function saveProject(project: ProjectData): Promise<void> {
  await db.setItem(project.id, project);
}

export async function deleteProject(id: string): Promise<void> {
  await db.removeItem(id);
}
