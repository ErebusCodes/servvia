export interface MenuItem {
  id: string;
  categoryId: string;
  title: string;
  description: string;
  imageUrl: string | null;
  imageThumbnailUrl: string | null;
  priceCents: number;
  isSpicy: boolean;
  isAvailable: boolean;
  sortOrder: number;
  subCategory?: string | null;
  modifierGroups?: ModifierGroup[];
}

export interface ModifierGroup {
  name: string;
  minSelections: number;
  maxSelections: number;
  modifiers: ModifierOption[];
}

export interface ModifierOption {
  name: string;
  priceDeltaCents: number;
  isDefault?: boolean;
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface CartItem {
  id: string; // derived unique id: e.g., itemId + modifiers hash
  menuItem: MenuItem;
  quantity: number;
  selectedModifiers: { name: string; priceDeltaCents: number }[];
  notes: string;
}
