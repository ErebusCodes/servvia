import React, { useState } from 'react';
import { FilterState, SavedReportView, ComparisonState } from './types';

interface AdvancedFiltersProps {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  comparison: ComparisonState;
  onComparisonChange: (c: ComparisonState) => void;
  savedViews: SavedReportView[];
  activeViewId: string;
  onSelectView: (view: SavedReportView) => void;
  onSaveView: (name: string) => void;
  onDeleteView: (id: string) => void;
}

export function AdvancedFiltersPanel({
  filters,
  onChange,
  comparison,
  onComparisonChange,
  savedViews,
  activeViewId,
  onSelectView,
  onSaveView,
  onDeleteView,
}: AdvancedFiltersProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [newViewName, setNewViewName] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);

  // Destructure components from design system
  const DS = (window as any).DesignSystem_7f3fe8 || {};
  const { Button, Input } = DS;

  const updateFilter = (key: keyof FilterState, val: string) => {
    onChange({ ...filters, [key]: val });
  };

  const clearAllFilters = () => {
    onChange({
      dateRange: 'last7',
      venue: 'all',
      service: 'all',
      orderType: 'all',
      shift: 'all',
      kitchenStation: 'all',
      staff: 'all',
      category: 'all',
      menuItem: 'all',
      paymentMethod: 'all',
      customerType: 'all',
      discount: 'all',
      promotion: 'all',
      supplier: 'all',
      reservationSource: 'all',
      posTerminal: 'all',
      device: 'all',
      orderStatus: 'all',
      table: 'all',
      channel: 'all',
      deliveryPartner: 'all',
      taxClass: 'all',
      searchQuery: '',
    });
    onComparisonChange({ enabled: false, type: 'prev_period' });
  };

  // Check if any advanced filter is active
  const isFilterActive = (key: keyof FilterState) => {
    if (key === 'dateRange' || key === 'venue' || key === 'service' || key === 'orderType') return false;
    return filters[key] !== 'all' && filters[key] !== '';
  };

  const activeAdvancedKeys = (Object.keys(filters) as Array<keyof FilterState>).filter(isFilterActive);

  // Selector component matching design system select styling
  const select = (label: string, val: string, onChangeFn: (v: string) => void, opts: { v: string; l: string }[]) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 180px', minWidth: 150 }}>
      <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-tertiary)' }}>
        {label}
      </span>
      <select
        value={val}
        onChange={(e) => onChangeFn(e.target.value)}
        style={{
          appearance: 'none',
          WebkitAppearance: 'none',
          height: 36,
          padding: '0 30px 0 12px',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border-strong)',
          borderRadius: 'var(--radius-sm)',
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          color: 'var(--color-text)',
          cursor: 'pointer',
          outline: 'none',
          backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M6 9l6 6 6-6'/></svg>\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 8px center'
        }}
      >
        {opts.map((o) => (
          <option key={o.v} value={o.v}>{o.l}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xs)', padding: '14px 18px' }}>
      
      {/* Upper Saved Views Preset Row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: 10, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Saved Views:</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {savedViews.map((view) => (
              <button
                key={view.id}
                onClick={() => onSelectView(view)}
                style={{
                  height: 28,
                  padding: '0 10px',
                  borderRadius: 'var(--radius-full)',
                  border: view.id === activeViewId ? '1px solid var(--color-primary-border)' : '1px solid var(--color-border-strong)',
                  background: view.id === activeViewId ? 'var(--color-primary-subtle)' : 'var(--color-surface-2)',
                  color: view.id === activeViewId ? 'var(--color-primary-text)' : 'var(--color-text-secondary)',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4
                }}
              >
                {view.name}
                {!view.isDefault && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteView(view.id);
                    }}
                    style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginLeft: 6, cursor: 'pointer' }}
                  >
                    ×
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
        <div>
          {Button && (
            <Button variant="secondary" size="sm" onClick={() => setShowSaveModal(true)}>
              + Save Current View
            </Button>
          )}
        </div>
      </div>

      {/* Main Standard Filter Inputs Row */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
        {select('Date range', filters.dateRange, (v) => updateFilter('dateRange', v), [
          { v: 'today', l: 'Today' },
          { v: 'yesterday', l: 'Yesterday' },
          { v: 'last7', l: 'Last 7 Days' },
          { v: 'last30', l: 'Last 30 Days' },
          { v: 'thisWeek', l: 'This Week' },
          { v: 'lastWeek', l: 'Last Week' },
          { v: 'thisMonth', l: 'This Month' },
          { v: 'lastMonth', l: 'Last Month' },
          { v: 'custom', l: 'Custom Range' },
        ])}

        {select('Venue', filters.venue, (v) => updateFilter('venue', v), [
          { v: 'all', l: 'All Venues' },
          { v: 'verdura', l: 'Verdura — Downtown' },
          { v: 'v2', l: 'Verdura — Marina' },
          { v: 'v3', l: 'Verdura — Airport' },
        ])}

        {select('Service type', filters.service, (v) => {
          onChange({ ...filters, service: v, orderType: 'all' });
        }, [
          { v: 'all', l: 'All Services' },
          { v: 'dinein', l: 'Dine-in' },
          { v: 'takeaway', l: 'Take Away' },
        ])}

        {select('Order type', filters.orderType, (v) => updateFilter('orderType', v), [
          { v: 'all', l: 'All Types' },
          { v: 'delivery', l: 'Delivery' },
          { v: 'pickup', l: 'Pickup' },
        ])}

        {/* Date Comparison settings */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 180px', minWidth: 150 }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-tertiary)' }}>
            Compare Against
          </span>
          <select
            value={comparison.enabled ? comparison.type : 'none'}
            onChange={(e) => {
              const val = e.target.value;
              if (val === 'none') {
                onComparisonChange({ ...comparison, enabled: false });
              } else {
                onComparisonChange({ enabled: true, type: val as any });
              }
            }}
            style={{
              appearance: 'none',
              WebkitAppearance: 'none',
              height: 36,
              padding: '0 30px 0 12px',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border-strong)',
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              color: 'var(--color-text)',
              cursor: 'pointer',
              outline: 'none',
              backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M6 9l6 6 6-6'/></svg>\")",
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 8px center'
            }}
          >
            <option value="none">No Comparison</option>
            <option value="prev_period">Previous Period</option>
            <option value="prev_year">Previous Year</option>
            <option value="another_venue">Another Venue</option>
            <option value="another_service">Another Service</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: 8, height: 36, alignItems: 'center' }}>
          {Button && (
            <>
              <Button variant="secondary" size="md" onClick={() => setCollapsed(!collapsed)}>
                {collapsed ? '▼ More Filters' : '▲ Less Filters'}
              </Button>
              {(activeAdvancedKeys.length > 0 || filters.searchQuery || comparison.enabled) && (
                <Button variant="secondary" size="md" onClick={clearAllFilters} style={{ color: 'var(--color-danger)' }}>
                  Clear Filters
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Advanced Filters Expandable Grid */}
      {!collapsed && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 14,
          paddingTop: 16,
          borderTop: '1px dashed var(--color-border)',
        }}>
          {Input && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, gridColumn: 'span 2' }}>
              <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-tertiary)' }}>
                Search Query
              </span>
              <Input
                value={filters.searchQuery}
                onChange={(v: string) => updateFilter('searchQuery', v)}
                placeholder="Search menu items, employees, trans..."
                style={{ height: 36 }}
              />
            </div>
          )}

          {select('Shift', filters.shift, (v) => updateFilter('shift', v), [
            { v: 'all', l: 'All Shifts' },
            { v: 'morning', l: 'Morning Shift' },
            { v: 'afternoon', l: 'Afternoon Shift' },
            { v: 'evening', l: 'Evening Shift' },
            { v: 'night', l: 'Night Shift' },
          ])}

          {select('Kitchen Station', filters.kitchenStation, (v) => updateFilter('kitchenStation', v), [
            { v: 'all', l: 'All Stations' },
            { v: 'main', l: 'Main Kitchen' },
            { v: 'grill', l: 'Grill Station' },
            { v: 'fry', l: 'Fry Station' },
            { v: 'cold', l: 'Cold & Salad' },
            { v: 'pizza', l: 'Pizza & Oven' },
            { v: 'dessert', l: 'Dessert Station' },
          ])}

          {select('Employee', filters.staff, (v) => updateFilter('staff', v), [
            { v: 'all', l: 'All Staff' },
            { v: 'maya', l: 'Maya Othman' },
            { v: 'diego', l: 'Diego Santos' },
            { v: 'aisha', l: 'Aisha Karim' },
            { v: 'liam', l: 'Liam Walsh' },
            { v: 'nora', l: 'Nora Haddad' },
          ])}

          {select('Category', filters.category, (v) => updateFilter('category', v), [
            { v: 'all', l: 'All Categories' },
            { v: 'mains', l: 'Mains' },
            { v: 'pizza', l: 'Pizza & Oven' },
            { v: 'starters', l: 'Starters' },
            { v: 'beverages', l: 'Beverages' },
            { v: 'desserts', l: 'Desserts' },
            { v: 'sides', l: 'Sides' },
          ])}

          {select('Menu Item', filters.menuItem, (v) => updateFilter('menuItem', v), [
            { v: 'all', l: 'All Items' },
            { v: 'halloumi', l: 'Grilled Halloumi' },
            { v: 'shawarma', l: 'Lamb Shawarma' },
            { v: 'grill', l: 'Mixed Grill Platter' },
            { v: 'pizza', l: 'Margherita Pizza' },
            { v: 'hummus', l: 'Hummus Bowl' },
          ])}

          {select('Payment Method', filters.paymentMethod, (v) => updateFilter('paymentMethod', v), [
            { v: 'all', l: 'All Methods' },
            { v: 'card', l: 'Card' },
            { v: 'online', l: 'Online' },
            { v: 'cash', l: 'Cash' },
            { v: 'paywave', l: 'PayWave' },
            { v: 'delivery_platform', l: 'Delivery Platform' },
          ])}

          {select('POS Terminal', filters.posTerminal, (v) => updateFilter('posTerminal', v), [
            { v: 'all', l: 'All Terminals' },
            { v: 'term_a', l: 'Terminal A' },
            { v: 'term_b', l: 'Terminal B' },
            { v: 'term_m', l: 'Mobile POS' },
          ])}

          {select('Order Status', filters.orderStatus, (v) => updateFilter('orderStatus', v), [
            { v: 'all', l: 'All Statuses' },
            { v: 'completed', l: 'Completed' },
            { v: 'preparing', l: 'Preparing' },
            { v: 'cancelled', l: 'Cancelled' },
            { v: 'ready', l: 'Ready' },
            { v: 'new', l: 'New' },
          ])}
        </div>
      )}

      {/* Render Chips for Active Filters */}
      {activeAdvancedKeys.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: '1px solid var(--color-border)', paddingTop: 10 }}>
          {activeAdvancedKeys.map((key) => (
            <span
              key={key}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: 'var(--color-surface-3)',
                color: 'var(--color-text-secondary)',
                fontSize: 11,
                fontWeight: 600,
                padding: '3px 8px',
                borderRadius: 'var(--radius-sm)',
                textTransform: 'uppercase',
              }}
            >
              {key.replace(/([A-Z])/g, ' $1')}: {filters[key]}
              <button
                onClick={() => updateFilter(key, 'all')}
                style={{
                  border: 'none',
                  background: 'none',
                  color: 'var(--color-text-tertiary)',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  padding: '0 2px'
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Custom Saved View Save Modal */}
      {showSaveModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.4)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-sans)',
        }}>
          <div style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-lg)',
            width: '100%',
            maxWidth: 400,
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 16
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)' }}>Save Report View</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)' }}>View Name</span>
              <input
                type="text"
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
                placeholder="e.g. Weekend Sales Dinner"
                style={{
                  height: 36,
                  padding: '0 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border-strong)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-text)',
                  fontSize: 13,
                  outline: 'none'
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              {Button && (
                <>
                  <Button variant="secondary" size="md" onClick={() => { setShowSaveModal(false); setNewViewName(''); }}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="md" onClick={() => {
                    if (newViewName.trim()) {
                      onSaveView(newViewName.trim());
                      setNewViewName('');
                      setShowSaveModal(false);
                    }
                  }}>
                    Save Preset
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
