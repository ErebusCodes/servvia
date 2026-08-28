import { create } from 'zustand';
import { api } from '../lib/api';

// ─────────────────────────────────── Types ──────────────────────────────────
//
// These shapes are the admin UI's menu model. They intentionally match what
// MenuManagementPage.tsx (and OrderTabletPage.tsx, which reads categories/
// items read-only) already expect, so this store's public interface didn't
// need to change when its data source moved from localStorage to the real
// backend Menu API (admin/menu/categories, admin/menu/items) — only what's
// inside setCategories/setItems changed, from "write straight to
// localStorage" to "diff against last-known server state and call the
// matching REST endpoint per changed row."

export interface CategorySub {
  id: string;
  name: string;
}

// Menu Management: which customer/staff-facing surfaces a Category or
// MenuItem may render on. Mirrors the backend Prisma `MenuChannel` enum
// exactly (order_tablet | customer_website | window_display) — never
// invent a UI-only casing/value here, since these strings round-trip
// straight to the API.
export type MenuChannel = 'order_tablet' | 'customer_website' | 'window_display';

export const ALL_MENU_CHANNELS: MenuChannel[] = [
  'order_tablet',
  'customer_website',
  'window_display',
];

export const MENU_CHANNEL_LABELS: Record<MenuChannel, string> = {
  order_tablet: 'Order Tablet',
  customer_website: 'Customer Website',
  window_display: 'Window Display',
};

/**
 * Read-only POS source identity for a linked MenuItem (Menu Management
 * architecture) — never editable as free text in this UI. The only way a
 * MenuItem gains or changes one of these is the guarded link/unlink
 * workflow on the POS Catalog Review page
 * (`apps/admin-console/src/pages/menu/PosCatalogReviewPage.tsx`).
 */
export interface PosIdentity {
  id: string;
  nativeCode: string;
  nativeDescription: string;
  lifecycleStatus:
    | 'pending_review'
    | 'active'
    | 'hidden'
    | 'unavailable'
    | 'source_missing'
    | 'source_inactive';
  confidenceTier:
    | 'high_confidence_active'
    | 'likely_active'
    | 'ambiguous'
    | 'takeaway_duplicate'
    | 'operational_non_menu'
    | 'inactive'
    | null;
  priceCentsFromPos: number | null;
  lastSyncedAt: string | null;
  descriptionDriftDetectedAt: string | null;
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  subs: CategorySub[];
  visibleChannels: MenuChannel[];
}

export interface NutritionalDetails {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  tags?: string[];
  allergens?: string[];
  isFeatured?: boolean;
  ingredients?: string[];
}

/**
 * Authoritative modifier shape (Story 15-3) — matches `docs/domain-model.md`
 * exactly and `apps/api/src/menu/dto/modifier-group.dto.ts`'s authoring
 * contract. Still embedded JSON on `MenuItem` server-side (DL-017), but
 * fully typed and ID-bearing end to end: real ids are what the Order
 * Tablet submits, never a name or a client-calculated price. `id` is
 * optional only while an author is building a brand-new group/option in
 * Menu Management before it's ever been saved — the server assigns one on
 * create if omitted, and every group/option the app reads back always has
 * one.
 */
export interface ModifierOption {
  id?: string;
  name: string;
  priceDeltaCents: number;
  isAvailable: boolean;
  sortOrder: number;
}

export interface ModifierGroup {
  id?: string;
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  options: ModifierOption[];
}

export interface MenuItem {
  id: string;
  categoryId: string;
  subCategory: string | null;
  title: string;
  description: string;
  imageUrl: string | null;
  price: string;
  nutritionalDetails: NutritionalDetails;
  modifierGroups: ModifierGroup[];
  isSpicy: boolean;
  isAvailable: boolean;
  sortOrder: number;
  preparationTime?: number;
  visibleChannels: MenuChannel[];
  // Promoted from the old nutritionalDetails.isFeatured JSON convention to
  // a real column — see MenuItem.isFeatured's own schema doc comment. This
  // UI reads/writes only this field going forward; it never writes
  // nutritionalDetails.isFeatured again (Phase E migrates old data).
  isFeatured: boolean;
  // Read-only — see the PosIdentity interface's own doc comment. Null
  // means this item has no linked POS candidate yet.
  posIdentity: PosIdentity | null;
}

