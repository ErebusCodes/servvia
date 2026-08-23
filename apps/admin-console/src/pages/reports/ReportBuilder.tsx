import React, { useState } from 'react';
import { CustomReportConfig } from './types';

interface ReportBuilderProps {
  onSaveReport: (cfg: CustomReportConfig) => void;
  savedReports: CustomReportConfig[];
  onLoadReport: (cfg: CustomReportConfig) => void;
  onDeleteReport: (id: string) => void;
}

export function ReportBuilder({ onSaveReport, savedReports, onLoadReport, onDeleteReport }: ReportBuilderProps) {
  const [name, setName] = useState('My Custom Sales Analysis');
  const [metrics, setMetrics] = useState<string[]>(['sales', 'orders']);
  const [dimension, setDimension] = useState('menuItem');
  const [chartType, setChartType] = useState<'barV' | 'line' | 'donut' | 'barList' | 'none'>('barList');
  const [dateRange, setDateRange] = useState('last7');
  const [groupBy, setGroupBy] = useState('none');
  const [sortKey, setSortKey] = useState('val');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Destructure components from design system
  const DS = (window as any).DesignSystem_7f3fe8 || {};
  const { Button, Card, CardHeader, DataTable, Checkbox } = DS;

  const toggleMetric = (m: string) => {
    if (metrics.includes(m)) {
      setMetrics(metrics.filter(x => x !== m));
    } else {
      setMetrics([...metrics, m]);
    }
  };

  const handleSave = () => {
    onSaveReport({
      id: Date.now().toString(),
      name,
      metrics,
      dimensions: [dimension],
      columns: [dimension, ...metrics],
      grouping: groupBy,
      sorting: { key: sortKey, dir: sortDir },
      dateRange,
      chartType,
    });
    alert('Report saved successfully!');
  };

  // Generate dynamic preview data based on selections
  const getPreviewData = () => {
    if (metrics.length === 0) return { columns: [], rows: [], chartData: [] };

    // Baseline dimension options
    const dimValues: Record<string, string[]> = {
      menuItem: ['Grilled Halloumi', 'Lamb Shawarma', 'Mixed Grill Platter', 'Margherita Pizza', 'Hummus Bowl'],
      category: ['Mains', 'Pizza & Oven', 'Starters', 'Beverages', 'Desserts'],
      staff: ['Maya Othman', 'Diego Santos', 'Aisha Karim', 'Liam Walsh', 'Nora Haddad'],
      station: ['Grill', 'Fry', 'Cold & Salad', 'Pizza & Oven', 'Dessert'],
    };

    const labelList = (dimValues[dimension] || dimValues.menuItem || []) as string[];
    
    // Baseline metric values
    const metricGenerators: Record<string, (idx: number) => number> = {
      sales: (i) => [2840, 2360, 2180, 1640, 1180][i] || 500,
      orders: (i) => [142, 118, 64, 96, 134][i] || 25,
      covers: (i) => [326, 271, 147, 220, 308][i] || 50,
      waste: (i) => [480, 320, 210, 140, 90][i] || 15,
      prepTime: (i) => [14.2, 9.6, 5.1, 16.8, 12.4][i] || 10,
    };

    // Columns list
    const cols = [
      {
        key: 'dim',
        header: dimension.charAt(0).toUpperCase() + dimension.slice(1).replace(/([A-Z])/g, ' $1'),
        render: (r: any) => <span style={{ fontWeight: 600 }}>{r.dim}</span>
      },
      ...metrics.map(m => ({
        key: m,
        header: m.toUpperCase(),
        align: 'right' as const,
        numeric: true,
        render: (r: any) => {
          const v = r[m];
          if (m === 'sales' || m === 'waste') return '$' + v.toLocaleString();
          if (m === 'prepTime') return v.toFixed(1) + 'm';
          return v.toString();
        }
      }))
    ];

    // Build rows
    let rowsList = labelList.map((label, idx) => {
      const row: any = { id: idx, dim: label };
      metrics.forEach(m => {
        row[m] = metricGenerators[m]?.(idx) || 0;
      });
      return row;
    });

    // Handle Sorting
    rowsList.sort((a, b) => {
      const aVal = sortKey === 'dim' ? a.dim : (a[metrics[0] || 'sales'] || 0);
      const bVal = sortKey === 'dim' ? b.dim : (b[metrics[0] || 'sales'] || 0);
      if (sortDir === 'asc') return aVal > bVal ? 1 : -1;
      return aVal < bVal ? 1 : -1;
    });

    // Build chart segment data
    const colors = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
    const chartData = rowsList.map((r, i) => ({
      l: r.dim,
      v: r[metrics[0] || 'sales'] || 0,
      c: colors[i % colors.length]
    }));

    return { columns: cols, rows: rowsList, chartData };
  };

  const preview = getPreviewData();

  // Mini Chart components tailored for builder panel
  const renderPreviewChart = (chartData: any[]) => {
    if (chartType === 'none' || chartData.length === 0) return null;
    const maxVal = Math.max(...chartData.map(d => d.v)) || 1;

    if (chartType === 'barList') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', padding: '10px 0' }}>
          {chartData.map((d, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span>{d.l}</span>
                <span style={{ fontWeight: 600 }}>{d.v.toLocaleString()}</span>
              </div>
              <div style={{ height: 6, background: 'var(--color-surface-3)', borderRadius: 3 }}>
                <div style={{ width: `${(d.v / maxVal) * 100}%`, height: '100%', background: d.c, borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (chartType === 'barV') {
      return (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 160, padding: '20px 0 10px', width: '100%' }}>
          {chartData.map((d, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end', gap: 6 }}>
              <span style={{ fontSize: 9, color: 'var(--color-text-secondary)', fontWeight: 600 }}>{d.v.toLocaleString()}</span>
              <div style={{ width: '100%', height: `${(d.v / maxVal) * 100}%`, background: d.c, borderRadius: '3px 3px 0 0' }} />
              <span style={{ fontSize: 9, color: 'var(--color-text-tertiary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', width: '100%', textAlign: 'center' }}>{d.l}</span>
            </div>
          ))}
        </div>
      );
    }

    if (chartType === 'donut') {
      const size = 110, sw = 18;
      const total = chartData.reduce((s, x) => s + x.v, 0);
      const r = (size - sw) / 2, circ = 2 * Math.PI * r;
      let acc = 0;
      const circles = chartData.map((s, i) => {
        const len = (s.v / total) * circ;
        const el = (
          <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.c} strokeWidth={sw} strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-acc} />
        );
        acc += len;
        return el;
      });
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%' }}>
          <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>{circles}</svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>{metrics[0]?.toUpperCase()}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            {chartData.map((d, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: d.c }} />
                <span style={{ flex: 1, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{d.l}</span>
                <span style={{ fontWeight: 600 }}>{Math.round((d.v / total) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // Default line fallback
    return (
      <svg viewBox="0 0 320 120" style={{ width: '100%', height: 120 }}>
        <polyline
          points={chartData.map((d, i) => `${i * 70 + 10},${100 - (d.v / maxVal) * 80}`).join(' ')}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={2}
        />
        {chartData.map((d, i) => (
          <circle key={i} cx={i * 70 + 10} cy={100 - (d.v / maxVal) * 80} r={3} fill="var(--color-surface)" stroke="var(--color-primary)" strokeWidth={1.5} />
        ))}
      </svg>
    );
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20, alignItems: 'start', fontFamily: 'var(--font-sans)' }}>
      
      {/* Left panel Config Form */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        
        {/* Saved configurations listing */}
        {savedReports.length > 0 && (
          <Card padding="md">
            <CardHeader title="Saved Custom Reports" style={{ marginBottom: 12 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {savedReports.map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-sm)' }}>
                  <span
                    onClick={() => {
                      setName(r.name);
                      setMetrics(r.metrics);
                      setDimension(r.dimensions[0] || 'menuItem');
                      setChartType(r.chartType);
                      setDateRange(r.dateRange);
                      setGroupBy(r.grouping);
                    }}
                    style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-primary-text)', cursor: 'pointer' }}
                  >
                    {r.name}
                  </span>
                  <button
                    onClick={() => onDeleteReport(r.id)}
                    style={{ border: 'none', background: 'none', color: 'var(--color-text-tertiary)', cursor: 'pointer', fontSize: 13 }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card padding="md">
          <CardHeader title="Configure Report" style={{ marginBottom: 16 }} />
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Report name */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-tertiary)' }}>Report Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{
                  height: 36,
                  padding: '0 12px',
                  border: '1px solid var(--color-border-strong)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                  background: 'var(--color-surface)',
                  color: 'var(--color-text)',
                  outline: 'none'
                }}
              />
            </div>

            {/* Dimension selection */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-tertiary)' }}>Primary Dimension</span>
              <select
                value={dimension}
                onChange={(e) => setDimension(e.target.value)}
                style={{
                  height: 36,
                  border: '1px solid var(--color-border-strong)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                  padding: '0 10px',
                  background: 'var(--color-surface)',
                  color: 'var(--color-text)',
                }}
              >
                <option value="menuItem">Menu Item</option>
                <option value="category">Category</option>
                <option value="staff">Staff Employee</option>
                <option value="station">Kitchen Station</option>
              </select>
            </div>

            {/* Metrics checkboxes */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-tertiary)' }}>Select Metrics</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
                {['sales', 'orders', 'covers', 'waste', 'prepTime'].map((m) => (
                  <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', color: 'var(--color-text)' }}>
                    <input
                      type="checkbox"
                      checked={metrics.includes(m)}
                      onChange={() => toggleMetric(m)}
                      style={{ accentColor: 'var(--color-primary)' }}
                    />
                    {m.toUpperCase()}
                  </label>
                ))}
              </div>
            </div>

            {/* Chart type select */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-tertiary)' }}>Visual Chart Type</span>
              <select
                value={chartType}
                onChange={(e) => setChartType(e.target.value as any)}
                style={{
                  height: 36,
                  border: '1px solid var(--color-border-strong)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                  padding: '0 10px',
                  background: 'var(--color-surface)',
                  color: 'var(--color-text)',
                }}
              >
                <option value="barList">Horizontal Bar List</option>
                <option value="barV">Vertical Columns</option>
                <option value="donut">Donut Segment Share</option>
                <option value="line">Line Graph</option>
                <option value="none">No Chart (Table Only)</option>
              </select>
            </div>

            {/* Sorting controls */}
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-tertiary)' }}>Sort By</span>
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value)}
                  style={{ height: 36, border: '1px solid var(--color-border-strong)', borderRadius: 'var(--radius-sm)', fontSize: 12, background: 'var(--color-surface)', color: 'var(--color-text)' }}
                >
                  <option value="dim">Dimension Label</option>
                  <option value="val">Primary Metric Value</option>
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-tertiary)' }}>Order</span>
                <select
                  value={sortDir}
                  onChange={(e) => setSortDir(e.target.value as any)}
                  style={{ height: 36, border: '1px solid var(--color-border-strong)', borderRadius: 'var(--radius-sm)', fontSize: 12, background: 'var(--color-surface)', color: 'var(--color-text)' }}
                >
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {Button && (
                <>
                  <Button variant="primary" size="md" onClick={handleSave} style={{ flex: 1 }}>
                    Save Report
                  </Button>
                </>
              )}
            </div>

          </div>
        </Card>
      </div>

      {/* Right panel Previews */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {metrics.length === 0 ? (
          <Card padding="lg">
            <div style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', padding: 40 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
              <h4 style={{ fontWeight: 600, fontSize: 15, color: 'var(--color-text)' }}>No Metrics Selected</h4>
              <p style={{ fontSize: 13, marginTop: 4 }}>Select at least one metric from the left sidebar configuration to render your custom builder preview.</p>
            </div>
          </Card>
        ) : (
          <>
            {/* Visual preview */}
            {chartType !== 'none' && (
              <Card padding="md">
                <CardHeader title="Visual Analytics Preview" subtitle={`Primary Metric: ${metrics[0]?.toUpperCase()}`} />
                <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 14, minHeight: 120 }}>
                  {renderPreviewChart(preview.chartData)}
                </div>
              </Card>
            )}

            {/* Table preview */}
            <Card padding="none">
              <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <CardHeader title={name} subtitle={`Custom dynamic table view · sorting by ${sortKey}`} style={{ marginBottom: 0 }} />
              </div>
              <div style={{ borderTop: '1px solid var(--color-border)' }}>
                {DataTable && (
                  <DataTable columns={preview.columns} rows={preview.rows} style={{ border: 'none', borderRadius: 0 }} />
                )}
              </div>
            </Card>
          </>
        )}
      </div>

    </div>
  );
}
