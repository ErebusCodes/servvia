import React, { useState } from 'react';
import { InsightAlert } from './types';

interface InsightsPanelProps {
  tab: string;
  onResolveAction: (targetTab: string, filtersToApply: any) => void;
  onDrillDown: (type: string, name: string) => void;
}

export function InsightsPanel({ tab, onResolveAction, onDrillDown }: InsightsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Destructure components from design system
  const DS = (window as any).DesignSystem_7f3fe8 || {};
  const { Badge, Card, CardHeader } = DS;

  const insightsList: InsightAlert[] = [
    // --- SALES ---
    {
      id: 'sales-1',
      title: 'Revenue increased 9.4%',
      description: 'Total revenue grew compared to the previous week, driven by Mains and Grill items.',
      priority: 'high',
      severity: 'success',
      trend: 'up',
      recommendation: 'Optimize pricing modifiers for Grill platters during dinner hours.',
      category: 'sales',
      timestamp: 'Today, 20:00'
    },
    {
      id: 'sales-2',
      title: 'Friday dinner sales up 18%',
      description: 'Friday evening surge generated record dine-in covers and high ticket averages.',
      priority: 'high',
      severity: 'success',
      trend: 'up',
      recommendation: 'Ensure full kitchen coverage on Friday dinner shifts.',
      category: 'sales',
      timestamp: 'Yesterday'
    },
    {
      id: 'sales-3',
      title: 'Average order value monthly high',
      description: 'Average ticket reached $59.66, driven by higher dessert attach rates.',
      priority: 'low',
      severity: 'info',
      trend: 'up',
      recommendation: 'Promote drink & dessert combo specials to maintain peak averages.',
      category: 'sales',
      timestamp: 'This Week'
    },

    // --- KITCHEN PERFORMANCE ---
    {
      id: 'kitchen-1',
      title: 'Kitchen SLA below target',
      description: 'Pizza & Oven station SLA compliance fell to 84% during evening peak shifts.',
      priority: 'high',
      severity: 'error',
      trend: 'down',
      recommendation: 'Schedule 1 additional staff chef on the Pizza line between 18:00 - 21:00.',
      category: 'kitchen',
      timestamp: 'Today, 19:30'
    },
    {
      id: 'kitchen-2',
      title: 'Station delay detected (Grill)',
      description: 'Average prep time on Grill station reached 16.4 mins (target is 12 mins).',
      priority: 'medium',
      severity: 'warning',
      trend: 'up',
      recommendation: 'Verify grill temperature calibrations and prep layout efficiency.',
      category: 'kitchen',
      timestamp: 'Today, 18:45'
    },
    {
      id: 'kitchen-3',
      title: 'Prep time increases in Mains',
      description: 'Mains preparation time increased by 2.4 minutes on average during afternoon shifts.',
      priority: 'low',
      severity: 'info',
      trend: 'up',
      recommendation: 'Check pre-shift prep levels for lamb shawarma side dishes.',
      category: 'kitchen',
      timestamp: 'Today, 15:00'
    },

    // --- OPERATIONS ---
    {
      id: 'ops-1',
      title: 'Order completion trends up',
      description: '98.2% of orders were successfully fulfilled and marked served on time.',
      priority: 'high',
      severity: 'success',
      trend: 'up',
      recommendation: 'Maintain current station allocations and shift staffing levels.',
      category: 'operations',
      timestamp: 'Today, 20:00'
    },
    {
      id: 'ops-2',
      title: 'Peak hour volume shifts earlier',
      description: 'Dine-in arrival rates peaked at 18:45 instead of the typical 19:30 dinner start.',
      priority: 'medium',
      severity: 'info',
      trend: 'flat',
      recommendation: 'Stagger floor staff breaks to end before 18:30.',
      category: 'operations',
      timestamp: 'Yesterday'
    },
    {
      id: 'ops-3',
      title: 'Queue time exceeds target',
      description: 'Hostess seating queues exceeded the 8-minute maximum threshold during peak.',
      priority: 'high',
      severity: 'warning',
      trend: 'up',
      recommendation: 'Implement table status syncing on POS to speed up table clears.',
      category: 'operations',
      timestamp: 'Today, 19:15'
    },

    // --- INVENTORY ---
    {
      id: 'inv-1',
      title: 'Halloumi stock reorder threshold',
      description: 'On-hand Halloumi stock is currently 6 kg, significantly below the par level of 20 kg.',
      priority: 'high',
      severity: 'warning',
      trend: 'down',
      recommendation: 'Reorder 24 kg immediately from Aegean Dairy Co.',
      category: 'inventory',
      timestamp: 'Today, 18:00'
    },
    {
      id: 'inv-2',
      title: 'Waste increases in Pizza dough',
      description: 'Pizza dough discard rate grew to 8.4% due to over-proofing in afternoon heat.',
      priority: 'medium',
      severity: 'warning',
      trend: 'up',
      recommendation: 'Store proofing batches inside the walk-in refrigerator section B.',
      category: 'inventory',
      timestamp: 'Today, 16:30'
    },
    {
      id: 'inv-3',
      title: 'Stock variance detected in Meat',
      description: 'Physical count of Lamb Shish revealed a 2.8 kg discrepancy vs. POS sales log.',
      priority: 'high',
      severity: 'error',
      trend: 'down',
      recommendation: 'Audit kitchen portion weight sheets and checkout registers.',
      category: 'inventory',
      timestamp: 'Yesterday'
    },

    // --- STAFF ---
    {
      id: 'staff-1',
      title: 'Best performer Maya Othman',
      description: 'Maya completed 142 orders with 0 delayed tasks and an average rating of 4.9.',
      priority: 'medium',
      severity: 'success',
      trend: 'up',
      recommendation: 'Acknowledge performance in daily team standup and share service tips.',
      category: 'staff',
      timestamp: 'Today, 21:00'
    },
    {
      id: 'staff-2',
      title: 'Labour efficiency reached 96%',
      description: 'Productivity metrics aligned perfectly with customer checkouts across shifts.',
      priority: 'low',
      severity: 'success',
      trend: 'up',
      recommendation: 'Continue using automatic shift scheduling models based on sales forecasts.',
      category: 'staff',
      timestamp: 'This Week'
    },
    {
      id: 'staff-3',
      title: 'Shift coverage below 90%',
      description: 'Friday dinner shift has 2 unfilled server roles due to scheduled leaves.',
      priority: 'high',
      severity: 'warning',
      trend: 'down',
      recommendation: 'Send shift pick-up requests to part-time roster via messaging app.',
      category: 'staff',
      timestamp: 'In 2 Days'
    },

    // --- PAYMENTS ---
    {
      id: 'pay-1',
      title: 'Refund spikes detected',
      description: 'Refund count grew by 2.6% of gross payments, mostly Card reversals.',
      priority: 'medium',
      severity: 'warning',
      trend: 'up',
      recommendation: 'Verify staff checkout logs for card payment voids.',
      category: 'payments',
      timestamp: 'Today, 15:45'
    },
    {
      id: 'pay-2',
      title: 'Failed transactions rate 1.4%',
      description: 'Card decline count grew slightly due to temporary bank routing drops.',
      priority: 'low',
      severity: 'info',
      trend: 'up',
      recommendation: 'Verify standby backup terminal cellular network connection.',
      category: 'payments',
      timestamp: 'Today, 14:30'
    },
    {
      id: 'pay-3',
      title: 'Settlement status is normal',
      description: 'All gross payments have settled successfully with Aegean Merchant Bank.',
      priority: 'high',
      severity: 'success',
      trend: 'flat',
      recommendation: 'No action required. Next payout expected on schedule tomorrow.',
      category: 'payments',
      timestamp: 'Today, 10:00'
    }
  ];

  // Filter insights strictly matching active report tab view
  const activeInsights = insightsList.filter(ins => {
    if (tab === 'builder') return false; // Hide insights for custom builder view
    return ins.category === tab;
  });

  const getSeverityTone = (sev: string) => {
    if (sev === 'error') return 'danger';
    if (sev === 'warning') return 'warning';
    if (sev === 'success') return 'success';
    return 'info';
  };

  const getInsightIcon = (ins: InsightAlert) => {
    if (ins.severity === 'success') return <span style={{ color: 'var(--color-success)', marginRight: 6, fontWeight: 700 }}>▲</span>;
    if (ins.severity === 'error') return <span style={{ color: 'var(--color-danger)', marginRight: 6, fontWeight: 700 }}>⚠</span>;
    if (ins.severity === 'warning') return <span style={{ color: 'var(--color-warning)', marginRight: 6, fontWeight: 700 }}>⚠</span>;
    return <span style={{ color: 'var(--color-info)', marginRight: 6, fontWeight: 700 }}>💡</span>;
  };

  const handleApplyFilter = (ins: InsightAlert) => {
    if (ins.category === 'inventory') {
      onResolveAction('inventory', { menuItem: 'halloumi' });
    } else if (ins.category === 'kitchen') {
      onResolveAction('kitchen', { kitchenStation: 'pizza' });
    } else if (ins.category === 'sales') {
      onResolveAction('sales', { category: 'mains' });
    } else {
      onResolveAction(ins.category, {});
    }
  };

  return (
    <Card padding="none" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)', transition: 'max-height 0.25s ease-in-out', overflow: 'hidden' }}>
      
      {/* Header with expand/collapse toggle */}
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
          borderBottom: collapsed ? 'none' : '1px solid var(--color-border)'
        }}
      >
        <CardHeader
          title="Live Insights & Alerts"
          subtitle="Intelligent performance diagnostics"
          style={{ marginBottom: 0 }}
        />
        <button
          style={{
            border: 'none',
            background: 'none',
            color: 'var(--color-text-secondary)',
            fontSize: 12,
            cursor: 'pointer',
            fontWeight: 600
          }}
        >
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>

      {/* Body List */}
      {!collapsed && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: 16,
          maxHeight: 460,
          overflowY: 'auto',
          background: 'var(--color-surface)'
        }}>
          {activeInsights.length === 0 ? (
            <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 13 }}>
              No active alerts or recommendations for this tab view.
            </div>
          ) : (
            activeInsights.map((ins) => (
              <div
                key={ins.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: 12,
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border-strong)',
                  background: 'var(--color-surface-2)',
                  position: 'relative'
                }}
              >
                {/* Title row with icon */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
                    {getInsightIcon(ins)}
                    {ins.title}
                  </div>
                  <Badge tone={getSeverityTone(ins.severity)} size="sm">
                    {ins.priority.toUpperCase()}
                  </Badge>
                </div>

                {/* Description */}
                <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.4, margin: '2px 0 0' }}>
                  {ins.description}
                </p>

                {/* Recommendations */}
                <div style={{
                  background: 'var(--color-surface)',
                  padding: 8,
                  borderRadius: 'var(--radius-sm)',
                  borderLeft: '3px solid var(--color-primary)',
                  fontSize: 11,
                  color: 'var(--color-text-secondary)',
                  lineHeight: 1.4
                }}>
                  {ins.recommendation}
                </div>

                {/* Action trigger links */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 12,
                  fontSize: 11,
                  fontWeight: 600,
                  marginTop: 4,
                  borderTop: '1px solid var(--color-border)',
                  paddingTop: 8
                }}>
                  <span
                    onClick={() => onDrillDown(ins.category === 'kitchen' ? 'station' : 'item', ins.category === 'kitchen' ? 'Pizza & Oven' : 'Halloumi')}
                    style={{ color: 'var(--color-primary-text)', cursor: 'pointer' }}
                  >
                    View Details
                  </span>
                  <span
                    onClick={() => handleApplyFilter(ins)}
                    style={{ color: 'var(--color-primary-text)', cursor: 'pointer' }}
                  >
                    Apply Filter
                  </span>
                  <span
                    onClick={() => onResolveAction(ins.category, {})}
                    style={{ color: 'var(--color-text-tertiary)', cursor: 'pointer' }}
                  >
                    Open Report
                  </span>
                </div>

              </div>
            ))
          )}
        </div>
      )}
    </Card>
  );
}
