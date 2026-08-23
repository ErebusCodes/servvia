import { useMemo, useState } from 'react';

type IconName = 'search'|'receive'|'quick'|'order'|'adjust'|'waste'|'stocktake'|'transfer'|'more'|'file'|'truck'|'clock'|'warning'|'chart'|'settings'|'list'|'grid'|'chevron'|'dots';

const paths: Record<IconName, string> = {
  search:'M21 21l-4.35-4.35m2.35-5.65a8 8 0 11-16 0 8 8 0 0116 0z',
  receive:'M12 3v12m0 0l-4-4m4 4l4-4M5 21h14', quick:'M4 13l5 5L20 6',
  order:'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7', adjust:'M4 7h10m4 0h2M4 17h2m4 0h10M14 4v6M6 14v6',
  waste:'M5 7h14m-11 0l1 13h6l1-13M9 4h6', stocktake:'M6 3h12v18H6zM9 8h6m-6 4h6m-6 4h3',
  transfer:'M5 8h14m0 0l-3-3m3 3l-3 3M19 16H5m0 0l3-3m-3 3l3 3', more:'M8 10l4 4 4-4',
  file:'M6 3h9l4 4v14H6zM14 3v5h5', truck:'M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 100-4 2 2 0 000 4zm10 0a2 2 0 100-4 2 2 0 000 4z',
  clock:'M12 22a10 10 0 100-20 10 10 0 000 20zm0-15v6l4 2', warning:'M12 3L2 20h20L12 3zm0 6v5m0 3h.01',
  chart:'M4 20V10m5 10V4m5 16v-7m5 7V7', settings:'M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0-12v2m0 13v2m8.5-8.5h-2m-13 0h-2m14.5-6l-1.5 1.5m-9 9L6 18m12 0l-1.5-1.5m-9-9L6 6',
  list:'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', grid:'M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z',
  chevron:'M9 6l6 6-6 6', dots:'M12 6h.01M12 12h.01M12 18h.01'
};

function Icon({name,size=15,className=''}:{name:IconName,size?:number,className?:string}) { return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]}/></svg> }

const actions = [
  ['receive','Receive Goods'],['quick','Quick Receive'],['order','Purchase Order'],['adjust','Stock Adjustment'],
  ['waste','Record Waste'],['stocktake','Stocktake'],['transfer','Transfer Stock']
] as [IconName,string][];

const inbox = [
  {icon:'file',label:'POs to Receive',value:'8',sub:'$6,430.50',color:'emerald'},
  {icon:'truck',label:'Deliveries Today',value:'4',sub:'2 overdue',color:'blue'},
  {icon:'warning',label:'Critical Stock',value:'12',sub:'View items →',color:'amber'},
  {icon:'clock',label:'Expiring Soon',value:'18',sub:'View items →',color:'amber'},
  {icon:'stocktake',label:'Stocktakes Due',value:'3',sub:'View all →',color:'emerald'},
  {icon:'waste',label:'High Waste (7d)',value:'$186.40',sub:'View report →',color:'red'},
  {icon:'transfer',label:'Variances',value:'7',sub:'Investigate →',color:'emerald'},
] as const;

const kpis = [
  ['Inventory Value','$73,900.50','↑ 2.4%','green'],['Inventory Accuracy','98.7%','↑ 1.2%','green'],["Today's Receipts",'$6,680.00','', 'blue'],
  ["Today's Consumption",'$4,215.30','', 'violet'],["Today's Waste",'$186.40','', 'red'],["Today's Adjustments",'$45.00','', 'amber'],['Inventory Turns (30d)','4.2','↑ 0.3','green']
] as const;

