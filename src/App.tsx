import React, { useState } from 'react';
import ProjectList from './components/ProjectList';
import XRayViewer from './components/XRayViewer';
import { ProjectData, ProjectSummary } from './types';

export default function App() {
  const [view, setView] = useState<'list' | 'view'>('list');
  const [activeProject, setActiveProject] = useState<ProjectData | null>(null);
  const [activeProjectList, setActiveProjectList] = useState<ProjectSummary[]>([]);

  return (
    <>
      {view === 'list' && (
        <ProjectList
          onOpenProject={(p, list) => {
            setActiveProject(p);
            if (list) setActiveProjectList(list);
            setView('view');
          }}
        />
      )}
      
      {view === 'view' && activeProject && (
        <XRayViewer
          initialProject={activeProject}
          projectListSequence={activeProjectList}
          onBack={() => {
            setActiveProject(null);
            setView('list');
          }}
        />
      )}
    </>
  );
}

