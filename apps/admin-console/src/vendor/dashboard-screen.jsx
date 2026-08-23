// @ts-nocheck
/* Dashboard — operational control center overview. */
function DashboardScreen() {
  const { StatCard, Card, CardHeader, StatusBadge, ProgressBar, Button, Avatar } = window.DesignSystem_7f3fe8;
  const I = window.Icon;
  const D = window.VData;

  const actTone = { primary: 'var(--color-primary)', success: 'var(--color-success)', warning: 'var(--color-warning)', danger: 'var(--color-danger)', info: 'var(--color-info)', neutral: 'var(--color-text-secondary)' };
  const actBg = { primary: 'var(--color-primary-subtle)', success: 'var(--color-success-bg)', warning: 'var(--color-warning-bg)', danger: 'var(--color-danger-bg)', info: 'var(--color-info-bg)', neutral: 'var(--color-surface-3)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <StatCard label="Today's Revenue" value="$18,240" delta="+12.4%" trend="up" icon={<I.dollar />} hint="vs. $16,220 yesterday" />
        <StatCard label="Active Reservations" value="84" delta="+6" trend="up" icon={<I.calendar />} hint="24 still upcoming tonight" />
        <StatCard label="Open Orders" value="11" delta="3 ready" trend="flat" icon={<I.orders />} hint="Avg ticket $128.40" />
        <StatCard label="Avg Prep Time" value="14:32" delta="+1:10" trend="up" positiveIsGood={false} icon={<I.clock />} hint="Kitchen queue running warm" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* Kitchen queue + reservations strip */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card padding="none">
            <div style={{ padding: '18px 20px 4px' }}>
              <CardHeader title="Kitchen queue status" subtitle="Live station load across the line"
                action={<Button variant="ghost" size="sm" iconRight={<I.arrowRight size={15} />}>Open KDS</Button>} />
            </div>
            <div style={{ padding: '4px 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {D.kitchenStations.map((s) => (
                <div key={s.name} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 64px', gap: 14, alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: 'var(--color-text-tertiary)' }}><I.flame size={16} /></span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{s.name}</span>
                  </div>
                  <ProgressBar value={s.load} tone={s.load > 75 ? 'warning' : 'primary'} />
                  <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{s.active} · {s.avg}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card padding="none">
            <div style={{ padding: '18px 20px 14px' }}>
              <CardHeader title="Upcoming reservations" subtitle="Next seatings tonight"
                action={<Button variant="ghost" size="sm" iconRight={<I.arrowRight size={15} />}>View all</Button>} />
            </div>
            <div>
              {D.reservations.filter(r => ['confirmed','pending','seated'].includes(r.status)).slice(0, 4).map((r, i) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderTop: '1px solid var(--color-border)' }}>
                  <Avatar name={r.guest} size="sm" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{r.guest}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Party of {r.party} · Table {r.table}</div>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{r.time}</span>
                  <StatusBadge status={r.status} />
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Right column: system status + activity */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card padding="none">
            <div style={{ padding: '18px 20px 14px' }}>
              <CardHeader title="System status" subtitle="Integrations & devices" />
            </div>
            <div>
              {D.systems.map((s) => (
                <div key={s.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 20px', borderTop: '1px solid var(--color-border)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{s.detail}</div>
                  </div>
                  <StatusBadge status={s.status} />
                </div>
              ))}
            </div>
          </Card>

          <Card padding="none">
            <div style={{ padding: '18px 20px 14px' }}>
              <CardHeader title="Recent activity" />
            </div>
            <div style={{ padding: '0 20px 8px' }}>
              {D.activity.map((a, i) => {
                const Glyph = I[a.icon] || I.check;
                return (
                  <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--color-border)' }}>
                    <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 'var(--radius-md)', background: actBg[a.tone], color: actTone[a.tone], display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Glyph size={15} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--color-text)', lineHeight: 1.4 }}><strong style={{ fontWeight: 600 }}>{a.who}</strong> {a.what}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 1 }}>{a.when}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
window.DashboardScreen = DashboardScreen;
