// @ts-nocheck
/* Verdura icon set — Lucide path data (ISC) as inline React components.
   Consistent 24×24, 2px stroke, currentColor. Shared across the UI kit. */
const Svg = (p) => React.createElement('svg', {
  width: p.size || 18, height: p.size || 18, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: p.sw || 2, strokeLinecap: 'round', strokeLinejoin: 'round',
  style: p.style,
}, p.children);

const P = (d, key) => React.createElement('path', { d, key });
const C = (cx, cy, r, key) => React.createElement('circle', { cx, cy, r, key });
const R = (x, y, w, h, rx, key) => React.createElement('rect', { x, y, width: w, height: h, rx, key });

const Icon = {
  dashboard: (p) => <Svg {...p}>{[R(3,3,7,9,1,'a'),R(14,3,7,5,1,'b'),R(14,12,7,9,1,'c'),R(3,16,7,5,1,'d')]}</Svg>,
  calendar:  (p) => <Svg {...p}>{[R(3,4,18,18,2,'a'),P('M16 2v4M8 2v4M3 10h18','b')]}</Svg>,
  orders:    (p) => <Svg {...p}>{[P('M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z','a'),P('M3 6h18','b'),P('M16 10a4 4 0 0 1-8 0','c')]}</Svg>,
  kitchen:   (p) => <Svg {...p}>{[P('M8.5 8.5 5 5M5 5 3 7l3.5 3.5M6.5 11 11 6.5','a'),P('M14 8a3.5 3.5 0 1 1 5 5l-2 2-9 9-3-3 9-9Z','b')]}</Svg>,
  menu:      (p) => <Svg {...p}>{[P('M3 11h18M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4','a'),P('M5 11l1 9h12l1-9','b'),P('M9 16h6','c')]}</Svg>,
  payments:  (p) => <Svg {...p}>{[R(2,5,20,14,2,'a'),P('M2 10h20','b')]}</Svg>,
  staff:     (p) => <Svg {...p}>{[P('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2','a'),C(9,7,4,'b'),P('M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75','c')]}</Svg>,
  venues:    (p) => <Svg {...p}>{[P('M3 21h18M5 21V7l8-4v18M19 21V11l-6-3','a'),P('M9 9v.01M9 12v.01M9 15v.01M9 18v.01','b')]}</Svg>,
  printer:   (p) => <Svg {...p}>{[P('M6 9V2h12v7','a'),P('M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2','b'),R(6,14,12,8,1,'c')]}</Svg>,
  sync:      (p) => <Svg {...p}>{[P('M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8','a'),P('M3 3v5h5','b'),P('M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16','c'),P('M21 21v-5h-5','d')]}</Svg>,
  audit:     (p) => <Svg {...p}>{[P('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z','a'),P('M14 2v6h6M16 13H8M16 17H8M10 9H8','b')]}</Svg>,
  reports:   (p) => <Svg {...p}>{[P('M3 3v18h18','a'),P('M18 17V9M13 17V5M8 17v-3','b')]}</Svg>,
  settings:  (p) => <Svg {...p}>{[C(12,12,3,'a'),P('M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z','b')]}</Svg>,
  search:    (p) => <Svg {...p}>{[C(11,11,7,'a'),P('m21 21-4.3-4.3','b')]}</Svg>,
  bell:      (p) => <Svg {...p}>{[P('M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9','a'),P('M10.3 21a1.94 1.94 0 0 0 3.4 0','b')]}</Svg>,
  plus:      (p) => <Svg {...p}>{[P('M12 5v14M5 12h14','a')]}</Svg>,
  filter:    (p) => <Svg {...p}>{[P('M3 4h18l-7 8v6l-4 2v-8Z','a')]}</Svg>,
  download:  (p) => <Svg {...p}>{[P('M12 3v12M7 10l5 5 5-5','a'),P('M5 21h14','b')]}</Svg>,
  more:      (p) => <Svg {...p}>{[C(12,5,1,'a'),C(12,12,1,'b'),C(12,19,1,'c')]}</Svg>,
  dollar:    (p) => <Svg {...p}>{[P('M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6','a')]}</Svg>,
  clock:     (p) => <Svg {...p}>{[C(12,12,9,'a'),P('M12 7v5l3 2','b')]}</Svg>,
  users:     (p) => <Svg {...p}>{[P('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2','a'),C(9,7,4,'b')]}</Svg>,
  check:     (p) => <Svg {...p}>{[P('M20 6 9 17l-5-5','a')]}</Svg>,
  alert:     (p) => <Svg {...p}>{[P('M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z','a'),P('M12 9v4M12 17h.01','b')]}</Svg>,
  trend:     (p) => <Svg {...p}>{[P('M22 7 13.5 15.5l-5-5L2 17','a'),P('M16 7h6v6','b')]}</Svg>,
  chevDown:  (p) => <Svg {...p}>{[P('M6 9l6 6 6-6','a')]}</Svg>,
  utensils:  (p) => <Svg {...p}>{[P('M3 2v7c0 1.1.9 2 2 2h0a2 2 0 0 0 2-2V2M5 2v20M21 15V2a5 5 0 0 0-3 5v6c0 1.1.9 2 2 2h1Zm0 0v7','a')]}</Svg>,
  flame:     (p) => <Svg {...p}>{[P('M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5Z','a')]}</Svg>,
  mapPin:    (p) => <Svg {...p}>{[P('M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z','a'),C(12,10,3,'b')]}</Svg>,
  receipt:   (p) => <Svg {...p}>{[P('M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z','a'),P('M8 7h8M8 11h8M8 15h5','b')]}</Svg>,
  arrowRight:(p) => <Svg {...p}>{[P('M5 12h14M13 6l6 6-6 6','a')]}</Svg>,
  logout:    (p) => <Svg {...p}>{[P('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9','a')]}</Svg>,
  kitchen_display: (p) => <Svg {...p}>{[R(3,3,18,13,2,'a'),P('M9 16v4M5 20h14','b'),P('M7 7h10M7 10h5','c')]}</Svg>,
  kiosks:          (p) => <Svg {...p}>{[R(4,3,16,14,2,'a'),P('M12 17v4M8 21h8','b')]}</Svg>,
  inventory:       (p) => <Svg {...p}>{[P('M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z','a'),P('M3.27 6.96L12 12.01l8.73-5.05','b'),P('M12 22.08V12','c')]}</Svg>,
  architecture:    (p) => <Svg {...p}>{[R(3,3,6,6,1,'a'),R(3,15,6,6,1,'b'),R(15,9,6,6,1,'c'),P('M9 6h3v12H9M12 12h3','d')]}</Svg>,
};

window.Icon = Icon;
