import React from 'react';
import { useMars } from '../context/MarsContext.jsx';

export const LabelsOverlay = () => {
  const { labels, mode } = useMars();

  if (mode === 'boot') return null;

  return (
    <div id="labels">
      {labels.map((l) => {
        if (!l.pos || !l.pos.visible) return null;
        return (
          <div
            key={l.id}
            className={`lbl ${l.cls || ''}`}
            style={{
              transform: `translate(${l.pos.x}px, ${l.pos.y}px)`
            }}
            dangerouslySetInnerHTML={{ __html: l.html }}
            onClick={l.opts?.onClick}
          />
        );
      })}
    </div>
  );
};