// ── Backend row shapes (Prisma models, as returned by admin/menu/*) ─────────

interface BackendCategory {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  visibleChannels: MenuChannel[] | null;
}

interface BackendPosIdentity {
  id: string;
  nativeCode: string;
  nativeDescription: string;
  lifecycleStatus: PosIdentity['lifecycleStatus'];
  confidenceTier: PosIdentity['confidenceTier'];
  priceCentsFromPos: number | null;
  lastSyncedAt: string | null;
  descriptionDriftDetectedAt: string | null;
}

interface BackendMenuItem {
  id: string;
  categoryId: string;
  subCategory: string | null;
  title: string;
  description: string;
  imageUrl: string | null;
  priceCents: number;
  nutritionalDetails: NutritionalDetails | null;
  modifierGroups: ModifierGroup[] | null;
  isSpicy: boolean;
  isAvailable: boolean;
  sortOrder: number;
  visibleChannels: MenuChannel[] | null;
  isFeatured: boolean | null;
  posIdentity: BackendPosIdentity | null;
}

function priceToCents(price: string): number {
  const n = parseFloat(String(price).replace(/[^0-9.]/g, ''));
  return Math.round((isNaN(n) ? 0 : n) * 100);
}

function toStoreCategory(c: BackendCategory): Category {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    imageUrl: c.imageUrl,
    sortOrder: c.sortOrder,
    isActive: c.isActive,
    // The backend doesn't model sub-categories at the Category level (only
    // MenuItem.subCategory, a free-text grouping label) — the canonical menu
    // has never used this UI grouping feature, so it's always empty here.
    subs: [],
    visibleChannels: c.visibleChannels ?? [],
  };
}

function toStoreItem(i: BackendMenuItem): MenuItem {
  return {
    id: i.id,
    categoryId: i.categoryId,
    subCategory: i.subCategory,
    title: i.title,
    description: i.description,
    imageUrl: i.imageUrl,
    price: String((i.priceCents ?? 0) / 100),
    nutritionalDetails: i.nutritionalDetails ?? {},
    modifierGroups: i.modifierGroups ?? [],
    isSpicy: i.isSpicy,
    isAvailable: i.isAvailable,
    sortOrder: i.sortOrder,
    visibleChannels: i.visibleChannels ?? [],
    isFeatured: i.isFeatured ?? false,
    posIdentity: i.posIdentity
      ? {
          id: i.posIdentity.id,
          nativeCode: i.posIdentity.nativeCode,
          nativeDescription: i.posIdentity.nativeDescription,
          lifecycleStatus: i.posIdentity.lifecycleStatus,
          confidenceTier: i.posIdentity.confidenceTier,
          priceCentsFromPos: i.posIdentity.priceCentsFromPos,
          lastSyncedAt: i.posIdentity.lastSyncedAt,
          descriptionDriftDetectedAt: i.posIdentity.descriptionDriftDetectedAt,
        }
      : null,
  };
}

function sameChannels(a: MenuChannel[], b: MenuChannel[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((c) => setB.has(c));
}

function diffCategoryPatch(before: Category, after: Category): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (before.name !== after.name) patch.name = after.name;
  if (before.description !== after.description) patch.description = after.description;
  if (before.imageUrl !== after.imageUrl) patch.imageUrl = after.imageUrl;
  if (before.sortOrder !== after.sortOrder) patch.sortOrder = after.sortOrder;
  if (before.isActive !== after.isActive) patch.isActive = after.isActive;
  if (!sameChannels(before.visibleChannels, after.visibleChannels)) {
    patch.visibleChannels = after.visibleChannels;
  }
  return patch;
}

