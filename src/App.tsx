import React, { useState } from 'react';
import ProjectList from './components/ProjectList';
import XRayViewer from './components/XRayViewer';
import { ProjectData } from './types';

export default function App() {
  const [view, setView] = useState<'list' | 'view'>('list');
  const [activeProject, setActiveProject] = useState<ProjectData | null>(null);

  return (
    <>
      {view === 'list' && (
        <ProjectList
          onOpenProject={(p) => {
            setActiveProject(p);
            setView('view');
          }}
        />
      )}
      
      {view === 'view' && activeProject && (
        <XRayViewer
          initialProject={activeProject}
          onBack={() => {
            setActiveProject(null);
            setView('list');
          }}
        />
      )}
    </>
  );
}