type InventoryRow = [string,string,string,string,string,string,string,string,string,string,string,string,string,string];
const rows: InventoryRow[] = [
  ['🥑','Avocados Hass #119','VEG-219','Vegetables','Fresh Foods Ltd','47','16','kg','Low','12 days','13 Jul 2026','4 kg','$1.50','$70.50'],
  ['🥩','Chicken Breast','MEAT-101','Meat','Fresh Foods Ltd','120','80','kg','Healthy','5 days','08 Jul 2026','18 kg','$6.20','$744.00'],
  ['🫒','Olive Oil Extra Virgin','OIL-001','Pantry','Med. Imports','24','18','bottle','Low','120 days','01 Nov 2026','1 bottle','$12.80','$307.20'],
  ['🍚','Basmati Rice 20kg','DRY-201','Dry Goods','Med. Imports','114','110','bag','Healthy','19 days','22 Jul 2026','6 bags','$42.00','$4,788.00'],
  ['🥣','Greek Yogurt 1kg','DAIRY-021','Dairy','Dairy Fresh','31','10','tub','Critical','2 days','05 Jul 2026','6 tubs','$3.20','$99.20'],
  ['🫓','Pita Bread','BAK-011','Bakery','Bakery Co.','0','0','pack','Zero Stock','—','','40 packs','$2.10','$0.00'],
  ['🍅','Tomatoes','VEG-102','Vegetables','Fresh Foods Ltd','8','2','kg','Critical','3 days','06 Jul 2026','7 kg','$2.60','$20.80'],
  ['🧀','Mozzarella Cheese','DAIRY-110','Dairy','Dairy Fresh','15','5','kg','Low','7 days','10 Jul 2026','5 kg','$9.20','$138.00'],
  ['🧅','Red Onion','VEG-118','Vegetables','Fresh Foods Ltd','22','8','kg','Healthy','14 days','17 Jul 2026','3 kg','$2.40','$52.80'],
  ['🥬','Cos Lettuce','VEG-125','Vegetables','Fresh Foods Ltd','36','20','unit','Healthy','6 days','09 Jul 2026','5 units','$1.80','$64.80'],
];

const tone: Record<string,string> = {Low:'bg-amber-50 text-amber-600',Healthy:'bg-emerald-50 text-emerald-700',Critical:'bg-red-50 text-red-600','Zero Stock':'bg-red-50 text-red-600'};
const iconTone: Record<string,string> = {emerald:'bg-emerald-50 text-emerald-600',blue:'bg-blue-50 text-blue-600',amber:'bg-amber-50 text-amber-600',red:'bg-red-50 text-red-500'};
const detailedRows: [IconName,string,string,string][] = [['file','POs to Receive','8','$6,430.50'],['truck','Deliveries Today','4','2 overdue'],['clock','Expiring Soon','18','$1,230.40'],['stocktake','Stocktakes Due','3',''],['waste','High Waste (7d)','',' $186.40'],['transfer','Variances','7','$312.00']];

const chartColor: Record<string,string> = {green:'#4ade80',blue:'#60a5fa',violet:'#a78bfa',red:'#f87171',amber:'#fbbf24'};
function MiniBars({color}:{color:string}) { return <div className="flex h-7 items-end gap-[3px] overflow-hidden">{[8,12,7,18,14,22,10,17,25,20,13,19].map((h,i)=><i key={i} className="w-[3px] rounded-t" style={{height:h,backgroundColor:chartColor[color]}} />)}</div> }
function Select({children}:{children:string}) { return <button className="h-[30px] min-w-[106px] rounded-[5px] border border-[#d9e0e7] bg-white px-3 text-left text-[9px] font-medium text-[#334155] flex items-center justify-between gap-3 hover:border-[#86d8ad]">{children}<Icon name="more" size={11}/></button> }

