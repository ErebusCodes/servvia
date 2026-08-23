import React from 'react';
import { getDrillDownDetails } from './mockData';

interface DrillDownDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  targetType: string; // 'item' | 'staff' | 'station' | 'payment' | 'kpi'
  targetName: string;
}

export function DrillDownDrawer({ isOpen, onClose, targetType, targetName }: DrillDownDrawerProps) {
  if (!isOpen) return null;

  const details = getDrillDownDetails(targetType, targetName);

  // Destructure components from design system
  const DS = (window as any).DesignSystem_7f3fe8 || {};
  const { DataTable, Button, Badge } = DS;

  // Build standard columns dynamically
  const columns = details.headers.map((h, i) => ({
    key: `col${i + 1}`,
    header: h,
    render: (r: any) => {
      const cellVal = r[`col${i + 1}`];
      if (cellVal === 'critical') return <Badge tone="danger">Critical</Badge>;
      if (cellVal === 'low') return <Badge tone="warning">Low</Badge>;
      if (cellVal && cellVal.includes('★')) return <Badge tone="success">{cellVal}</Badge>;
      if (cellVal && cellVal.startsWith('$')) return <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{cellVal}</span>;
      return <span style={{ color: 'var(--color-text-secondary)' }}>{cellVal}</span>;
    }
  }));

  // Re-map rows to matching keys
  const rows = details.rows.map((r: any, idx: number) => ({
    id: idx,
    ...r
  }));

  // Reusable inline trend line for the drawer
  const inlineTrend = () => {
    const trendPts = [20, 60, 45, 80, 50, 95];
    const points = trendPts.map((p, i) => `${i * 60 + 10},${100 - p}`).join(' ');
    return (
      <svg viewBox="0 0 320 120" style={{ width: '100%', height: 120, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)', padding: 10 }}>
        <polyline points={points} fill="none" stroke="var(--color-primary)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {trendPts.map((p, i) => (
          <circle key={i} cx={i * 60 + 10} cy={100 - p} r={4} fill="var(--color-surface)" stroke="var(--color-primary)" strokeWidth={2} />
        ))}
      </svg>
    );
  };

  const handleExportCSV = () => {
    const csvContent = [
      details.headers.join(','),
      ...details.rows.map(r => Object.values(r).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `drilldown_${targetType}_${targetName.replace(/\s+/g, '_').toLowerCase()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.4)',
      zIndex: 1000,
      display: 'flex',
      justifyContent: 'flex-end',
      fontFamily: 'var(--font-sans)',
    }}>
      {/* Backdrop closer click sink */}
      <div onClick={onClose} style={{ flex: 1 }} />

      {/* Drawer content panel */}
      <div style={{
        width: '100%',
        maxWidth: 550,
        height: '100%',
        background: 'var(--color-surface)',
        borderLeft: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-lg)',
        display: 'flex',
        flexDirection: 'column',
        animation: 'slideIn 0.25s ease-out forwards',
        padding: 24,
        gap: 20
      }}>
        {/* Style block for slideIn animation */}
        <style dangerouslySetInnerHTML={{ __html: `
          @keyframes slideIn {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
          }
        `}} />

        {/* Drawer Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text)' }}>{details.title}</h3>
            <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>Nested Analytics Report</span>
          </div>
          <button
            onClick={onClose}
            style={{
              border: 'none',
              background: 'var(--color-surface-3)',
              color: 'var(--color-text-secondary)',
              width: 32,
              height: 32,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 'bold',
              fontSize: 16,
              cursor: 'pointer'
            }}
          >
            ×
          </button>
        </div>

        {/* Quick Trend Indicator */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-tertiary)' }}>
            Performance Trend
          </span>
          {inlineTrend()}
        </div>

        {/* Granular Table Details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, overflow: 'auto' }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-tertiary)' }}>
            Granular Metrics
          </span>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {DataTable && (
              <DataTable columns={columns} rows={rows} style={{ border: 'none' }} />
            )}
          </div>
        </div>

        {/* Drawer Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
          {Button && (
            <>
              <Button variant="secondary" size="md" onClick={handleExportCSV}>
                Download Drill Report (CSV)
              </Button>
              <Button variant="primary" size="md" onClick={onClose}>
                Done
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
