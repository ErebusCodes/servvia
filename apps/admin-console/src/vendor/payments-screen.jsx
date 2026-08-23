// @ts-nocheck
/* Payments — revenue analytics + transactions ledger. */
function PaymentsScreen() {
  const { StatCard, Card, CardHeader, DataTable, Pagination, StatusBadge, Badge, Button, Input, Select } = window.DesignSystem_7f3fe8;
  const I = window.Icon;
  const D = window.VData;
  const [sort, setSort] = React.useState({ key: 'time', dir: 'desc' });

  const trend = [
    { d: 'Mon', v: 12.4 }, { d: 'Tue', v: 14.1 }, { d: 'Wed', v: 11.8 },
    { d: 'Thu', v: 16.2 }, { d: 'Fri', v: 22.6 }, { d: 'Sat', v: 24.9 }, { d: 'Sun', v: 18.2 },
  ];
  const maxV = Math.max(...trend.map(t => t.v));

  const typeTone = { Sale: 'neutral', Deposit: 'info', Refund: 'warning' };
  const columns = [
    { key: 'id', header: 'Transaction', width: 130, render: (r) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-secondary)' }}>{r.id}</span> },
    { key: 'guest', header: 'Guest', sortable: true, render: (r) => <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{r.guest}</span> },
    { key: 'method', header: 'Method', render: (r) => <span style={{ color: 'var(--color-text-secondary)' }}>{r.method}</span> },
    { key: 'type', header: 'Type', width: 100, render: (r) => <Badge tone={typeTone[r.type]} size="sm">{r.type}</Badge> },
    { key: 'amount', header: 'Amount', width: 120, align: 'right', numeric: true, sortable: true, render: (r) => (
      <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: r.type === 'Refund' ? 'var(--color-danger)' : 'var(--color-text)' }}>{r.type === 'Refund' ? '−' : ''}${r.amount.toFixed(2)}</span>) },
    { key: 'time', header: 'Time', width: 92, align: 'right', numeric: true, sortable: true, render: (r) => <span style={{ color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{r.time}</span> },
    { key: 'status', header: 'Status', width: 120, render: (r) => <StatusBadge status={r.status === 'completed' ? 'healthy' : 'failed'} label={r.status === 'completed' ? 'Completed' : 'Failed'} /> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <StatCard label="Revenue · 7 days" value="$120,240" delta="+8.2%" trend="up" icon={<I.dollar />} hint="Net of refunds" />
        <StatCard label="Transactions" value="1,284" delta="+142" trend="up" icon={<I.receipt />} hint="Avg $93.64" />
        <StatCard label="Refunds" value="$1,840" delta="14 issued" trend="flat" positiveIsGood={false} icon={<I.sync />} hint="1.5% of revenue" />
        <StatCard label="Deposits Held" value="$3,420" delta="38 active" trend="up" icon={<I.check />} hint="Across upcoming events" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, alignItems: 'start' }}>
        <Card>
          <CardHeader title="Revenue trend" subtitle="Daily net revenue · this week"
            action={<Select fullWidth={false} options={['This week', 'Last week', '30 days']} containerStyle={{ width: 120 }} size="sm" />} />
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 180, padding: '8px 0 0' }}>
            {trend.map((t) => (
              <div key={t.d} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, height: '100%', justifyContent: 'flex-end' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>${t.v}k</span>
                <div style={{ width: '100%', maxWidth: 38, height: `${(t.v / maxV) * 100}%`, background: t.v === maxV ? 'var(--color-primary)' : 'var(--color-primary-subtle)', borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0', border: t.v === maxV ? 'none' : '1px solid var(--color-success-border)', borderBottom: 'none', transition: 'height var(--duration-slow) var(--ease-out)' }} />
                <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{t.d}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card padding="none">
          <div style={{ padding: '18px 20px 14px' }}>
            <CardHeader title="Payment methods" subtitle="Share of volume" />
          </div>
          <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[{ m: 'Credit / Debit', p: 68, c: 'var(--color-primary)' }, { m: 'Apple / Google Pay', p: 18, c: 'var(--color-info)' }, { m: 'Cash', p: 9, c: 'var(--color-warning)' }, { m: 'Gift card', p: 5, c: 'var(--color-accent)' }].map((x) => (
              <div key={x.m} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--color-text)' }}>{x.m}</span>
                  <span style={{ fontWeight: 600, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{x.p}%</span>
                </div>
                <div style={{ height: 6, background: 'var(--color-surface-3)', borderRadius: 'var(--radius-full)' }}>
                  <div style={{ width: `${x.p}%`, height: '100%', background: x.c, borderRadius: 'var(--radius-full)' }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card padding="none">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 20px' }}>
          <CardHeader title="Transactions" subtitle="Most recent first" style={{ marginBottom: 0 }} />
          <div style={{ display: 'flex', gap: 10 }}>
            <Input fullWidth={false} placeholder="Search…" leftIcon={<I.search size={15} />} containerStyle={{ width: 200 }} size="sm" />
            <Button variant="secondary" size="sm" iconLeft={<I.download size={15} />}>Export</Button>
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--color-border)' }}>
          <DataTable columns={columns} rows={[...D.transactions].sort((a,b)=> sort.dir==='asc'? (a[sort.key]>b[sort.key]?1:-1) : (a[sort.key]<b[sort.key]?1:-1))} sort={sort} onSortChange={setSort} style={{ border: 'none', borderRadius: 0 }} />
        </div>
        <div style={{ padding: '4px 16px' }}>
          <Pagination page={1} pageSize={10} total={1284} onPageChange={() => {}} />
        </div>
      </Card>
    </div>
  );
}
window.PaymentsScreen = PaymentsScreen;