export function InventoryPage() {
  const [query,setQuery] = useState('');
  const [activeFilter,setActiveFilter] = useState('All Items');
  const [activeTab,setActiveTab] = useState('Inventory');
  const [density,setDensity] = useState<'list'|'grid'>('list');
  const [notice,setNotice] = useState('');
  const filtered = useMemo(()=>rows.filter(r => (activeFilter==='All Items'||r[8]===activeFilter.replace('Low Stock','Low')) && r.join(' ').toLowerCase().includes(query.toLowerCase())),[query,activeFilter]);
  const act=(label:string)=>{setNotice(`${label} opened`); window.setTimeout(()=>setNotice(''),1800)};
  const tabs=['Inventory','Purchase Orders','Receiving','Movements','Waste','Stocktake','Recipes','Suppliers','Transfers','Reports','Alerts'];

  return <div className="relative min-h-full bg-[#f8faf9] px-5 py-[21px] text-[#172033]">
    {notice && <div role="status" className="fixed right-5 top-20 z-50 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-lg">{notice}</div>}
    <div className="w-full min-w-0">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_282px]">
        <main className="min-w-0">
          <div className="mb-5 flex min-h-[31px] flex-wrap items-center gap-2">
            {actions.map(([icon,label])=><button key={label} onClick={()=>act(label)} className="h-[31px] rounded-[5px] border border-[#8fd9b2] bg-white px-3 text-[9px] font-semibold text-[#07883f] flex items-center gap-2 hover:bg-[#effbf4] focus:outline-none focus:ring-2 focus:ring-emerald-500"><Icon name={icon} size={13}/>{label}</button>)}
            <button onClick={()=>act('More actions')} className="h-[31px] rounded-[5px] border border-[#d9e0e7] bg-white px-4 text-[9px] font-semibold flex items-center gap-2 hover:bg-slate-50">More <Icon name="more" size={11}/></button>
          </div>
          <section className="mb-4 rounded-[8px] border border-[#e1e6eb] bg-white p-3 shadow-[0_2px_8px_rgba(15,23,42,0.035)]">
            <div className="mb-2 flex items-center justify-between"><h2 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Operations Inbox</h2><button className="flex items-center gap-1 text-[10px] font-medium text-slate-500"><Icon name="settings" size={12}/> Customize</button></div>
            <div className="grid auto-rows-fr grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7">{inbox.map(x=><button key={x.label} onClick={()=>act(x.label)} className="flex min-w-0 flex-col justify-center rounded-[6px] border border-[#e1e6eb] px-3 py-1.5 text-left hover:border-emerald-300 hover:bg-emerald-50/30">
              <div className="flex items-center gap-1.5"><span className={`grid h-[22px] w-[22px] place-items-center rounded ${iconTone[x.color]}`}><Icon name={x.icon} size={13}/></span><span className="truncate text-[10px] font-medium leading-tight">{x.label}</span></div>
              <div className="mt-1.5 flex items-end justify-between gap-1"><strong className="text-[16px] leading-none">{x.value}</strong><span className={`text-[9px] font-semibold leading-none ${x.sub.includes('overdue')?'text-red-500':'text-emerald-600'}`}>{x.sub}</span></div>
            </button>)}</div>
          </section>

          <section className="mb-6 grid auto-rows-fr grid-cols-1 gap-y-3 rounded-[8px] border border-[#e1e6eb] bg-white px-1 py-3 shadow-[0_2px_8px_rgba(15,23,42,0.035)] sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7">{kpis.map(([label,value,delta,color],i)=><div key={label} className={`min-h-[80px] min-w-0 px-4 ${i?'border-l border-[#e5e9ee]':''}`}>
            <div className="truncate text-[9px] font-medium text-slate-500">{label}</div><div className="mt-1 text-[16px] font-bold tracking-tight">{value}</div><div className="mt-1 flex items-end justify-between"><span className="text-[9px] font-semibold text-emerald-600">{delta}</span><MiniBars color={color}/></div>
          </div>)}</section>

          <section className="overflow-hidden rounded-[8px] border border-[#e1e6eb] bg-white shadow-[0_2px_8px_rgba(15,23,42,0.035)]">
            <div className="overflow-x-auto border-b border-[#e1e6eb] px-3"><div className="flex min-w-max gap-[23px]">{tabs.map(t=><button key={t} onClick={()=>setActiveTab(t)} className={`h-[37px] border-b-2 text-[9px] font-semibold uppercase ${activeTab===t?'border-[#0aaa50] text-[#07883f]':'border-transparent text-[#596579] hover:text-slate-800'}`}>{t}</button>)}</div></div>
            <div className="border-b border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-[7px]"><label className="relative min-w-[205px] flex-1"><Icon name="search" size={13} className="absolute left-3 top-[9px] text-slate-400"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search inventory..." className="h-[30px] w-full rounded-[5px] border border-[#d9e0e7] pl-9 pr-3 text-[9px] outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"/></label><Select>All Categories</Select><Select>All Suppliers</Select><Select>All Venues</Select><Select>All Statuses</Select><Select>All Stock Levels</Select><span className="ml-auto text-[8px] text-slate-400">Density:</span><button aria-label="List density" onClick={()=>setDensity('list')} className={`grid h-[26px] w-[26px] place-items-center rounded border ${density==='list'?'border-emerald-200 bg-emerald-50 text-emerald-600':'border-slate-200'}`}><Icon name="list" size={13}/></button><button aria-label="Grid density" onClick={()=>setDensity('grid')} className={`grid h-[26px] w-[26px] place-items-center rounded border ${density==='grid'?'border-emerald-200 bg-emerald-50 text-emerald-600':'border-slate-200'}`}><Icon name="grid" size={13}/></button><button aria-label="Table settings" className="grid h-[26px] w-[26px] place-items-center rounded border border-slate-200"><Icon name="settings" size={13}/></button></div>
              <div className="mt-3 flex flex-wrap items-center gap-2">{['All Items','Low Stock','Zero Stock','Expiring Soon','Overdue'].map(f=><button key={f} onClick={()=>setActiveFilter(f)} className={`h-[28px] rounded-[5px] border px-3 text-[9px] font-medium ${activeFilter===f?'border-emerald-300 bg-emerald-50 text-emerald-700':'border-slate-200 bg-white'}`}>{f}</button>)}<button onClick={()=>setActiveFilter('All Items')} className="px-2 text-[9px] font-semibold text-emerald-600">Clear all</button></div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[970px] border-collapse text-left"><thead><tr className="h-10 border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500"><th className="px-3"><input type="checkbox"/></th>{['Item ↕','SKU','Category','Supplier','Venue','On Hand','Available','Unit','Stock Level','Expiry','Avg Daily Use','Cost','Value','Actions'].map(h=><th key={h} className="whitespace-nowrap px-2">{h}</th>)}</tr></thead>
              <tbody>{filtered.map((r,i)=><tr key={r[1]} className={`border-b border-slate-100 text-[11px] hover:bg-emerald-50/30 ${density==='grid'?'h-[59px]':'h-[48px]'}`}><td className="px-3"><input type="checkbox"/></td><td className="whitespace-nowrap px-2 font-semibold"><span className="mr-2 inline-grid h-6 w-6 place-items-center rounded-full bg-slate-100 text-sm">{r[0]}</span>{r[1]}</td><td className="px-2 text-slate-500">{r[2]}</td><td className="px-2 text-slate-500">{r[3]}</td><td className="whitespace-nowrap px-2 text-slate-500">{r[4]}</td><td className="whitespace-nowrap px-2 text-slate-500">All Venues</td><td className={`px-2 text-right font-bold ${r[5]==='0'||r[8]==='Critical'?'text-red-500':'text-emerald-600'}`}>{r[5]}</td><td className="px-2 text-right text-slate-500">{r[6]}</td><td className="px-2 text-slate-500">{r[7]}</td><td className="px-2"><span className={`rounded px-1.5 py-1 font-semibold ${tone[r[8]]}`}>{r[8]}</span></td><td className={`whitespace-nowrap px-2 font-semibold ${r[9].startsWith('2 ')||r[9].startsWith('3 ')?'text-red-500':'text-emerald-600'}`}>{r[9]}<small className="block text-[9px] font-normal text-slate-400">{r[10]}</small></td><td className="whitespace-nowrap px-2 text-slate-500">{r[11]}</td><td className="px-2 text-slate-500">{r[12]}</td><td className="px-2 font-semibold">{r[13]}</td><td className="px-2"><button aria-label={`Actions for ${r[1]}`}><Icon name="dots"/></button></td></tr>)}</tbody></table>
            </div>
            {filtered.length===0&&<div className="p-12 text-center text-sm text-slate-500">No inventory items match these filters.</div>}
            <div className="flex h-12 items-center justify-between px-3 text-[10px]"><span>Showing 1 to {filtered.length} of 128 items</span><div className="flex gap-1">{['‹','1','2','3','…','13','›'].map(x=><button key={x} className={`h-7 min-w-7 rounded border px-2 ${x==='1'?'border-emerald-600 bg-emerald-600 text-white':'border-slate-200'}`}>{x}</button>)}</div><Select>10 / page</Select></div>
          </section>
        </main>

        <aside className="space-y-4">
          <Side title="Operations Inbox (Detailed)" action="View all →"><div>{detailedRows.map(([ic,l,n,v])=><div key={l} className="flex h-[35px] items-center gap-2 border-b border-slate-100 text-[9px] last:border-0"><span className="grid h-6 w-6 place-items-center rounded bg-slate-50 text-emerald-600"><Icon name={ic}/></span><span className="flex-1">{l}</span><b>{n}</b><b className={v.includes('overdue')?'text-red-500':''}>{v}</b></div>)}</div></Side>
          <Side title="Stock Coverage (Days)" action="View report →"><div className="space-y-4">{[['Meat','2 days','10','#ef4444'],['Vegetables','8 days','44','#10b981'],['Dairy','5 days','26','#f59e0b'],['Dry Goods','21 days','82','#10b981']].map(([l,v,w,c])=><div key={l}><div className="mb-1 flex justify-between text-[10px]"><span>{l}</span><b style={{color:c}}>{v}</b></div><div className="h-1 rounded bg-slate-100"><div className="h-1 rounded" style={{width:`${w}%`,backgroundColor:c}}/></div></div>)}</div></Side>
          <Side title="AI Inventory Assistant" action="View all insights →"><ul className="space-y-2 text-[9px] leading-4">{["You're likely to run out of Chicken Breast in 2 days.",'Consider ordering 80 kg to cover the next 9 days.','Olive Oil prices increased 8% this month.','Based on upcoming reservations, you may need 20 kg more lamb this weekend.'].map(x=><li key={x} className="flex gap-2"><span className="text-violet-500">✣</span><span>{x}</span></li>)}</ul></Side>
          <Side title="Waste Tracking (Today)" action="View report →"><div className="flex justify-between border-b border-slate-100 pb-3"><div><span className="text-[8px] uppercase text-slate-400">Today's Waste</span><b className="block text-base text-red-500">$186.40</b></div><div className="text-right"><span className="text-[8px] uppercase text-slate-400">This Week</span><b className="block text-sm text-slate-500">$912.30</b></div></div><div className="pt-2 text-[9px]"><span className="text-[8px] uppercase text-slate-400">Most Wasted Items</span>{[['1. Chicken Breast','$68.40'],['2. Tomatoes','$36.20'],['3. Greek Yogurt','$24.10']].map(([a,b])=><div key={a} className="mt-2 flex justify-between font-semibold"><span>{a}</span><span>{b}</span></div>)}</div></Side>
          <Side title="Supplier Performance" action="View report →"><div className="space-y-2 text-[9px]">{[['Fresh Foods Ltd','98%'],['Dairy Fresh','94%'],['Med. Imports','89%']].map(([a,b])=><div key={a} className="flex justify-between"><span>{a}</span><b className="text-emerald-600">{b}</b></div>)}</div></Side>
        </aside>
      </div>
    </div>
  </div>
}

function Side({title,action,children}:{title:string,action:string,children:React.ReactNode}) { return <section className="rounded-[8px] border border-[#e1e6eb] bg-white p-4 shadow-[0_2px_8px_rgba(15,23,42,0.035)]"><div className="mb-3 flex items-center justify-between"><h2 className="text-[9px] font-bold uppercase tracking-wide text-[#64748b]">{title}</h2><button className="text-[8px] font-semibold text-[#07883f]">{action}</button></div>{children}</section> }
