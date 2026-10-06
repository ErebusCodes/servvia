import {
  CANONICAL_MENU_ITEM_COUNT,
  SEED_CATEGORIES as canonicalCategories,
  SEED_ITEMS as canonicalItems,
  sortMenuItemsAlphabetically,
} from '../shared/menu/menuData.mjs';
import { SEED_ITEMS as adminItems } from '../apps/web/admin-console/src/shared/menu/menuData.js';
import { SEED_ITEMS as customerItems } from '../apps/web/customer-website/src/shared/menu/menuData.js';
import { formatMenuForReservation } from '../apps/web/customer-website/src/shared/menu/menuClient.js';

const normalizedCategories = canonicalCategories.map(category => ({
  id: category.id,
  name: category.name,
  sort_order: category.sortOrder,
  subs: category.subs,
}));
const normalizedItems = canonicalItems.map(item => ({
  id: item.id,
  name: item.title,
  description: item.description,
  price: Number.parseFloat(item.price) || 0,
  category_id: item.categoryId,
  sub_category: item.subCategory,
  tags: item.nutritionalDetails?.tags || [],
}));
const bookingSections = formatMenuForReservation(normalizedCategories, normalizedItems);
const bookingItems = bookingSections.flatMap(section => section.items);
const uniqueCount = items => new Set(items.map(item => item.id)).size;
const actualSubcategories = normalizedCategories.flatMap(category =>
  category.subs.map(subcategory => subcategory.name));

const report = {
  adminItemCount: adminItems.length,
  customerItemCount: customerItems.length,
  bookingItemCount: bookingItems.length,
  canonicalUniqueItems: uniqueCount(canonicalItems),
  bookingUniqueItems: uniqueCount(bookingItems),
  adminUsesCanonicalSource: adminItems === canonicalItems,
  customerUsesCanonicalSource: customerItems === canonicalItems,
  categoryCount: normalizedCategories.length,
  uniqueCategoryCount: new Set(normalizedCategories.map(category => category.id)).size,
  subcategoryCount: actualSubcategories.length,
  subgroupItemsAlphabetical: bookingSections.every(section =>
    section.items.every((item, index) => index === 0
      || section.items[index - 1].name.localeCompare(item.name, 'en-NZ', { sensitivity: 'base' }) <= 0)),
  canonicalSorterAlphabetical: sortMenuItemsAlphabetically([...canonicalItems].reverse())
    .every((item, index, items) => index === 0
      || items[index - 1].title.localeCompare(item.title, 'en-NZ', { sensitivity: 'base', numeric: true }) <= 0),
  missingBookingItems: canonicalItems
    .filter(item => !bookingItems.some(bookingItem => bookingItem.id === item.id))
    .map(item => item.id),
  duplicateBookingItems: bookingItems
    .filter((item, index, items) => items.findIndex(candidate => candidate.id === item.id) !== index)
    .map(item => item.id),
};

console.log(JSON.stringify(report, null, 2));

const valid = report.adminItemCount === CANONICAL_MENU_ITEM_COUNT
  && report.customerItemCount === CANONICAL_MENU_ITEM_COUNT
  && report.bookingItemCount === CANONICAL_MENU_ITEM_COUNT
  && report.canonicalUniqueItems === CANONICAL_MENU_ITEM_COUNT
  && report.bookingUniqueItems === CANONICAL_MENU_ITEM_COUNT
  && report.adminUsesCanonicalSource
  && report.customerUsesCanonicalSource
  && report.categoryCount > 0
  && report.uniqueCategoryCount === report.categoryCount
  && report.subgroupItemsAlphabetical
  && report.canonicalSorterAlphabetical
  && report.missingBookingItems.length === 0
  && report.duplicateBookingItems.length === 0;

if (!valid) process.exitCode = 1;
