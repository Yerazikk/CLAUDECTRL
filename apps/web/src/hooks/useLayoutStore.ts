import { useState, useCallback } from 'react';

export interface PanelLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

const CARD_W = 380;
const CARD_H = 260;
const COL0_X = 20;
const COL1_X = 420;
const GAP = 16;

function calcInitialLayout(index: number): PanelLayout {
  const col = index % 2;
  const row = Math.floor(index / 2);
  return {
    x: col === 0 ? COL0_X : COL1_X,
    y: 20 + row * (CARD_H + GAP),
    width: CARD_W,
    height: CARD_H,
  };
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

  const getLayout = useCallback((taskId: string, index: number): PanelLayout => {
    return layouts[taskId] ?? calcInitialLayout(index);
  }, [layouts]);

  const setLayout = useCallback((taskId: string, partial: Partial<PanelLayout>) => {
    setLayouts(prev => {
      const existing = prev[taskId] ?? calcInitialLayout(0);
      const next = { ...prev, [taskId]: { ...existing, ...partial } };
      saveLayouts(repoId, next);
      return next;
    });
  }, [repoId]);

  return { getLayout, setLayout };
}
