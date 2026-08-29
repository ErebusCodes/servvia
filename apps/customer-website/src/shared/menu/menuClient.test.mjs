import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePublicMenu, buildChannelMenuUrl } from './menuClient.js';

// Regression coverage for the 2026-08-26 Window Display incident: fixing the
// venue-id lookup alone made GET /api/kiosk/venues/:venueId/menu return 200,
// but the response mixed the curated Verdura menu with 825 unreviewed
// IdealPOS-imported rows (isAvailable:false, "Imported from IdealPOS
// (pending review)" category) — because the API intentionally returns every
// item for Order Tablet/Admin Console's benefit. This suite locks in the
// customer-facing filter that must live in normalizePublicMenu instead.

const category = (overrides = {}) => ({
  id: 'cat-1',
  name: 'Mains',
  description: null,
  imageUrl: null,
  sortOrder: 0,
  isActive: true,
  ...overrides,
});

const item = (overrides = {}) => ({
  id: 'item-1',
  title: 'Lamb Kofta',
  description: 'Grilled lamb skewers',
  categoryId: 'cat-1',
  subCategory: null,
  sortOrder: 0,
  priceCents: 2500,
  isAvailable: true,
  isSpicy: false,
  imageUrl: null,
  nutritionalDetails: {},
  ...overrides,
});

test('excludes isAvailable:false items from the public menu', () => {
  const result = normalizePublicMenu({
    categories: [category()],
    menuItems: [
      item({ id: 'a', title: 'Curated Dish', isAvailable: true }),
      item({ id: 'b', title: 'VERDURA SPECIAL', isAvailable: false }),
    ],
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, 'Curated Dish');
});

test('drops a category that has nothing publicly visible left in it', () => {
  const result = normalizePublicMenu({
    categories: [
      category({ id: 'cat-curated', name: 'Mains' }),
      category({ id: 'cat-pending', name: 'Imported from IdealPOS (pending review)' }),
    ],
    menuItems: [
      item({ id: 'a', categoryId: 'cat-curated', isAvailable: true }),
      item({ id: 'b', categoryId: 'cat-pending', isAvailable: false }),
      item({ id: 'c', categoryId: 'cat-pending', isAvailable: false }),
    ],
  });

  assert.equal(result.categories.length, 1);
  assert.equal(result.categories[0].name, 'Mains');
});

test('keeps a category once at least one of its items becomes available', () => {
  const result = normalizePublicMenu({
    categories: [category({ id: 'cat-pending', name: 'Imported from IdealPOS (pending review)' })],
    menuItems: [
      item({ id: 'a', categoryId: 'cat-pending', isAvailable: false }),
      item({ id: 'b', categoryId: 'cat-pending', title: 'Reviewed & Enabled', isAvailable: true }),
    ],
  });

  assert.equal(result.categories.length, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, 'Reviewed & Enabled');
});

test('a fully-curated, fully-available menu passes through unchanged in count', () => {
  const result = normalizePublicMenu({
    categories: [category({ id: 'cat-a' }), category({ id: 'cat-b', name: 'Sides' })],
    menuItems: [
      item({ id: 'a', categoryId: 'cat-a' }),
      item({ id: 'b', categoryId: 'cat-a' }),
      item({ id: 'c', categoryId: 'cat-b' }),
    ],
  });

  assert.equal(result.categories.length, 2);
  assert.equal(result.items.length, 3);
});

test('an item missing isAvailable entirely is treated as available (only explicit false excludes)', () => {
  const result = normalizePublicMenu({
    categories: [category()],
    menuItems: [item({ isAvailable: undefined })],
  });

  assert.equal(result.items.length, 1);
});

// Phase D (Menu Management architecture): getAuthoritativeMenu() now calls
// the canonical customer_website channel resolver, not the old always-
// unfiltered kiosk endpoint. buildChannelMenuUrl is the pure, directly
// testable piece of that (see getAuthoritativeMenu's own doc comment for
// why the fetch call itself isn't unit-tested in this plain-Node runner).
test('getAuthoritativeMenu builds a URL against the canonical customer_website channel endpoint, not the old raw kiosk endpoint', () => {
  const url = buildChannelMenuUrl('https://api.example', 'venue-1', 'customer_website');
  assert.equal(url, 'https://api.example/api/menu/venues/venue-1/channel/customer_website');
  assert.ok(!url.includes('/api/kiosk/'));
});

// Reads the real MenuItem.isFeatured column, not the old
// nutritionalDetails.isFeatured JSON convention this project no longer
// writes anywhere.
test('is_featured reads MenuItem.isFeatured, not the old nutritionalDetails.isFeatured convention', () => {
  const result = normalizePublicMenu({
    categories: [category()],
    menuItems: [
      item({ id: 'a', isFeatured: true, nutritionalDetails: { isFeatured: false } }),
      item({ id: 'b', isFeatured: false, nutritionalDetails: { isFeatured: true } }),
    ],
  });

  const byId = Object.fromEntries(result.items.map((i) => [i.id, i]));
  assert.equal(byId.a.is_featured, true);
  assert.equal(byId.b.is_featured, false);
});
