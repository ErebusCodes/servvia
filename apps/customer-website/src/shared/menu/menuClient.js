// Live runtime menu data source for the customer site (and, via
// window-display's alias of this same file, its /menu browsing route too).
//
// This used to read Admin's edits through an iframe/localStorage broker
// (postMessage to admin-console's local-storage-broker.html) and fall back
// to the static shared/menu/menuData.mjs seed file otherwise. That made
// Admin, Customer and Kiosk three independently-drifting copies of the menu.
//
// The real backend Menu API (PostgreSQL-backed) is now the single runtime
// source of truth for all three surfaces. shared/menu/menuData.mjs remains
// only as seed/tooling input for `backend/prisma/seed.ts` — it is not
// imported here at runtime anymore.
import { compareMenuItemsAlphabetically, sortMenuItemsAlphabetically } from './menuData.js';

// `import.meta.env` is supplied by Vite in the browser but is absent when
// this pure formatting module is imported by Node-based validation tooling.
const API_BASE = import.meta.env?.VITE_API_URL || '';
const VENUE_ID = import.meta.env?.VITE_VENUE_ID || '';

/**
 * Normalizes a raw `GET /api/kiosk/venues/:venueId/menu` response into the
 * shape this app's menu/reservation UI renders — and, critically, is where
 * this shared, public-facing customer surface diverges from the endpoint's
 * other consumer.
 *
 * GET /api/kiosk/venues/:venueId/menu is also read by Order Tablet/Admin
 * Console (apps/admin-console/src/store/menu.store.ts), which intentionally
 * needs *every* item — including isAvailable:false ones — to render staff's
 * "86'd" grayed-out cards, so the API itself returns the unfiltered set.
 * This module's two callers (Menu.jsx and the reservation flow's
 * Step3Menu) are the only genuinely public-facing consumers, so the
 * available-only filter belongs here rather than in the shared endpoint.
 * Without it, any not-yet-curated import (e.g. a raw IdealPOS product sync,
 * seeded isAvailable:false pending review) would otherwise render straight
 * to customers.
 *
 * Exported separately (pure, no fetch/import.meta.env) so it can be
 * exercised directly by Node-based tooling/tests.
 */
export function normalizePublicMenu({ categories, menuItems }) {
  const publicItems = menuItems.filter(item => item.isAvailable !== false);

  const normalizedItems = publicItems.map(item => ({
    id: item.id,
    name: item.title,
    description: item.description || '',
    price: (item.priceCents ?? 0) / 100,
    category_id: item.categoryId,
    sub_category: item.subCategory || null,
    sort_order: item.sortOrder ?? 0,
    is_available: item.isAvailable !== false,
    is_spicy: item.isSpicy ?? false,
    image_url: item.imageUrl || null,
    tags: item.nutritionalDetails?.tags || [],
    is_featured: item.nutritionalDetails?.isFeatured || false,
    raw: item,
  }));

  const normalizedCategories = categories
    .map(category => ({
      id: category.id,
      name: category.name,
      description: category.description || '',
      image_url: category.imageUrl || null,
      sort_order: category.sortOrder ?? 0,
      is_active: category.isActive !== false,
      itemCount: normalizedItems.filter(item => item.category_id === category.id).length,
      // The backend doesn't model sub-category groupings at the Category
      // level (only MenuItem.subCategory, a free-text label) — the
      // canonical menu has never used this UI grouping feature.
      subs: [],
    }))
    // A category with nothing publicly visible in it (e.g. an
    // imported-but-not-yet-reviewed staging category) shouldn't render an
    // empty section on the public menu.
    .filter(category => category.itemCount > 0)
    .sort((a, b) => a.sort_order - b.sort_order);

  const sortedItems = sortMenuItemsAlphabetically(normalizedItems);

  return { categories: normalizedCategories, items: sortedItems };
}

/**
 * Fetches the live menu from the backend (same endpoint the kiosk ordering
 * flow uses: GET /api/kiosk/venues/:venueId/menu — public, venue-scoped,
 * includes any venue price/availability overrides). Throws on failure
 * rather than silently returning stale or fabricated data — callers decide
 * how to present a loading/error/empty state.
 */
export async function getAuthoritativeMenu() {
  if (!VENUE_ID) {
    throw new Error(
      'VITE_VENUE_ID is not configured — cannot load the live menu. See apps/customer-website/.env.example.'
    );
  }

  const response = await fetch(`${API_BASE}/api/kiosk/venues/${VENUE_ID}/menu`);
  if (!response.ok) {
    throw new Error(`Menu API request failed with status ${response.status}`);
  }
  const payload = await response.json();

  return normalizePublicMenu(payload);
}

const byItemName = compareMenuItemsAlphabetically;
const toReservationItem = item => ({
  id: item.id,
  name: item.name,
  desc: item.description,
  price: item.price,
});

/**
 * Preserve category/subcategory order exactly. Alphabetize only the items
 * inside each rendered subgroup and account for every item exactly once.
 */
export function formatMenuForReservation(categories, items) {
  const sections = [];

  for (const category of categories) {
    const categoryItems = items.filter(item => item.category_id === category.id);

    const isDrinksCategory = /drink|beverage/i.test(category.name);
    if (isDrinksCategory) {
      const nonAlcoholic = categoryItems
        .filter(item => item.tags.includes('Non-Alcoholic'))
        .sort(byItemName);
      const alcoholic = categoryItems
        .filter(item => item.tags.includes('Alcoholic'))
        .sort(byItemName);
      const other = categoryItems
        .filter(item => !item.tags.includes('Non-Alcoholic') && !item.tags.includes('Alcoholic'))
        .sort(byItemName);

      if (nonAlcoholic.length) sections.push({
        category: `${category.name} — Non-Alcoholic`,
        items: nonAlcoholic.map(toReservationItem),
      });
      if (alcoholic.length) sections.push({
        category: `${category.name} — Alcoholic`,
        items: alcoholic.map(toReservationItem),
      });
      if (other.length) sections.push({ category: category.name, items: other.map(toReservationItem) });
      continue;
    }

    if (category.subs.length) {
      const knownSubcategories = new Set(category.subs.map(subcategory => subcategory.name));
      for (const subcategory of category.subs) {
        const subgroupItems = categoryItems
          .filter(item => item.sub_category === subcategory.name)
          .sort(byItemName);
        if (subgroupItems.length) sections.push({
          category: `${category.name} — ${subcategory.name}`,
          items: subgroupItems.map(toReservationItem),
        });
      }

      const uncategorized = categoryItems
        .filter(item => !item.sub_category || !knownSubcategories.has(item.sub_category))
        .sort(byItemName);
      if (uncategorized.length) sections.push({
        category: `${category.name} — Other`,
        items: uncategorized.map(toReservationItem),
      });
      continue;
    }

    if (categoryItems.length) sections.push({
      category: category.name,
      items: categoryItems.sort(byItemName).map(toReservationItem),
    });
  }

  return sections;
}
