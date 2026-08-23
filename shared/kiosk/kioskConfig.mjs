import { SEED_CATEGORIES, SEED_ITEMS } from '../menu/menuData.mjs';

export const DEFAULT_KIOSK_PROMOS = [
  { id: 'p1', title: 'Dinner, served till late', badge: 'Limited Time', text: 'Settle in for the full mezze experience — grills, sharing plates and house wine.', priority: 1, start: '2026-06-01', end: '2026-09-30', enabled: true },
  { id: 'p2', title: 'Weekend Family Feast', badge: 'Popular', text: 'Sharing platters built for four or more — every Saturday and Sunday.', priority: 2, start: '2026-06-01', end: '2026-12-31', enabled: true },
  { id: 'p3', title: 'Long Lunch Set · $29', badge: "Chef's Choice", text: 'Two mezze and a charcoal main — in and out within the hour.', priority: 3, start: '2026-06-01', end: '2026-08-31', enabled: false },
  { id: 'p4', title: 'Happy Hour Mezze', badge: 'New', text: 'Half-price cold mezze, 4–6pm weekdays.', priority: 4, start: '2026-07-01', end: '2026-07-31', enabled: false },
];

export const DEFAULT_KIOSK_VIDEOS = [
  { id: 'v1', name: 'Default Intro Video', durationSec: 20, order: 1, autoplay: true, loop: true, mute: true, enabled: true, res: '1080p' },
];

export const DEFAULT_KIOSK_SETTINGS = {
  slideDuration: 8,
  transition: 'dissolve',
  rotateMenu: true,
  rotatePromos: true,
  rotateVideos: true,
  scheduleEnabled: false,
  playlist: 'Standard',
};

export const DEFAULT_KIOSK_BRANDING = {
  name: 'VERDURA',
  tagline: 'Fresh Mediterranean,\nover real charcoal.',
  kicker: 'Mediterranean Kitchen',
  supportingText: 'Mezze · Grills · Sharing platters',
  accentColor: '#C6A152',
};

// Titles must match shared/menu/menuData.mjs exactly (SEED_ITEMS titles are the
// canonical DOCX-sourced names). Restricted to items with a verified Asset/image
// photo so the kiosk rotation never falls back to a generic/unrelated image.
export const DEFAULT_FEATURED_TITLES = [
  'Pita Bread & Dips', 'Verdura Mezze Board', 'Dolma', 'Battata Harra', 'Arayes & Cheese',
  'Crispy Dynamite Prawns', 'Fattoush', 'Chicken Avocado Salad',
  'Wrap | Pita Pocket | On a Plate',
  'Chicken Shish [Shish Taouk]', 'Lamb Shish [Laham Meshwi]', 'Mixed Shish',
  'Persian Koobideh [Kofta Kebab]', 'Kuwaiti Chicken Machboos', 'Kuwaiti Lamb Shank Machboos',
  'Verdura Grill For Two', 'Verdura Couple Feast',
  'Garlic & Cheese Pide', 'Lebanese Lahm Bi Ajin', 'Chicken Ballista Pizza',
  'Mighty Angus Beef Burger', 'Mediterranean Chicken Burger',
  'Flavoured Rice', 'Hummus', 'Green Salad', 'Pita Bread — Full', 'Pita Bread — Half',
  'Baklava', 'Künefe', 'Tiramisu',
];

export const DEFAULT_KIOSK_ROTATION_STRATEGY = {
  heroTitles: [
    'Mixed Shish', 'Verdura Grill For Two', 'Chicken Shish [Shish Taouk]',
    'Lamb Shish [Laham Meshwi]', 'Persian Koobideh [Kofta Kebab]', 'Kuwaiti Lamb Shank Machboos',
  ],
  supportingTitles: [
    'Verdura Couple Feast', 'Verdura Mezze Board', 'Kuwaiti Chicken Machboos',
    'Arayes & Cheese', 'Chicken Avocado Salad',
  ],
  pizzaTitles: [
    'Chicken Ballista Pizza', 'Garlic & Cheese Pide', 'Lebanese Lahm Bi Ajin',
  ],
  dessertTitles: ['Baklava', 'Künefe', 'Tiramisu'],
  // No Drinks category exists in the current menu — the 'drinks' playlist slide
  // is skipped automatically when this resolves to zero items.
  drinkTitles: [],
  heroWeight: 3,
  pizzaInterval: 4,
  maxConsecutivePlatters: 2,
  alternateVideos: true,
};

