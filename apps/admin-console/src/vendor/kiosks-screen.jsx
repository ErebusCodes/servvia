// @ts-nocheck
/* Kiosks Module Screen — device monitoring, online status, config, menu sync, health tracking, and analytics. */
function KiosksScreen() {
  const { StatCard, Card, CardHeader, Badge, Button, StatusBadge, Switch, Tabs, Select, ProgressBar, EmptyState } = window.DesignSystem_7f3fe8;
  const I = window.Icon;

  // View control: 'monitoring' (Device Monitoring), 'config' (Device Configuration), 'analytics' (Kiosk Analytics)
  const [activeTab, setActiveTab] = React.useState('monitoring');

  // Kiosk Devices State (WindowKiosk and TableStation)
  const [kiosks, setKiosks] = React.useState([
    {
      id: 'kiosk-window',
      name: 'WindowKiosk',
      code: 'kiosk-window',
      status: 'healthy', // healthy, warning, offline, syncing
      mode: 'loop', // ordering, loop
      assignment: 'Window Display Frame',
      battery: 100,
      isCharging: true,
      wifiSignal: 'Excellent',
      printerStatus: 'online', // online, low_paper, offline
      readerStatus: 'offline', // Stripe terminal is offline for passive loop
      syncing: false,
      lastSync: '10 min ago',
      rebooting: false,
      ordersProcessed: 0,
      revenue: 0
    },
    {
      id: 'kiosk-table',
      name: 'TableStation',
      code: 'kiosk-table',
      status: 'healthy',
      mode: 'ordering',
      assignment: 'Table T12 (Zone A)',
      battery: 84,
      isCharging: false,
      wifiSignal: 'Good',
      printerStatus: 'online',
      readerStatus: 'healthy', // Stripe terminal is online & operational
      syncing: false,
      lastSync: '15 min ago',
      rebooting: false,
      ordersProcessed: 32,
      revenue: 965.25
    }
  ]);

  // Alert/notification log state
  const [logs, setLogs] = React.useState([
    { text: 'TableStation menu sync completed.', time: '15 min ago', type: 'info' },
    { text: 'WindowKiosk mode changed to Passive Menu Loop.', time: '20 min ago', type: 'info' },
    { text: 'WindowKiosk heartbeats established.', time: '1 hr ago', type: 'success' },
  ]);

  // Sync menu simulation
  const handleSyncMenu = (kioskId) => {
    setKiosks(prev => prev.map(k => k.id === kioskId ? { ...k, syncing: true, status: 'syncing' } : k));
    
    setTimeout(() => {
      setKiosks(prev => prev.map(k => {
        if (k.id === kioskId) {
          const now = new Date();
          const timeStr = `${now.getHours()}:${now.getMinutes() < 10 ? '0' : ''}${now.getMinutes()}`;
          // Update logs
          setLogs(prevLogs => [
            { text: `${k.name} menu synchronized successfully.`, time: 'Just now', type: 'success' },
            ...prevLogs
          ]);
          return {
            ...k,
            syncing: false,
            status: 'healthy',
            lastSync: `Synced at ${timeStr}`
          };
        }
        return k;
      }));
    }, 2000);
  };

  // Reboot device simulation
  const handleReboot = (kioskId) => {
    setKiosks(prev => prev.map(k => k.id === kioskId ? { ...k, rebooting: true, status: 'offline' } : k));
    setLogs(prevLogs => [
      { text: `Remote reboot signal sent to kiosk ${kioskId}.`, time: 'Just now', type: 'warning' },
      ...prevLogs
    ]);

    setTimeout(() => {
      setKiosks(prev => prev.map(k => {
        if (k.id === kioskId) {
          return {
            ...k,
            rebooting: false,
            status: 'healthy',
            battery: 100,
            wifiSignal: 'Excellent'
          };
        }
        return k;
      }));
      setLogs(prevLogs => [
        { text: `Kiosk ${kioskId} rebooted and reconnected online.`, time: 'Just now', type: 'success' },
        ...prevLogs
      ]);
    }, 4000);
  };

  // Toggle online/offline status manually
  const toggleKioskStatus = (kioskId) => {
    setKiosks(prev => prev.map(k => {
      if (k.id === kioskId) {
        const isOnline = k.status !== 'offline';
        const nextStatus = isOnline ? 'offline' : 'healthy';
        setLogs(prevLogs => [
          { text: `${k.name} was marked ${isOnline ? 'OFFLINE' : 'ONLINE'}.`, time: 'Just now', type: isOnline ? 'danger' : 'success' },
          ...prevLogs
        ]);
        return {
          ...k,
          status: nextStatus,
          wifiSignal: isOnline ? 'Disconnected' : 'Excellent',
          battery: isOnline ? 0 : 95
        };
      }
      return k;
    }));
  };

  // Change Kiosk configuration setting
  const updateKioskConfig = (kioskId, key, value) => {
    setKiosks(prev => prev.map(k => {
      if (k.id === kioskId) {
        setLogs(prevLogs => [
          { text: `Config updated for ${k.name}: ${key} set to ${value}.`, time: 'Just now', type: 'info' },
          ...prevLogs
        ]);
        return { ...k, [key]: value };
      }
      return k;
    }));
  };

  // Render components
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Top action header */}
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
        <Tabs
          tabs={[
            { key: 'monitoring', label: 'Device Monitoring', badge: kiosks.length },
            { key: 'config', label: 'Configuration' },
            { key: 'analytics', label: 'Kiosk Analytics' }
          ]}
          active={activeTab}
          onChange={setActiveTab}
        />

        <Button variant="primary" size="sm" iconLeft={<I.plus size={15} />} onClick={() => {
          const newId = `kiosk-${kiosks.length + 1}`;
          setKiosks(prev => [
            ...prev,
            {
              id: newId,
              name: `Kiosk-Station-${kiosks.length + 1}`,
              code: newId,
              status: 'healthy',
              mode: 'ordering',
              assignment: 'Table T08 (Zone B)',
              battery: 95,
              isCharging: true,
              wifiSignal: 'Excellent',
              printerStatus: 'online',
              readerStatus: 'healthy',
              syncing: false,
              lastSync: 'Just now',
              rebooting: false,
              ordersProcessed: 0,
              revenue: 0
            }
          ]);
          setLogs(prevLogs => [
            { text: `Registered new kiosk Kiosk-Station-${kiosks.length + 1}.`, time: 'Just now', type: 'success' },
            ...prevLogs
          ]);
        }}>
          Register New Kiosk
        </Button>
      </div>

      {/* View 1: Device Monitoring */}
      {activeTab === 'monitoring' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Stats Bar */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <StatCard label="Total Kiosks" value={kiosks.length} delta={`${kiosks.filter(k => k.status !== 'offline').length} online`} trend="up" icon={<I.venues />} hint="Fully monitored" />
            <StatCard label="Total Kiosk Sales" value={`$${kiosks.reduce((sum, k) => sum + k.revenue, 0).toFixed(2)}`} delta={`${kiosks.reduce((sum, k) => sum + k.ordersProcessed, 0)} orders`} trend="up" icon={<I.dollar />} hint="Processed today" />
            <StatCard label="Avg Checkout Time" value="1m 45s" delta="-12s" trend="down" positiveIsGood={true} icon={<I.clock />} hint="From browse to payment" />
            <StatCard label="Active Stripe Readers" value={`${kiosks.filter(k => k.readerStatus === 'healthy' && k.status !== 'offline').length} connected`} delta="Stripe Terminal API" trend="flat" icon={<I.check />} hint="Operational LAN link" />
          </div>

          {/* Devices Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
            gap: 16
          }}>
            {kiosks.map(kiosk => {
              // Status Tone mapping
              let statusTone = 'healthy';
              if (kiosk.status === 'offline') statusTone = 'failed';
              else if (kiosk.status === 'warning') statusTone = 'warning';
              else if (kiosk.status === 'syncing') statusTone = 'syncing';

              return (
                <Card key={kiosk.id} padding="none" style={{
                  border: kiosk.rebooting ? '1px dashed var(--color-border)' : '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-lg)',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden'
                }}>
                  {/* Card Header */}
                  <div style={{
                    padding: '16px 20px',
                    background: 'var(--color-surface-2)',
                    borderBottom: '1px solid var(--color-border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <div>
                      <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>{kiosk.name}</span>
                      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>
                        Ref: {kiosk.code} · {kiosk.assignment}
                      </div>
                    </div>
                    <StatusBadge status={statusTone} label={kiosk.status.toUpperCase()} />
                  </div>

                  {/* Card Body Metrics */}
                  <div style={{ padding: 20, flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {kiosk.rebooting ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 140, gap: 10 }}>
                        <span style={{ fontSize: 24 }} className="animate-spin">🌀</span>
                        <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>Kiosk rebooting in progress...</span>
                      </div>
                    ) : (
                      <>
                        {/* Battery, Wifi, Sync info */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                          <div style={{ background: 'var(--color-surface-3)', padding: 10, borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                            <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>WIFI LINK</div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{kiosk.wifiSignal}</div>
                          </div>
                          <div style={{ background: 'var(--color-surface-3)', padding: 10, borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                            <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>BATTERY</div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
                              {kiosk.battery}% {kiosk.isCharging ? '⚡' : ''}
                            </div>
                          </div>
                          <div style={{ background: 'var(--color-surface-3)', padding: 10, borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                            <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>MENU SYNC</div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{kiosk.lastSync}</div>
                          </div>
                        </div>

                        {/* Health Elements (Printer, Reader) */}
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10,
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-md)',
                          padding: 12,
                          background: 'var(--color-surface-2)'
                        }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', tracking: 1 }}>Device Health</div>
                          
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                            <span style={{ color: 'var(--color-text)' }}>ESC/POS Receipt Printer:</span>
                            <StatusBadge status={kiosk.printerStatus === 'online' ? 'healthy' : 'failed'} label={kiosk.printerStatus} />
                          </div>
                          
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                            <span style={{ color: 'var(--color-text)' }}>Stripe Terminal Reader:</span>
                            <StatusBadge status={kiosk.readerStatus === 'healthy' ? 'healthy' : 'warning'} label={kiosk.readerStatus === 'healthy' ? 'Ready' : 'Not Connected'} />
                          </div>
                        </div>

                        {/* Mode indicator */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                          <span style={{ color: 'var(--color-text)' }}>Operational Mode:</span>
                          <Badge tone={kiosk.mode === 'ordering' ? 'primary' : 'neutral'} size="sm">
                            {kiosk.mode === 'ordering' ? 'CUSTOMER ORDERING' : 'PASSIVE MENU LOOP'}
                          </Badge>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Card Footer Actions */}
                  <div style={{
                    padding: '12px 20px',
                    background: 'var(--color-surface-2)',
                    borderTop: '1px solid var(--color-border)',
                    display: 'flex',
                    gap: 8,
                    justifyContent: 'flex-end'
                  }}>
                    <Button
                      variant={kiosk.status === 'offline' ? 'success' : 'secondary'}
                      size="sm"
                      onClick={() => toggleKioskStatus(kiosk.id)}
                      disabled={kiosk.rebooting}
                    >
                      {kiosk.status === 'offline' ? 'Set Online' : 'Set Offline'}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleReboot(kiosk.id)}
                      disabled={kiosk.rebooting || kiosk.status === 'offline'}
                    >
                      Reboot
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleSyncMenu(kiosk.id)}
                      disabled={kiosk.syncing || kiosk.rebooting || kiosk.status === 'offline'}
                    >
                      {kiosk.syncing ? 'Syncing...' : 'Sync Menu'}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Activity Logs Card */}
          <Card padding="none">
            <div style={{ padding: '16px 20px' }}>
              <CardHeader title="Live Kiosk Events" subtitle="Heartbeat logs, synchronization events, and device alerts." />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--color-border)', maxHeight: 180, overflowY: 'auto' }}>
              {logs.map((log, idx) => {
                let toneColor = 'var(--color-text)';
                if (log.type === 'success') toneColor = 'var(--color-success)';
                if (log.type === 'warning') toneColor = 'var(--color-warning)';
                if (log.type === 'danger') toneColor = 'var(--color-danger)';
                
                return (
                  <div key={idx} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '10px 20px',
                    borderBottom: '1px solid var(--color-border)',
                    fontSize: 12
                  }}>
                    <span style={{ color: toneColor }}>{log.text}</span>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>{log.time}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* View 2: Device Configuration */}
      {activeTab === 'config' && (
        <Card>
          <CardHeader title="Kiosk Device Configuration Matrix" subtitle="Map devices to venues, table assignments, layout mode policies, and styling templates." />
          <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {kiosks.map(kiosk => (
              <div key={kiosk.id} style={{
                padding: 16,
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                display: 'grid',
                gridTemplateColumns: '1.2fr 1fr 1fr 1fr',
                gap: 16,
                alignItems: 'center'
              }}>
                <div>
                  <strong style={{ fontSize: 14, color: 'var(--color-text)' }}>{kiosk.name}</strong>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-tertiary)' }}>Code: {kiosk.code}</span>
                </div>

                <div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 4 }}>OPERATIONAL MODE</div>
                  <Select
                    options={[
                      { value: 'ordering', label: 'Customer Ordering' },
                      { value: 'loop', label: 'Passive Menu Loop' }
                    ]}
                    value={kiosk.mode}
                    onChange={(val) => updateKioskConfig(kiosk.id, 'mode', val)}
                    size="sm"
                  />
                </div>

                <div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 4 }}>TABLE ASSIGNMENT</div>
                  <Select
                    options={[
                      { value: 'Table T12 (Zone A)', label: 'Table T12' },
                      { value: 'Table T04 (Zone A)', label: 'Table T04' },
                      { value: 'Table T08 (Zone B)', label: 'Table T08' },
                      { value: 'Window Display Frame', label: 'Window Frame' },
                      { value: 'Front Entrance Lobby', label: 'Lobby Stand' }
                    ]}
                    value={kiosk.assignment}
                    onChange={(val) => updateKioskConfig(kiosk.id, 'assignment', val)}
                    size="sm"
                  />
                </div>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <Button variant="secondary" size="sm" onClick={() => handleSyncMenu(kiosk.id)}>
                    Push Config
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* View 3: Kiosk Analytics */}
      {activeTab === 'analytics' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            <Card>
              <CardHeader title="Hourly Kiosk Orders" subtitle="Kiosk self-service volume" />
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 140, padding: '10px 0' }}>
                {[
                  { h: '11am', v: 4 }, { h: '12pm', v: 12 }, { h: '1pm', v: 16 },
                  { h: '2pm', v: 8 }, { h: '6pm', v: 22 }, { h: '7pm', v: 34 },
                  { h: '8pm', v: 28 }
                ].map(item => (
                  <div key={item.h} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-secondary)' }}>{item.v}</span>
                    <div style={{
                      width: '100%',
                      height: `${(item.v / 38) * 100}%`,
                      background: 'var(--color-info)',
                      borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0'
                    }} />
                    <span style={{ fontSize: 9, color: 'var(--color-text-tertiary)' }}>{item.h}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader title="Kiosk Revenue Trend" subtitle="Daily self-service volume" />
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 140, padding: '10px 0' }}>
                {[
                  { d: 'Mon', v: 420 }, { d: 'Tue', v: 540 }, { d: 'Wed', v: 390 },
                  { d: 'Thu', v: 620 }, { d: 'Fri', v: 980 }, { d: 'Sat', v: 1240 },
                  { d: 'Sun', v: 860 }
                ].map(item => (
                  <div key={item.d} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--color-text-secondary)' }}>${item.v}</span>
                    <div style={{
                      width: '100%',
                      height: `${(item.v / 1300) * 100}%`,
                      background: 'var(--color-success)',
                      borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0'
                    }} />
                    <span style={{ fontSize: 9, color: 'var(--color-text-tertiary)' }}>{item.d}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card padding="none">
              <div style={{ padding: '18px 20px 14px' }}>
                <CardHeader title="Payment Checkout Funnel" subtitle="Self-service completion conversion rate" />
              </div>
              <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  { stage: '1. Menu Browse', pct: 100, color: 'var(--color-info)' },
                  { stage: '2. Add to Cart', pct: 72, color: 'var(--color-primary)' },
                  { stage: '3. Enter Table #', pct: 64, color: 'var(--color-warning)' },
                  { stage: '4. Pay Completed', pct: 92, color: 'var(--color-success)' } // 92% of checkout attempts succeed
                ].map((x, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: 'var(--color-text)' }}>{x.stage}</span>
                      <span style={{ fontWeight: 600, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{x.pct}%</span>
                    </div>
                    <div style={{ height: 6, background: 'var(--color-surface-3)', borderRadius: 'var(--radius-full)' }}>
                      <div style={{ width: `${x.pct}%`, height: '100%', background: x.color, borderRadius: 'var(--radius-full)' }} />
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

window.KiosksScreen = KiosksScreen;
