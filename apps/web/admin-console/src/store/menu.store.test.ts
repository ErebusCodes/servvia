import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MenuChannel } from './menu.store';

const apiMock = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../lib/api', () => ({ api: apiMock }));

// Imported after the mock so the store picks up the mocked `api`.
const { useMenuStore } = await import('./menu.store');

const backendCategory = {
  id: 'cat-1',
  name: 'Sides',
  description: null,
  imageUrl: null,
  sortOrder: 0,
  isActive: true,
  visibleChannels: ['order_tablet', 'customer_website', 'window_display'] as MenuChannel[],
};

const backendItem = {
  id: 'item-1',
  categoryId: 'cat-1',
  subCategory: null,
  title: 'Fries',
  description: 'Crispy golden fries.',
  imageUrl: '/menu-images/fries.jpg',
  priceCents: 1000,
  nutritionalDetails: { tags: ['GF', 'DF'], isFeatured: false },
  isSpicy: false,
  isAvailable: true,
  sortOrder: 0,
  visibleChannels: ['order_tablet', 'customer_website', 'window_display'] as MenuChannel[],
  isFeatured: false,
  posIdentity: null,
};

function resetStore() {
  useMenuStore.setState({
    categories: [], items: [], loading: false, loaded: false, error: null,
    resolvedCategories: [], resolvedItems: [], resolvedLoading: false, resolvedLoaded: false, resolvedError: null,
  });
  Object.values(apiMock).forEach((fn) => fn.mockReset());
}

