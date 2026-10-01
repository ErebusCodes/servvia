// @ts-nocheck
/* Reservations — list view with search, filters, selection & pagination. */
function ReservationsScreen() {
  const { DataTable, Pagination, StatusBadge, Avatar, Button, Input, Select, Tag, Tabs, Badge } = window.DesignSystem_7f3fe8;
  const I = window.Icon;
  const D = window.VData;
  const [tab, setTab] = React.useState('list');
  const [sel, setSel] = React.useState([]);
  const [sort, setSort] = React.useState({ key: 'time', dir: 'asc' });
  const [q, setQ] = React.useState('');

  let rows = D.reservations.filter(r => r.guest.toLowerCase().includes(q.toLowerCase()) || r.id.toLowerCase().includes(q.toLowerCase()));
  rows = [...rows].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    return (a[sort.key] > b[sort.key] ? 1 : -1) * dir;
  });

  const columns = [
    { key: 'id', header: 'Ref', width: 92, sortable: true, render: (r) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-secondary)' }}>{r.id}</span> },
    { key: 'guest', header: 'Guest', sortable: true, render: (r) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar name={r.guest} size="sm" />
        <div>
          <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>{r.guest}</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{r.phone}</div>
        </div>
        {r.tag && <Tag color={r.tag === 'VIP' ? 'primary' : 'neutral'} style={{ marginLeft: 2 }}>{r.tag}</Tag>}
      </div>) },
    { key: 'time', header: 'Time', width: 92, sortable: true, numeric: true, render: (r) => <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{r.time}</span> },
    { key: 'party', header: 'Party', width: 80, align: 'right', numeric: true, sortable: true },
    { key: 'table', header: 'Table', width: 80, align: 'center', render: (r) => r.table === '—' ? <span style={{ color: 'var(--color-text-tertiary)' }}>—</span> : <span style={{ fontWeight: 600 }}>{r.table}</span> },
    { key: 'status', header: 'Status', width: 130, render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Tabs tabs={[{ key: 'calendar', label: 'Calendar' }, { key: 'timeline', label: 'Timeline' }, { key: 'list', label: 'List', badge: '428' }]} active={tab} onChange={setTab} />

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Input fullWidth={false} placeholder="Search guest or ref…" value={q} onChange={(e) => setQ(e.target.value)} leftIcon={<I.search size={15} />} containerStyle={{ width: 260 }} />
        <Select fullWidth={false} options={['All statuses', 'Pending', 'Confirmed', 'Seated', 'Completed']} containerStyle={{ width: 150 }} />
        <Select fullWidth={false} options={['Tonight', 'Today', 'This week']} containerStyle={{ width: 130 }} />
        <Button variant="secondary" size="md" iconLeft={<I.filter size={15} />}>More filters</Button>
        <div style={{ flex: 1 }} />
        <Button variant="secondary" size="md" iconLeft={<I.download size={15} />}>Export</Button>
        <Button variant="primary" size="md" iconLeft={<I.plus size={15} />}>New reservation</Button>
      </div>

      {/* Bulk action bar */}
      {sel.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'var(--color-primary-subtle)', border: '1px solid var(--color-success-border)', borderRadius: 'var(--radius-md)' }}>
          <Badge tone="primary" variant="solid">{sel.length}</Badge>
          <span style={{ fontSize: 13, color: 'var(--color-text)', fontWeight: 500 }}>selected</span>
          <div style={{ flex: 1 }} />
          <Button variant="secondary" size="sm">Confirm</Button>
          <Button variant="secondary" size="sm">Reassign table</Button>
          <Button variant="danger" size="sm">Cancel</Button>
        </div>
      )}

      <div>
        <DataTable columns={columns} rows={rows} selectable selected={sel} onSelectedChange={setSel} sort={sort} onSortChange={setSort} onRowClick={() => {}} />
        <Pagination page={1} pageSize={10} total={428} onPageChange={() => {}} onPageSizeChange={() => {}} />
      </div>
    </div>
  );
}
window.ReservationsScreen = ReservationsScreen;