function diffItemPatch(before: MenuItem, after: MenuItem): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (before.title !== after.title) patch.title = after.title;
  if (before.description !== after.description) patch.description = after.description;
  if (before.categoryId !== after.categoryId) patch.categoryId = after.categoryId;
  if (priceToCents(before.price) !== priceToCents(after.price)) patch.priceCents = priceToCents(after.price);
  if ((before.subCategory ?? null) !== (after.subCategory ?? null)) patch.subCategory = after.subCategory;
  if ((before.imageUrl ?? null) !== (after.imageUrl ?? null)) patch.imageUrl = after.imageUrl;
  if (JSON.stringify(before.nutritionalDetails ?? {}) !== JSON.stringify(after.nutritionalDetails ?? {})) {
    patch.nutritionalDetails = after.nutritionalDetails;
  }
  if (before.isSpicy !== after.isSpicy) patch.isSpicy = after.isSpicy;
  if (before.isAvailable !== after.isAvailable) patch.isAvailable = after.isAvailable;
  if (before.sortOrder !== after.sortOrder) patch.sortOrder = after.sortOrder;
  if (JSON.stringify(before.modifierGroups ?? []) !== JSON.stringify(after.modifierGroups ?? [])) {
    patch.modifierGroups = after.modifierGroups;
  }
  if (!sameChannels(before.visibleChannels, after.visibleChannels)) {
    patch.visibleChannels = after.visibleChannels;
  }
  if (before.isFeatured !== after.isFeatured) patch.isFeatured = after.isFeatured;
  // posIdentity is deliberately never part of this diff/patch — it is
  // read-only here, managed exclusively by the guarded link/unlink
  // workflow on the POS Catalog Review page, never by a generic item save.
  return patch;
}

// ─────────────────────────────────── Store ──────────────────────────────────