/** Resolves once `resolve()` is called externally — lets a test control
 *  exactly when a mocked request "completes", independent of call order. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('useMenuStore (backend-backed, Phase 2)', () => {
  afterEach(() => {
    resetStore();
  });

  it('fetchMenu loads categories/items from the backend Menu API, not localStorage', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    apiMock.get.mockImplementation((url: string) => {
      if (url === '/api/admin/menu/categories') return Promise.resolve({ data: [backendCategory] });
      if (url === '/api/admin/menu/items') return Promise.resolve({ data: [backendItem] });
      throw new Error(`unexpected GET ${url}`);
    });

    await useMenuStore.getState().fetchMenu();

    const state = useMenuStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.error).toBeNull();
    expect(state.categories).toEqual([{ ...backendCategory, subs: [] }]);
    expect(state.items[0]).toMatchObject({ id: 'item-1', title: 'Fries', price: '10' });
    expect(apiMock.get).toHaveBeenCalledWith('/api/admin/menu/categories');
    expect(apiMock.get).toHaveBeenCalledWith('/api/admin/menu/items');
    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  it('fetchResolvedMenu calls the canonical order_tablet channel endpoint, not the old raw kiosk endpoint', async () => {
    apiMock.get.mockResolvedValue({ data: { categories: [backendCategory], menuItems: [backendItem] } });

    await useMenuStore.getState().fetchResolvedMenu('venue-1');

    expect(apiMock.get).toHaveBeenCalledWith('/api/menu/venues/venue-1/channel/order_tablet');
    expect(apiMock.get).not.toHaveBeenCalledWith(expect.stringContaining('/api/kiosk/'));
    expect(useMenuStore.getState().resolvedLoaded).toBe(true);
  });

  it('fetchMenu surfaces a real error instead of falling back to stale/fake data', async () => {
    apiMock.get.mockRejectedValue(new Error('network down'));

    await useMenuStore.getState().fetchMenu();

    const state = useMenuStore.getState();
    expect(state.loaded).toBe(false);
    expect(state.error).toBe('network down');
    expect(state.categories).toEqual([]);
    expect(state.items).toEqual([]);
  });

  it('setItems creates a new item via POST when its id is not already known', async () => {
    apiMock.post.mockResolvedValue({ data: { ...backendItem, id: 'server-generated-id' } });

    const draftItem = {
      id: 'local-temp-id',
      categoryId: 'cat-1',
      subCategory: null,
      title: 'Fries',
      description: 'Crispy golden fries.',
      imageUrl: '/menu-images/fries.jpg',
      price: '10',
      nutritionalDetails: { tags: ['GF', 'DF'], isFeatured: false },
      modifierGroups: [],
      isSpicy: false,
      isAvailable: true,
      sortOrder: 0,
      visibleChannels: [] as MenuChannel[],
      isFeatured: false,
      posIdentity: null,
    };

    await useMenuStore.getState().setItems([draftItem]);

    expect(apiMock.post).toHaveBeenCalledWith(
      '/api/admin/menu/items',
      expect.objectContaining({ title: 'Fries', priceCents: 1000, categoryId: 'cat-1' }),
    );
    // The store resolves to the server-assigned id, not the client temp id.
    expect(useMenuStore.getState().items[0].id).toBe('server-generated-id');
  });

  it('setItems sends only the changed fields via PATCH for an existing item', async () => {
    useMenuStore.setState({
      categories: [{ ...backendCategory, subs: [] }],
      items: [
        {
          id: 'item-1',
          categoryId: 'cat-1',
          subCategory: null,
          title: 'Fries',
          description: 'Crispy golden fries.',
          imageUrl: '/menu-images/fries.jpg',
          price: '10',
          nutritionalDetails: { tags: ['GF', 'DF'], isFeatured: false },
          modifierGroups: [],
          isSpicy: false,
          isAvailable: true,
          sortOrder: 0,
          visibleChannels: [] as MenuChannel[],
          isFeatured: false,
          posIdentity: null,
        },
      ],
      loading: false,
      loaded: true,
      error: null,
    });
    apiMock.patch.mockResolvedValue({ data: { ...backendItem, isAvailable: false } });

    await useMenuStore.getState().setItems([
      { ...useMenuStore.getState().items[0], isAvailable: false },
    ]);

    expect(apiMock.patch).toHaveBeenCalledWith('/api/admin/menu/items/item-1', { isAvailable: false });
    expect(useMenuStore.getState().items[0].isAvailable).toBe(false);
  });

  it('setItems deletes items missing from the next array via DELETE', async () => {
    useMenuStore.setState({
      categories: [],
      items: [
        {
          id: 'item-1',
          categoryId: 'cat-1',
          subCategory: null,
          title: 'Fries',
          description: 'x',
          imageUrl: null,
          price: '10',
          nutritionalDetails: {},
          modifierGroups: [],
          isSpicy: false,
          isAvailable: true,
          sortOrder: 0,
          visibleChannels: [] as MenuChannel[],
          isFeatured: false,
          posIdentity: null,
        },
      ],
      loading: false,
      loaded: true,
      error: null,
    });
    apiMock.delete.mockResolvedValue({ data: {} });

    await useMenuStore.getState().setItems([]);

    expect(apiMock.delete).toHaveBeenCalledWith('/api/admin/menu/items/item-1');
    expect(useMenuStore.getState().items).toEqual([]);
  });

  // Regression coverage for the historical Admin Menu Management
  // "disappearing items" bug: fetchMenu() (Menu Management, unresolved,
  // includes inactive categories) and fetchResolvedMenu() (Order Tablet,
  // venue-resolved, excludes inactive categories) used to share one set of
  // state fields. Whichever fetch's response landed LAST won, regardless of
  // which page the admin was actually looking at — so an admin viewing Menu
  // Management could have an in-flight Order Tablet fetch silently replace
  // their category/item list with the filtered, resolved one. These tests
  // prove that can no longer happen in either resolution order, by holding
  // each mocked request open until the test explicitly resolves it.
  describe('admin/resolved state isolation (regression)', () => {
    const inactiveCategory = { ...backendCategory, id: 'cat-2', name: 'Seasonal', isActive: false };

    it('a resolved fetch that lands AFTER an admin fetch does not overwrite admin state', async () => {
      const adminCats = deferred<{ data: typeof backendCategory[] }>();
      const adminItems = deferred<{ data: typeof backendItem[] }>();
      const resolvedResp = deferred<{ data: { categories: typeof backendCategory[]; menuItems: typeof backendItem[] } }>();

      apiMock.get.mockImplementation((url: string) => {
        if (url === '/api/admin/menu/categories') return adminCats.promise;
        if (url === '/api/admin/menu/items') return adminItems.promise;
        if (url.startsWith('/api/menu/venues/')) return resolvedResp.promise;
        throw new Error(`unexpected GET ${url}`);
      });

      // Order Tablet's fetch starts first (e.g. it was the previously
      // visited page)...
      const resolvedPromise = useMenuStore.getState().fetchResolvedMenu('venue-1');
      // ...then the admin navigates to Menu Management, starting a second,
      // independent fetch.
      const adminPromise = useMenuStore.getState().fetchMenu();

      // Admin's response lands first...
      adminCats.resolve({ data: [backendCategory, inactiveCategory] });
      adminItems.resolve({ data: [backendItem] });
      await adminPromise;

      // ...but the earlier, slower resolved-menu request only completes
      // now — after the admin is already looking at correct data.
      resolvedResp.resolve({ data: { categories: [backendCategory], menuItems: [backendItem] } });
      await resolvedPromise;

      const state = useMenuStore.getState();
      // Admin state must still reflect fetchMenu()'s response — both
      // categories, including the inactive one — never the resolved fetch's
      // filtered set.
      expect(state.categories).toHaveLength(2);
      expect(state.categories.some((c) => c.id === 'cat-2')).toBe(true);
      expect(state.loaded).toBe(true);
      // Resolved state is independently correct too.
      expect(state.resolvedCategories).toHaveLength(1);
      expect(state.resolvedLoaded).toBe(true);
    });

    it('an admin fetch that lands AFTER a resolved fetch does not overwrite resolved state', async () => {
      const adminCats = deferred<{ data: typeof backendCategory[] }>();
      const adminItems = deferred<{ data: typeof backendItem[] }>();
      const resolvedResp = deferred<{ data: { categories: typeof backendCategory[]; menuItems: typeof backendItem[] } }>();

      apiMock.get.mockImplementation((url: string) => {
        if (url === '/api/admin/menu/categories') return adminCats.promise;
        if (url === '/api/admin/menu/items') return adminItems.promise;
        if (url.startsWith('/api/menu/venues/')) return resolvedResp.promise;
        throw new Error(`unexpected GET ${url}`);
      });

      // Reverse order: Menu Management's fetch starts first...
      const adminPromise = useMenuStore.getState().fetchMenu();
      // ...then Order Tablet's fetch starts.
      const resolvedPromise = useMenuStore.getState().fetchResolvedMenu('venue-1');

      // Resolved fetch's response lands first this time...
      resolvedResp.resolve({ data: { categories: [backendCategory], menuItems: [backendItem] } });
      await resolvedPromise;

      // ...and the admin fetch only completes after.
      adminCats.resolve({ data: [backendCategory, inactiveCategory] });
      adminItems.resolve({ data: [backendItem] });
      await adminPromise;

      const state = useMenuStore.getState();
      expect(state.resolvedCategories).toHaveLength(1);
      expect(state.resolvedLoaded).toBe(true);
      expect(state.categories).toHaveLength(2);
      expect(state.categories.some((c) => c.id === 'cat-2')).toBe(true);
      expect(state.loaded).toBe(true);
    });
  });
});
