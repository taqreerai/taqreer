import React from 'react';

const gradients = [
  "linear-gradient(135deg, #1a0533 0%, #4c1d95 100%)",
  "linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)",
  "linear-gradient(135deg, #0d1117 0%, #2d1b69 100%)",
  "linear-gradient(135deg, #1a0a2e 0%, #3b0764 100%)",
  "linear-gradient(135deg, #0a0a1a 0%, #1e1b4b 100%)",
  "linear-gradient(135deg, #160a2e 0%, #4a1d96 100%)",
];

export function TemplatesScroll() {
  // TODO: Replace placeholder gradients with real template thumbnails
  // const templates = await fetch('/api/templates?limit=6&sort=recent')
  
  return (
    <div className="templates-scroll-container relative w-full overflow-hidden mask-vertical-edges" style={{ height: '340px' }}>
      <div className="flex gap-4 w-full h-full">
        {/* Column 1 - Scrolls Down (moves up visually) */}
        <div className="flex-1 flex flex-col gap-4 animate-scroll-down w-full h-max">
          {[...Array(3)].map((_, setIndex) => (
            <React.Fragment key={`col1-set-${setIndex}`}>
              {gradients.map((bg, idx) => (
                <div 
                  key={`col1-${setIndex}-${idx}`}
                  className="template-card w-full shrink-0 cursor-pointer"
                  style={{ background: bg, borderRadius: '12px', aspectRatio: '16/9', border: '1px solid rgba(255,255,255,0.06)' }}
                />
              ))}
            </React.Fragment>
          ))}
        </div>
        
        {/* Column 2 - Scrolls Up (moves down visually) */}
        <div className="flex-1 flex flex-col gap-4 animate-scroll-up w-full h-max">
          {[...Array(3)].map((_, setIndex) => (
            <React.Fragment key={`col2-set-${setIndex}`}>
              {[...gradients].reverse().map((bg, idx) => (
                <div 
                  key={`col2-${setIndex}-${idx}`}
                  className="template-card w-full shrink-0 cursor-pointer"
                  style={{ background: bg, borderRadius: '12px', aspectRatio: '16/9', border: '1px solid rgba(255,255,255,0.06)' }}
                />
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
