import React from 'react';

export interface TableMapItem {
  id: string;
  x: number; // percentage (0-100)
  y: number; // percentage (0-100)
  w: number; // percentage (0-100)
  h: number; // percentage (0-100)
  label: string;
  subLabel?: string;
  bg: string;
  border: string;
  color: string;
  shadow: string;
  cursor: string;
  opacity?: number;
  transform?: string;
  pointerEvents?: React.CSSProperties['pointerEvents'];
  onTap: () => void;
}

interface TableMapProps {
  tables: TableMapItem[];
  zoom?: number;
  onBackgroundTap?: () => void;
}

export function TableMap({ tables, zoom = 1, onBackgroundTap }: TableMapProps) {
  return (
    <div
      onClick={onBackgroundTap}
      style={{
        flex: '1',
        minHeight: '0',
        position: 'relative',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '12px',
        boxShadow: 'var(--shadow-xs)',
        overflow: 'hidden',
        width: '100%',
        height: '100%',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: `translate(-50%, -50%) scale(${zoom})`,
          transformOrigin: 'center center',
          aspectRatio: '1.8',
          width: 'min(100%, calc((100vh - 200px) * 1.8))',
          minWidth: '80%',
          transition: 'transform 180ms ease-out',
        }}
      >
        {tables.map((t) => (
          <button
            key={t.id}
            onClick={(e) => {
              e.stopPropagation();
              t.onTap();
            }}
            style={{
              position: 'absolute',
              left: `${t.x}%`,
              top: `${t.y}%`,
              width: `${t.w}%`,
              height: `${t.h}%`,
              borderRadius: '10px',
              cursor: t.cursor,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '2px',
              fontFamily: 'inherit',
              background: t.bg,
              border: t.border,
              color: t.color,
              boxShadow: t.shadow,
              opacity: t.opacity ?? 1,
              transform: t.transform ?? 'none',
              pointerEvents: t.pointerEvents ?? 'auto',
              transition: 'box-shadow 150ms ease-out, opacity 150ms ease-out, transform 150ms ease-out',
            }}
          >
            <span style={{ fontSize: '16px', fontWeight: '600' }}>{t.label}</span>
            {t.subLabel && (
              <span style={{ fontSize: '11.5px', fontWeight: '500', opacity: 0.75 }}>
                {t.subLabel}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
