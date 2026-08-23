// @ts-nocheck
/* Kitchen Display System (KDS) Screen — live queue, station management, expedite, and SLA tracking. */
function KitchenDisplayScreen() {
  const { StatCard, Card, CardHeader, ProgressBar, Badge, Button, StatusBadge, Switch, Tabs, EmptyState } = window.DesignSystem_7f3fe8;
  const I = window.Icon;
  
  // Tab control: 'queue' (Live Queue), 'expedite' (Expedite Dashboard), 'stations' (Station Workload), 'performance' (Kitchen Performance)
  const [activeTab, setActiveTab] = React.useState('queue');
  
  // Kitchen station filter: 'All', 'Grill', 'Sauté', 'Cold / Salad', 'Pastry'
  const [stationFilter, setStationFilter] = React.useState('All');
  
  // WebSocket live sync state (mocking connection drops and resiliency behavior)
  const [wsConnected, setWsConnected] = React.useState(true);
  
  // SLA alert threshold in seconds (e.g. 15 minutes = 900 seconds)
  const SLA_LIMIT = 900; 
  
  // State for active orders in the kitchen
  const [orders, setOrders] = React.useState([
    { id: 'ORD-4821', table: 'T12', station: 'Grill', items: ['2× Ribeye (Med-Rare)', '1× Branzino', '2× Truffle Frites'], elapsed: 840, status: 'preparing', channel: 'Dine-in', expedited: false, checkedItems: [] },
    { id: 'ORD-4818', table: 'T18', station: 'Grill', items: ['3× Falafel Burger', '1× Crispy Salmon', '4× Spicy Wings'], elapsed: 1100, status: 'preparing', channel: 'Dine-in', expedited: false, checkedItems: [] },
    { id: 'ORD-4819', table: 'TableStation', code: 'kiosk-table', station: 'Sauté', items: ['1× Wild Mushroom Risotto', '2× Rigatoni Pasta'], elapsed: 615, status: 'preparing', channel: 'Kiosk', expedited: true, checkedItems: [] },
    { id: 'ORD-4817', table: 'Online Delivery', station: 'Cold / Salad', items: ['2× Caesar Salad', '1× Burrata Caprese'], elapsed: 480, status: 'ready', channel: 'Delivery', expedited: false, checkedItems: [] },
    { id: 'ORD-4822', table: 'T04', station: 'Pastry', items: ['2× Pistachio Baklava', '1× Vanilla Gelato'], elapsed: 350, status: 'confirmed', channel: 'Dine-in', expedited: false, checkedItems: [] },
    { id: 'ORD-4823', table: 'WindowKiosk', code: 'kiosk-window', station: 'Cold / Salad', items: ['1× Classic Falafel Wrap', '1× Hummus & Pita Plate'], elapsed: 75, status: 'confirmed', channel: 'Kiosk', expedited: false, checkedItems: [] },
    { id: 'ORD-4824', table: 'T08', station: 'Sauté', items: ['1× Spaghetti Carbonara', '1× Garlic Prawn Sauté'], elapsed: 25, status: 'confirmed', channel: 'Dine-in', expedited: false, checkedItems: [] },
  ]);

  // Keep track of total completed and cancelled tickets to compute metrics
  const [completedCount, setCompletedCount] = React.useState(18);
  const [slaCompliantCount, setSlaCompliantCount] = React.useState(16);
  const [totalPreppedTime, setTotalPreppedTime] = React.useState(18 * 620); // 18 tickets * 620s average

  // Increment order duration timers in real-time (1s intervals)
  React.useEffect(() => {
    const interval = setInterval(() => {
      setOrders(prev => prev.map(o => {
        if (o.status !== 'completed' && o.status !== 'cancelled') {
          return { ...o, elapsed: o.elapsed + 1 };
        }
        return o;
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Format seconds to mm:ss format
  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Bump screen workflow implementation:
  // transition: confirmed (New) -> preparing (Preparing) -> ready (Ready for pickup) -> completed
  const handleBump = (orderId) => {
    setOrders(prev => {
      let isRemoved = false;
      const updated = prev.map(o => {
        if (o.id === orderId) {
          if (o.status === 'confirmed') return { ...o, status: 'preparing' };
          if (o.status === 'preparing') return { ...o, status: 'ready' };
          if (o.status === 'ready') {
            isRemoved = true;
            // Record stats on completion
            setCompletedCount(c => c + 1);
            if (o.elapsed <= SLA_LIMIT) setSlaCompliantCount(s => s + 1);
            setTotalPreppedTime(t => t + o.elapsed);
            return { ...o, status: 'completed' };
          }
        }
        return o;
      });
      return isRemoved ? updated.filter(o => o.status !== 'completed') : updated;
    });
  };

  // Toggle order expedite flag
  const toggleExpedite = (orderId) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, expedited: !o.expedited } : o));
  };

  // Toggle checklist status of individual items
  const toggleItemCheck = (orderId, idx) => {
    setOrders(prev => prev.map(o => {
      if (o.id === orderId) {
        const checked = [...o.checkedItems];
        if (checked.includes(idx)) {
          return { ...o, checkedItems: checked.filter(i => i !== idx) };
        } else {
          return { ...o, checkedItems: [...checked, idx] };
        }
      }
      return o;
    }));
  };

  // Cancel order entirely (removes from active queue)
  const handleCancel = (orderId) => {
    setOrders(prev => prev.filter(o => o.id !== orderId));
  };

  // Filter orders by station
  const filteredOrders = orders.filter(o => {
    if (stationFilter === 'All') return true;
    return o.station === stationFilter;
  });

  // Calculate live average prep time (including in-progress prep times)
  const activeCount = orders.length;
  const avgPrepTimeSecs = completedCount > 0 ? Math.round(totalPreppedTime / completedCount) : 0;
  const slaRate = completedCount > 0 ? Math.round((slaCompliantCount / completedCount) * 100) : 100;

  // Station lists + load calculations based on in-memory orders
  const stations = [
    { name: 'Grill', color: '#ff6b6b' },
    { name: 'Sauté', color: '#ffbe76' },
    { name: 'Cold / Salad', color: '#4bcffa' },
    { name: 'Pastry', color: '#ef5777' },
  ].map(st => {
    const activeForStation = orders.filter(o => o.station === st.name);
    const preparingCount = activeForStation.filter(o => o.status === 'preparing').length;
    // Calculate load percent: max capacity 5 orders per station for 100%
    const loadPercent = Math.min(Math.round((activeForStation.length / 5) * 100), 100);
    // Average wait time for station
    const totalElapsed = activeForStation.reduce((sum, o) => sum + o.elapsed, 0);
    const avgSecs = activeForStation.length > 0 ? Math.round(totalElapsed / activeForStation.length) : 0;

    return {
      name: st.name,
      active: activeForStation.length,
      preparing: preparingCount,
      load: loadPercent,
      avg: avgSecs > 0 ? formatTime(avgSecs) : '—',
      color: st.color
    };
  });

  // Render components
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Resiliency Offline Warning Banner */}
      {!wsConnected && (
        <div style={{
          background: 'var(--color-danger-bg)',
          border: '1px solid var(--color-danger-border)',
          borderRadius: 'var(--radius-lg)',
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          color: 'var(--color-danger)',
          fontWeight: 600,
          animation: 'pulse 2s infinite'
        }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <div style={{ flex: 1, fontSize: 13 }}>
            <strong>KDS OFFLINE WARNING:</strong> Link to the live WebSocket order channel is disconnected. Active tickets below may be stale. Attempting to reconnect automatically...
          </div>
          <Button variant="danger" size="sm" onClick={() => setWsConnected(true)}>Reconnect</Button>
        </div>
      )}

      {/* Control bar containing station filter, views tabs, and simulated controls */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 14,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: '12px 20px'
      }}>
        {/* Left: Station Quick Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Station:</span>
          {['All', 'Grill', 'Sauté', 'Cold / Salad', 'Pastry'].map(st => (
            <Button
              key={st}
              variant={stationFilter === st ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setStationFilter(st)}
              style={{ padding: '4px 10px', height: 28, fontSize: 12 }}
            >
              {st}
            </Button>
          ))}
        </div>

        {/* Center: View Tabs */}
        <Tabs
          tabs={[
            { key: 'queue', label: 'Live Queue', badge: filteredOrders.length },
            { key: 'expedite', label: 'Expedite Board', badge: orders.filter(o => o.expedited || o.elapsed > 600).length },
            { key: 'stations', label: 'Station Management' },
            { key: 'performance', label: 'Metrics & SLA' }
          ]}
          active={activeTab}
          onChange={setActiveTab}
        />

        {/* Right: Resiliency and simulation switch */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Switch
            checked={wsConnected}
            onChange={(checked) => setWsConnected(checked)}
            label="WebSocket Link"
            style={{ fontSize: 13, fontWeight: 500 }}
          />
          <StatusBadge status={wsConnected ? 'healthy' : 'failed'} label={wsConnected ? 'Connected' : 'Offline'} />
        </div>
      </div>

      {/* Core Screen Views */}

      {/* View 1: Live Queue */}
      {activeTab === 'queue' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Stat Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <StatCard label="Active Tickets" value={orders.length} delta={`Across ${stationFilter === 'All' ? '4' : '1'} stations`} trend="flat" icon={<I.utensils />} hint="Incoming order rate high" />
            <StatCard label="Avg Ticket Prep Time" value={formatTime(avgPrepTimeSecs)} delta="Target: 12:00" trend="up" positiveIsGood={false} icon={<I.clock />} hint="Slowing due to high load" />
            <StatCard label="Fulfillment Speed" value={`${completedCount} prepped`} delta="Total completed" trend="up" icon={<I.check />} hint="Bump screen clicks active" />
            <StatCard label="SLA Compliance Rate" value={`${slaRate}%`} delta="Goal: > 95%" trend={slaRate >= 95 ? 'up' : 'down'} positiveIsGood={true} icon={<I.trend />} hint="Orders under 15m" />
          </div>

          {/* Ticket Grid */}
          {filteredOrders.length === 0 ? (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
              <EmptyState
                icon={<I.check size={30} style={{ color: 'var(--color-success)' }} />}
                title="Kitchen Queue Clean!"
                description={stationFilter === 'All'
                  ? "No active tickets are in queue. You are all caught up!"
                  : `No active tickets routed to the ${stationFilter} station.`}
                action={<Button variant="secondary" onClick={() => setStationFilter('All')}>View All Stations</Button>}
              />
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: 16
            }}>
              {filteredOrders.map(order => {
                const isOverSla = order.elapsed >= SLA_LIMIT;
                
                // SLA Color indicators
                let borderStyle = '1px solid var(--color-border)';
                let bgHeader = 'var(--color-surface-2)';
                if (order.status === 'preparing') {
                  borderStyle = '2px solid var(--color-primary)';
                  bgHeader = 'var(--color-primary-subtle)';
                } else if (order.status === 'ready') {
                  borderStyle = '2px solid var(--color-success)';
                  bgHeader = 'var(--color-success-bg)';
                }
                
                // Urgent alert over SLA limits
                if (isOverSla && order.status !== 'ready') {
                  borderStyle = '2px solid var(--color-danger)';
                  bgHeader = 'var(--color-danger-bg)';
                }

                // If websocket is offline, dim cards
                const opacity = wsConnected ? 1 : 0.8;

                return (
                  <Card key={order.id} padding="none" style={{
                    border: borderStyle,
                    opacity: opacity,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    minHeight: 250,
                    borderRadius: 'var(--radius-lg)',
                    overflow: 'hidden',
                    boxShadow: order.expedited ? '0 10px 15px -3px rgba(239, 87, 119, 0.15)' : 'none'
                  }}>
                    {/* Header */}
                    <div style={{
                      padding: '12px 16px',
                      background: bgHeader,
                      borderBottom: '1px solid var(--color-border)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-text)' }}>
                            {order.table}
                          </span>
                          {order.expedited && (
                            <Badge tone="warning" size="sm">EXPEDITE</Badge>
                          )}
                          {!wsConnected && (
                            <Badge tone="danger" size="sm">⚠️ STALE</Badge>
                          )}
                        </div>
                        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>
                          {order.id} · {order.channel}
                        </span>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <span style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: isOverSla ? 'var(--color-danger)' : 'var(--color-text-secondary)',
                          fontVariantNumeric: 'tabular-nums'
                        }}>
                          ⏳ {formatTime(order.elapsed)}
                        </span>
                        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                          {order.station}
                        </div>
                      </div>
                    </div>

                    {/* Content Items Checklist */}
                    <div style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {order.items.map((item, idx) => {
                        const isChecked = order.checkedItems.includes(idx);
                        return (
                          <div
                            key={idx}
                            onClick={() => toggleItemCheck(order.id, idx)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              cursor: 'pointer',
                              padding: '6px 8px',
                              borderRadius: 'var(--radius-sm)',
                              background: isChecked ? 'var(--color-surface-3)' : 'transparent',
                              transition: 'all 0.15s ease'
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              readOnly
                              style={{
                                cursor: 'pointer',
                                accentColor: 'var(--color-primary)'
                              }}
                            />
                            <span style={{
                              fontSize: 13,
                              fontWeight: isChecked ? 500 : 700,
                              color: isChecked ? 'var(--color-text-tertiary)' : 'var(--color-text)',
                              textDecoration: isChecked ? 'line-through' : 'none',
                              flex: 1
                            }}>
                              {item}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Footer Actions */}
                    <div style={{
                      padding: 12,
                      background: 'var(--color-surface-2)',
                      borderTop: '1px solid var(--color-border)',
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center'
                    }}>
                      <Button
                        variant={order.expedited ? 'secondary' : 'ghost'}
                        size="sm"
                        onClick={() => toggleExpedite(order.id)}
                        style={{ height: 32, padding: '0 8px' }}
                        title={order.expedited ? "Unmark Expedite" : "Mark Expedite"}
                      >
                        🔥
                      </Button>

                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleCancel(order.id)}
                        style={{ height: 32, color: 'var(--color-danger)' }}
                      >
                        Cancel
                      </Button>

                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleBump(order.id)}
                        style={{
                          flex: 1,
                          height: 32,
                          fontWeight: 700,
                          background: order.status === 'confirmed' ? 'var(--color-primary)' :
                                      order.status === 'preparing' ? 'var(--color-success)' :
                                      'var(--color-success)'
                        }}
                      >
                        {order.status === 'confirmed' && 'START PREP'}
                        {order.status === 'preparing' && 'MARK READY'}
                        {order.status === 'ready' && 'BUMP TICKET'}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* View 2: Expedite Board */}
      {activeTab === 'expedite' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card padding="none">
            <CardHeader title="Expediter Dashboard" subtitle="Manage kitchen SLA limits, ticket sorting, and station routing priorities." />
            <div style={{ padding: '0 20px 20px' }}>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                marginTop: 10
              }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '80px 100px 120px 1fr 100px 180px',
                  padding: '10px 14px',
                  background: 'var(--color-surface-3)',
                  fontWeight: 600,
                  fontSize: 13,
                  color: 'var(--color-text-secondary)',
                  borderBottom: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)'
                }}>
                  <div>Table</div>
                  <div>ID</div>
                  <div>Station</div>
                  <div>Items Wait List</div>
                  <div>Timer</div>
                  <div style={{ textAlign: 'right' }}>Actions</div>
                </div>

                {orders.map(order => {
                  const isOverSla = order.elapsed >= SLA_LIMIT;
                  const isWarning = order.elapsed >= 600 && order.elapsed < SLA_LIMIT;
                  let slaColor = 'var(--color-success)';
                  if (isOverSla) slaColor = 'var(--color-danger)';
                  else if (isWarning) slaColor = 'var(--color-warning)';

                  return (
                    <div key={order.id} style={{
                      display: 'grid',
                      gridTemplateColumns: '80px 100px 120px 1fr 100px 180px',
                      alignItems: 'center',
                      padding: '12px 14px',
                      background: order.expedited ? 'rgba(239, 87, 119, 0.05)' : 'transparent',
                      borderBottom: '1px solid var(--color-border)',
                      fontSize: 13
                    }}>
                      <div style={{ fontWeight: 800, color: 'var(--color-text)' }}>{order.table}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>{order.id}</div>
                      <div>
                        <Badge tone="neutral" size="sm">{order.station}</Badge>
                      </div>
                      <div style={{ color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 20 }}>
                        {order.items.join(' · ')}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: slaColor }} />
                        <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: isOverSla ? 'var(--color-danger)' : 'var(--color-text)' }}>
                          {formatTime(order.elapsed)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <Button
                          variant={order.expedited ? 'primary' : 'secondary'}
                          size="sm"
                          onClick={() => toggleExpedite(order.id)}
                          style={{ height: 28, fontSize: 11 }}
                        >
                          {order.expedited ? 'Expedited' : 'Expedite'}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleBump(order.id)}
                          style={{ height: 28, fontSize: 11 }}
                        >
                          Bump
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {orders.length === 0 && (
                  <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                    No active tickets to expedite.
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* View 3: Station Workload Management */}
      {activeTab === 'stations' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16 }}>
          <Card>
            <CardHeader title="Station Workload & Status" subtitle="Review active workload load percentages, routing, and preparation times." />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 14 }}>
              {stations.map(st => (
                <div key={st.name} style={{
                  padding: 16,
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-surface-2)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>{st.name} Station</span>
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        <Badge tone={st.load > 70 ? 'warning' : 'primary'} size="sm">{st.active} Active Tickets</Badge>
                        <Badge tone="neutral" size="sm">{st.preparing} Preparing</Badge>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Avg Prep:</span>
                      <div style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text)' }}>{st.avg}</div>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <ProgressBar value={st.load} tone={st.load > 75 ? 'warning' : 'primary'} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', width: 36, textAlign: 'right' }}>
                      {st.load}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card padding="none">
            <div style={{ padding: '18px 20px 14px' }}>
              <CardHeader title="Station Routing Configuration" subtitle="Define default stations for menu categories." />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--color-border)' }}>
              {[
                { category: 'Main Courses (Steaks, Seafood)', station: 'Grill' },
                { category: 'Pasta, Risotto, Hot Starters', station: 'Sauté' },
                { category: 'Salads, Desserts, Cold Appetizers', station: 'Cold / Salad' },
                { category: 'Pastry, Sweets, Gelato', station: 'Pastry' }
              ].map((route, idx) => (
                <div key={idx} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '14px 20px',
                  borderBottom: '1px solid var(--color-border)',
                  fontSize: 13
                }}>
                  <div>
                    <strong style={{ display: 'block', color: 'var(--color-text)' }}>{route.category}</strong>
                    <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>Automatic ticket routing rule</span>
                  </div>
                  <Select
                    options={['Grill', 'Sauté', 'Cold / Salad', 'Pastry']}
                    value={route.station}
                    onChange={() => {}}
                    fullWidth={false}
                    containerStyle={{ width: 130 }}
                    size="sm"
                  />
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* View 4: Performance Analytics */}
      {activeTab === 'performance' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            <Card>
              <CardHeader title="SLA compliance by hour" />
              <div style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 16,
                height: 140,
                padding: '10px 0'
              }}>
                {[
                  { hour: '12 PM', pct: 95 },
                  { hour: '1 PM', pct: 88 },
                  { hour: '2 PM', pct: 100 },
                  { hour: '6 PM', pct: 92 },
                  { hour: '7 PM', pct: 84 },
                  { hour: '8 PM', pct: 91 },
                ].map(item => (
                  <div key={item.hour} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-secondary)' }}>{item.pct}%</span>
                    <div style={{
                      width: '100%',
                      height: `${item.pct}%`,
                      background: item.pct >= 95 ? 'var(--color-success)' :
                                  item.pct >= 90 ? 'var(--color-warning)' :
                                  'var(--color-danger)',
                      borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0'
                    }} />
                    <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>{item.hour}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader title="Throughput trend" subtitle="Completed orders by hour" />
              <div style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 16,
                height: 140,
                padding: '10px 0'
              }}>
                {[
                  { hour: '12 PM', val: 18 },
                  { hour: '1 PM', val: 24 },
                  { hour: '2 PM', val: 12 },
                  { hour: '6 PM', val: 32 },
                  { hour: '7 PM', val: 41 },
                  { hour: '8 PM', val: 38 },
                ].map(item => (
                  <div key={item.hour} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-secondary)' }}>{item.val}</span>
                    <div style={{
                      width: '100%',
                      height: `${(item.val / 45) * 100}%`,
                      background: 'var(--color-primary)',
                      borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0'
                    }} />
                    <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{item.hour}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader title="SLA Breakdown" subtitle="By wait time distribution" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
                {[
                  { label: '< 8 min (Fast)', count: 12, pct: 60, color: 'var(--color-success)' },
                  { label: '8-12 min (Target)', count: 5, pct: 25, color: 'var(--color-primary)' },
                  { label: '12-15 min (Warning)', count: 2, pct: 10, color: 'var(--color-warning)' },
                  { label: '> 15 min (Delayed)', count: 1, pct: 5, color: 'var(--color-danger)' }
                ].map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: 'var(--color-text)' }}>{item.label}</span>
                      <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>{item.count} ({item.pct}%)</span>
                    </div>
                    <div style={{ height: 6, background: 'var(--color-surface-3)', borderRadius: 'var(--radius-full)' }}>
                      <div style={{ width: `${item.pct}%`, height: '100%', background: item.color, borderRadius: 'var(--radius-full)' }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

window.KitchenDisplayScreen = KitchenDisplayScreen;
