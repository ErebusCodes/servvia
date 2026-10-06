// @ts-nocheck
/* Kitchen Operations — KDS monitoring, station load & throughput. */
function KitchenScreen() {
  const { StatCard, Card, CardHeader, ProgressBar, Badge, Button, StatusBadge } = window.DesignSystem_7f3fe8;
  const I = window.Icon;
  const D = window.VData;

  const tickets = [
    { id: 'ORD-4821', table: 'T12', station: 'Grill', items: ['2× Ribeye', '1× Branzino', '2× Frites'], elapsed: '2:10', state: 'preparing' },
    { id: 'ORD-4818', table: 'T18', station: 'Grill', items: ['3× Burger', '1× Salmon', '4× Wings'], elapsed: '9:42', state: 'preparing' },
    { id: 'ORD-4819', table: 'TableStation', code: 'kiosk-table', station: 'Sauté', items: ['1× Risotto', '2× Pasta'], elapsed: '6:05', state: 'preparing' },
    { id: 'ORD-4817', table: 'Online', station: 'Cold', items: ['2× Caesar', '1× Burrata'], elapsed: '11:20', state: 'ready' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <StatCard label="Tickets in Queue" value="11" delta="+3" trend="up" positiveIsGood={false} icon={<I.utensils />} hint="Across 4 stations" />
        <StatCard label="Avg Prep Time" value="14:32" delta="+1:10" trend="up" positiveIsGood={false} icon={<I.clock />} hint="Target 12:00" />
        <StatCard label="Throughput · hr" value="38" delta="+5" trend="up" icon={<I.trend />} hint="Tickets completed" />
        <StatCard label="On-Time Rate" value="91%" delta="−4%" trend="down" positiveIsGood={false} icon={<I.check />} hint="Below 95% target" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 16, alignItems: 'start' }}>
        <Card>
          <CardHeader title="Station load" subtitle="Active tickets & average time"
            action={<StatusBadge status="healthy" label="4 online" />} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {D.kitchenStations.map((s) => (
              <div key={s.name}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: 'var(--color-text-tertiary)' }}><I.flame size={16} /></span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{s.name}</span>
                    <Badge tone={s.load > 75 ? 'warning' : 'neutral'} size="sm">{s.active} active</Badge>
                  </div>
                  <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{s.avg}</span>
                </div>
                <ProgressBar value={s.load} tone={s.load > 75 ? 'warning' : 'primary'} />
              </div>
            ))}
          </div>
        </Card>

        <Card padding="none">
          <div style={{ padding: '18px 20px 14px' }}>
            <CardHeader title="Active tickets" subtitle="Live kitchen display feed"
              action={<Button variant="ghost" size="sm" iconRight={<I.arrowRight size={15} />}>Full KDS</Button>} />
          </div>
          <div>
            {tickets.map((t) => (
              <div key={t.id} style={{ display: 'flex', gap: 14, padding: '14px 20px', borderTop: '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 70, flexShrink: 0 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>{t.table}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: parseInt(t.elapsed) > 8 ? 'var(--color-danger)' : 'var(--color-warning)' }}><I.clock size={12} />{t.elapsed}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-secondary)' }}>{t.id}</span>
                    <Badge tone="neutral" size="sm">{t.station}</Badge>
                    <StatusBadge status={t.state} size="sm" />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }}>
                    {t.items.map((it, i) => <span key={i} style={{ fontSize: 13, color: 'var(--color-text)' }}>{it}</span>)}
                  </div>
                </div>
                <Button variant="secondary" size="sm" style={{ alignSelf: 'center' }}>Bump</Button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
window.KitchenScreen = KitchenScreen;