export const DEFAULT_KIOSK_PLAYLIST_TEMPLATE = [
  { kind: 'intro' },
  { kind: 'hero', offset: 0 },
  { kind: 'hero', offset: 1 },
  { kind: 'video', offset: 0 },
  { kind: 'promotion', offset: 0 },
  { kind: 'hero', offset: 2 },
  { kind: 'pizza' },
  { kind: 'hero', offset: 3 },
  { kind: 'supporting', offset: 0 },
  { kind: 'dessert' },
  { kind: 'drinks' },
  { kind: 'video', offset: 1 },
  { kind: 'promotion', offset: 1 },
  { kind: 'hero', offset: 4 },
  { kind: 'supporting', offset: 1 },
  { kind: 'pizza' },
  { kind: 'supporting', offset: 2 },
  { kind: 'qr' },
];

/** @param {Array<any>} items */
export function createDefaultKioskMenuSettings(items = SEED_ITEMS) {
  return items.map(item => {
    const featuredIndex = DEFAULT_FEATURED_TITLES.indexOf(item.title);
    return {
      id: item.id,
      enabled: featuredIndex >= 0,
      badge: item.title.startsWith('Verdura Grand Feast') || item.title.startsWith('Verdura Family Feast') ? 'Featured' : item.title === 'Mixed Shish' ? 'Best Seller' : '',
      kioskSortOrder: featuredIndex >= 0 ? featuredIndex : DEFAULT_FEATURED_TITLES.length + item.sortOrder,
    };
  });
}

export function createDefaultKioskPublishedConfig() {
  return {
    version: 5,
    categories: SEED_CATEGORIES,
    menuItems: SEED_ITEMS,
    menuItemSettings: createDefaultKioskMenuSettings(),
    promos: DEFAULT_KIOSK_PROMOS,
    videos: DEFAULT_KIOSK_VIDEOS,
    settings: DEFAULT_KIOSK_SETTINGS,
    branding: DEFAULT_KIOSK_BRANDING,
    rotationStrategy: DEFAULT_KIOSK_ROTATION_STRATEGY,
    playlistTemplate: DEFAULT_KIOSK_PLAYLIST_TEMPLATE,
  };
}

const COOKIE_PREFIX = 'verdura_kiosk_pub_';

function cookieMap() {
  return Object.fromEntries(document.cookie.split('; ').filter(Boolean).map(part => {
    const index = part.indexOf('=');
    return [part.slice(0, index), part.slice(index + 1)];
  }));
}

async function gzipToBase64(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function base64FromGzip(encoded) {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export async function writePublishedConfigCookies(config) {
  const encoded = await gzipToBase64(JSON.stringify(config));
  const chunks = encoded.match(/.{1,3000}/g) || [];
  const previousCount = Number(cookieMap()[`${COOKIE_PREFIX}count`] || 0);
  const attributes = '; Path=/; Max-Age=31536000; SameSite=Lax';
  chunks.forEach((chunk, index) => { document.cookie = `${COOKIE_PREFIX}${index}=${chunk}${attributes}`; });
  for (let index = chunks.length; index < previousCount; index += 1) {
    document.cookie = `${COOKIE_PREFIX}${index}=; Path=/; Max-Age=0; SameSite=Lax`;
  }
  document.cookie = `${COOKIE_PREFIX}count=${chunks.length}${attributes}`;
  document.cookie = `${COOKIE_PREFIX}revision=${Date.now()}${attributes}`;
}

export async function readPublishedConfigCookies() {
  const cookies = cookieMap();
  const count = Number(cookies[`${COOKIE_PREFIX}count`] || 0);
  if (!count) return null;
  let encoded = '';
  for (let index = 0; index < count; index += 1) {
    if (!cookies[`${COOKIE_PREFIX}${index}`]) return null;
    encoded += cookies[`${COOKIE_PREFIX}${index}`];
  }
  return JSON.parse(await base64FromGzip(encoded));
}

export function getPublishedConfigCookieRevision() {
  return cookieMap()[`${COOKIE_PREFIX}revision`] || '';
}