interface MenuStoreState {
  categories: Category[];
  items: MenuItem[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  fetchMenu: () => Promise<void>;
  /** For ordering surfaces (Order Tablet): fetches the venue-resolved menu —
   *  the same GET /api/kiosk/venues/:venueId/menu endpoint window-display
   *  and customer-website use, which merges MenuItemVenueOverride pricing/
   *  availability server-side. fetchMenu() above reads the unresolved
   *  org-wide admin/menu/* endpoints instead — correct for Menu Management,
   *  which edits the base MenuItem/Category rows, not a venue's effective
   *  view of them.
   *
   *  Deliberately kept in SEPARATE state (resolvedCategories/resolvedItems
   *  below), not the categories/items fields above: the two endpoints are
   *  not equivalent — GET /api/admin/menu/categories returns every category
   *  regardless of isActive, while the kiosk endpoint filters isActive:true
   *  server-side, and MenuManagementPage.tsx's own fetchMenu() has no
   *  cancellation guard either. Sharing one set of fields let whichever of
   *  the two fetches happened to resolve last silently overwrite the other
   *  page's correct data — e.g. Order Tablet mounting first, its slower
   *  fetch landing after Menu Management's, and quietly dropping any
   *  inactive category (and anything an admin was doing with it) from view
   *  with no error. Keeping the two views in physically separate state
   *  makes that class of bug impossible regardless of mount order or
   *  timing, rather than papering over it with a cancellation token. */
  fetchResolvedMenu: (venueId: string) => Promise<void>;
  resolvedCategories: Category[];
  resolvedItems: MenuItem[];
  resolvedLoading: boolean;
  resolvedLoaded: boolean;
  resolvedError: string | null;
  /** Diffs `next` against the last-known server state and issues the
   *  matching create/update/delete calls to admin/menu/categories, then
   *  resolves store state to the server's response (never localStorage). */
  setCategories: (categories: Category[]) => Promise<void>;
  /** Same as setCategories, for admin/menu/items. */
  setItems: (items: MenuItem[]) => Promise<void>;
}

interface ResolvedMenuResponse {
  categories: BackendCategory[];
  menuItems: BackendMenuItem[];
}

export const useMenuStore = create<MenuStoreState>((set, get) => ({
  categories: [],
  items: [],
  loading: false,
  loaded: false,
  error: null,

  resolvedCategories: [],
  resolvedItems: [],
  resolvedLoading: false,
  resolvedLoaded: false,
  resolvedError: null,

  fetchMenu: async () => {
    set({ loading: true, error: null });
    try {
      const [categoriesRes, itemsRes] = await Promise.all([
        api.get<BackendCategory[]>('/api/admin/menu/categories'),
        api.get<BackendMenuItem[]>('/api/admin/menu/items'),
      ]);
      set({
        categories: categoriesRes.data.map(toStoreCategory).sort((a, b) => a.sortOrder - b.sortOrder),
        items: itemsRes.data.map(toStoreItem),
        loading: false,
        loaded: true,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load the menu from the server.',
      });
    }
  },

  fetchResolvedMenu: async (venueId) => {
    set({ resolvedLoading: true, resolvedError: null });
    try {
      const { data } = await api.get<ResolvedMenuResponse>(`/api/kiosk/venues/${venueId}/menu`);
      set({
        resolvedCategories: data.categories.map(toStoreCategory).sort((a, b) => a.sortOrder - b.sortOrder),
        resolvedItems: data.menuItems.map(toStoreItem),
        resolvedLoading: false,
        resolvedLoaded: true,
      });
    } catch (err) {
      set({
        resolvedLoading: false,
        resolvedError: err instanceof Error ? err.message : 'Failed to load the menu from the server.',
      });
    }
  },

  setCategories: async (next) => {
    const prev = get().categories;
    const prevById = new Map(prev.map((c) => [c.id, c]));
    const nextIds = new Set(next.map((c) => c.id));

    try {
      for (const category of prev) {
        if (!nextIds.has(category.id)) {
          await api.delete(`/api/admin/menu/categories/${category.id}`);
        }
      }

      const resolved: Category[] = [];
      for (const category of next) {
        const before = prevById.get(category.id);
        if (!before) {
          const { data } = await api.post<BackendCategory>('/api/admin/menu/categories', {
            name: category.name,
            description: category.description,
            imageUrl: category.imageUrl,
            sortOrder: category.sortOrder,
            isActive: category.isActive,
            visibleChannels: category.visibleChannels,
          });
          resolved.push(toStoreCategory(data));
          continue;
        }
        const patch = diffCategoryPatch(before, category);
        if (Object.keys(patch).length === 0) {
          resolved.push(before);
          continue;
        }
        const { data } = await api.patch<BackendCategory>(`/api/admin/menu/categories/${category.id}`, patch);
        resolved.push(toStoreCategory(data));
      }

      set({ categories: resolved.sort((a, b) => a.sortOrder - b.sortOrder) });
    } catch (err) {
      console.error('Failed to save category changes to the backend:', err);
      await get().fetchMenu(); // reconcile UI with actual server state
      throw err;
    }
  },

  setItems: async (next) => {
    const prev = get().items;
    const prevById = new Map(prev.map((i) => [i.id, i]));
    const nextIds = new Set(next.map((i) => i.id));

    try {
      for (const item of prev) {
        if (!nextIds.has(item.id)) {
          await api.delete(`/api/admin/menu/items/${item.id}`);
        }
      }

      const resolved: MenuItem[] = [];
      for (const item of next) {
        const before = prevById.get(item.id);
        if (!before) {
          const { data } = await api.post<BackendMenuItem>('/api/admin/menu/items', {
            title: item.title,
            description: item.description,
            categoryId: item.categoryId,
            priceCents: priceToCents(item.price),
            subCategory: item.subCategory,
            imageUrl: item.imageUrl,
            nutritionalDetails: item.nutritionalDetails,
            modifierGroups: item.modifierGroups,
            isSpicy: item.isSpicy,
            isAvailable: item.isAvailable,
            sortOrder: item.sortOrder,
            visibleChannels: item.visibleChannels,
            isFeatured: item.isFeatured,
          });
          resolved.push(toStoreItem(data));
          continue;
        }
        const patch = diffItemPatch(before, item);
        if (Object.keys(patch).length === 0) {
          resolved.push(before);
          continue;
        }
        const { data } = await api.patch<BackendMenuItem>(`/api/admin/menu/items/${item.id}`, patch);
        resolved.push(toStoreItem(data));
      }

      set({ items: resolved });
    } catch (err) {
      console.error('Failed to save menu item changes to the backend:', err);
      await get().fetchMenu(); // reconcile UI with actual server state
      throw err;
    }
  },
}));
