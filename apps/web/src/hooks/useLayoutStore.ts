import { useState, useCallback } from 'react';

export type PanelSize = 'compact' | 'normal' | 'expanded';

export interface PanelLayout {
  order: number;
  size: PanelSize;
}

interface LayoutMap {
  [taskId: string]: PanelLayout;
}

function storageKey(repoId: string): string {
  return `claudectrl-layout-${repoId}`;
}

function loadLayouts(repoId: string): LayoutMap {
  try {
    const raw = localStorage.getItem(storageKey(repoId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveLayouts(repoId: string, layouts: LayoutMap): void {
  try {
    localStorage.setItem(storageKey(repoId), JSON.stringify(layouts));
  } catch {}
}

export function useLayoutStore(repoId: string) {
  const [layouts, setLayouts] = useState<LayoutMap>(() => loadLayouts(repoId));

  const getLayout = useCallback((taskId: string): PanelLayout => {
    return layouts[taskId] ?? { order: 0, size: 'normal' };
  }, [layouts]);

  const setSize = useCallback((taskId: string, size: PanelSize) => {
    setLayouts(prev => {
      const next = { ...prev, [taskId]: { ...(prev[taskId] ?? { order: 0 }), size } };
      saveLayouts(repoId, next);
      return next;
    });
  }, [repoId]);

  const setOrder = useCallback((taskId: string, order: number) => {
    setLayouts(prev => {
      const next = { ...prev, [taskId]: { ...(prev[taskId] ?? { size: 'normal' }), order } };
      saveLayouts(repoId, next);
      return next;
    });
  }, [repoId]);

  const swapOrder = useCallback((taskIdA: string, taskIdB: string) => {
    setLayouts(prev => {
      const layoutA = prev[taskIdA] ?? { order: 0, size: 'normal' };
      const layoutB = prev[taskIdB] ?? { order: 0, size: 'normal' };
      const next = {
        ...prev,
        [taskIdA]: { ...layoutA, order: layoutB.order },
        [taskIdB]: { ...layoutB, order: layoutA.order },
      };
      saveLayouts(repoId, next);
      return next;
    });
  }, [repoId]);

  return { getLayout, setSize, setOrder, swapOrder };
}
