import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useMenuStore } from '../../store/menu.store';
import { resolveVenueId } from '../../store/reservation.store';
import {
  archiveAsset,
  associateMenuItem,
  uploadAndPublishMenuImage,
  ClientValidationError,
  UploadCancelledError,
  type UploadStage,
} from '../../lib/mediaAssets';

// ─────────────────────────────────── Types ──────────────────────────────────

interface CategorySub {
  id: string;
  name: string;
}

interface Category {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  subs: CategorySub[];
}

interface NutritionalDetails {
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

// Story 15-3: real, authoritative modifier authoring — mirrors
// menu.store.ts's exported ModifierGroup/ModifierOption exactly (and, in
// turn, docs/domain-model.md and apps/api/src/menu/dto/modifier-group.dto.ts).
// `id` is omitted only for a group/option an author is actively building
// that has never been saved yet — the server assigns one on create.
interface ModifierOption {
  id?: string;
  name: string;
  priceDeltaCents: number;
  isAvailable: boolean;
  sortOrder: number;
}

interface ModifierGroup {
  id?: string;
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  options: ModifierOption[];
}

interface MenuItem {
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
}

interface Toast {
  id: string;
  msg: string;
  type: 'success' | 'error';
}

interface ConfirmState {
  title: string;
  body: string;
  cta: string;
  onConfirm: () => void;
}

// ─────────────────────────────── Local storage ───────────────────────────────

function uid(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ─────────────────────────────── Seed data ───────────────────────────────────

import {
  compareMenuItemsAlphabetically,
} from '../../shared/menu/menuData';

// ─────────────────────────────── Draft shapes ────────────────────────────────

const ITEM_DEFAULTS = {
  title: '',
  description: '',
  categoryId: '',
  subCategory: '',
  priceInput: '',
  imageUrl: '',
  tags: [] as string[],
  allergens: [] as string[],
  isFeatured: false,
  isAvailable: true,
  ingredients: [] as string[],
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
  fiber: '',
  preparationTime: '10',
  modifierGroups: [] as ModifierGroup[],
  titleError: false,
};
type ItemDraft = typeof ITEM_DEFAULTS;

const CAT_DEFAULTS = {
  name: '',
  description: '',
  imageUrl: '',
  isActive: true,
  sortOrder: 0,
  nameError: false,
};
type CatDraft = typeof CAT_DEFAULTS;

// ──────────────────────────────── Constants ──────────────────────────────────

const DIETARY = [
  { label: 'V',   title: 'Vegetarian' },
  { label: 'VG',  title: 'Vegan' },
  { label: 'GF',  title: 'Gluten-free' },
  { label: 'DF',  title: 'Dairy-free' },
  { label: 'V+',  title: 'Vegetarian on request' },
  { label: 'VG+', title: 'Vegan on request' },
  { label: 'GF+', title: 'GF on request' },
  { label: 'DF+', title: 'DF on request' },
];
const ALLERGENS = ['Nuts', 'Dairy', 'Gluten', 'Eggs', 'Shellfish', 'Soy', 'Sesame', 'Fish'];
const NUTRI_FIELDS = [
  { key: 'calories' as const, label: 'KCAL' },
  { key: 'protein'  as const, label: 'PROTEIN' },
  { key: 'carbs'    as const, label: 'CARBS' },
  { key: 'fat'      as const, label: 'FAT' },
  { key: 'fiber'    as const, label: 'FIBER' },
];
const SWATCH_GRADIENTS = [
  'linear-gradient(135deg,#4ade80,#16a34a)',
  'linear-gradient(135deg,#fbbf24,#d97706)',
  'linear-gradient(135deg,#60a5fa,#2563eb)',
  'linear-gradient(135deg,#c084fc,#7c3aed)',
  'linear-gradient(135deg,#f87171,#dc2626)',
  'linear-gradient(135deg,#2dd4bf,#0d9488)',
  'linear-gradient(135deg,#fb923c,#ea580c)',
  'linear-gradient(135deg,#a3e635,#65a30d)',
];

// ──────────────────────────────── Helpers ────────────────────────────────────

function swatchFor(str: string): string {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) & 0x7fffffff;
  return SWATCH_GRADIENTS[h % SWATCH_GRADIENTS.length]!;
}

function formatMenuPrice(raw: string): string {
  if (!raw || raw === '0') return '—';
  // Add $ before bare numbers (not already preceded by $)
  return raw.replace(/(?<!\$)(\d+(?:\.\d+)?)/g, (_, num) => {
    const n = parseFloat(num);
    return '$' + (Number.isInteger(n) ? String(n) : n.toFixed(2));
  });
}

function getInitial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

// ──────────────────────────────── Toggle ─────────────────────────────────────

function Toggle({ checked, onChange, ariaLabel }: { checked: boolean; onChange: () => void; ariaLabel?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      className="relative rounded-full shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1"
      style={{ width: 36, height: 20 }}
    >
      <span className="absolute inset-0 rounded-full transition-colors duration-150" style={{ background: checked ? '#16a34a' : '#d1d5db' }} />
      <span className="absolute bg-white rounded-full shadow-sm transition-all duration-150" style={{ width: 16, height: 16, top: 2, left: checked ? 18 : 2 }} />
    </button>
  );
}

// ──────────────────────────────── ItemCard ───────────────────────────────────

interface ItemCardProps {
  item: MenuItem;
  selected: boolean;
  onToggleSel: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleAvail: () => void;
}

function ItemCard({ item, selected, onToggleSel, onEdit, onDelete, onToggleAvail }: ItemCardProps) {
  const swatch = item.imageUrl ? `url(${item.imageUrl})` : swatchFor(item.id);
  const tags = item.nutritionalDetails?.tags ?? [];
  const isFeatured = item.nutritionalDetails?.isFeatured ?? false;

  return (
    <div
      className="bg-white rounded-xl overflow-hidden flex flex-col transition-all duration-200"
      style={{
        border: `1px solid ${selected ? '#16a34a' : '#e5e7eb'}`,
        boxShadow: '0 1px 2px rgba(17,24,39,.05)',
        opacity: item.isAvailable ? 1 : 0.72,
      }}
    >
      {/* Image */}
      <div className="relative" style={{ height: 130, backgroundImage: swatch, backgroundSize: 'cover', backgroundPosition: 'center' }}>
        {!item.imageUrl && (
          <div className="absolute inset-0 flex items-center justify-center font-serif select-none" style={{ fontSize: 34, color: 'rgba(255,255,255,0.4)' }}>
            {getInitial(item.title)}
          </div>
        )}
        {/* Select */}
        <button
          type="button"
          onClick={onToggleSel}
          aria-label="Select item"
          className="absolute top-2.5 left-2.5 flex items-center justify-center text-white transition-colors"
          style={{
            width: 22, height: 22, borderRadius: 6,
            border: `1.5px solid ${selected ? '#16a34a' : 'rgba(255,255,255,0.8)'}`,
            background: selected ? '#16a34a' : 'rgba(255,255,255,0.15)',
            backdropFilter: 'blur(2px)',
          }}
        >
          {selected && (
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </button>
        {/* Badges */}
        <div className="absolute top-2.5 right-2.5 flex gap-1.5">
          {isFeatured && (
            <span className="flex items-center gap-1 text-white font-semibold px-1.5 py-0.5 rounded-full" style={{ fontSize: 10.5, background: 'rgba(217,119,6,.95)' }}>
              <svg width="11" height="11" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
              Featured
            </span>
          )}
          {!item.isAvailable && (
            <span className="text-white font-semibold px-2 py-0.5 rounded-full" style={{ fontSize: 10.5, background: 'rgba(17,24,39,.82)' }}>
              Unavailable
            </span>
          )}
        </div>
        {/* Edit FAB */}
        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit item"
          className="absolute right-3.5 -bottom-4 flex items-center justify-center rounded-full border border-gray-200 bg-white text-emerald-600 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 transition-colors"
          style={{ width: 36, height: 36, boxShadow: '0 2px 6px rgba(17,24,39,.14)' }}
        >
          <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-2 flex-1" style={{ padding: '22px 16px 16px' }}>
        <div className="flex items-start justify-between gap-2.5" style={{ paddingRight: 28 }}>
          <span className="font-semibold text-gray-900 leading-snug" style={{ fontSize: 14.5 }}>{item.title}</span>
          <span className="font-semibold text-gray-900 whitespace-nowrap font-mono shrink-0" style={{ fontSize: 13.5 }}>{formatMenuPrice(item.price)}</span>
        </div>
        {item.description && (
          <p className="text-gray-500 leading-relaxed line-clamp-2" style={{ fontSize: 12.5 }}>{item.description}</p>
        )}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map(t => (
              <span key={t} className="font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-1.5 py-0.5 tracking-wide" style={{ fontSize: 10 }}>{t}</span>
            ))}
          </div>
        )}
        {/* Footer */}
        <div className="mt-auto pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1.5 border border-gray-300 bg-white font-semibold text-gray-700 hover:bg-gray-50 hover:border-emerald-600 hover:text-emerald-700 transition-colors"
            style={{ height: 32, padding: '0 12px', borderRadius: 7, fontSize: 12.5 }}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Edit
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onToggleAvail} className="flex items-center gap-1.5 bg-transparent border-none cursor-pointer p-0">
              <span className="font-medium" style={{ fontSize: 11, color: item.isAvailable ? '#15803d' : '#9ca3af' }}>
                {item.isAvailable ? 'Available' : 'Unavailable'}
              </span>
              <Toggle checked={item.isAvailable} onChange={onToggleAvail} ariaLabel="Toggle availability" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              aria-label="Delete item"
              className="flex items-center justify-center bg-transparent border-none text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
              style={{ width: 30, height: 30, borderRadius: 7 }}
            >
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────── ItemDrawer ─────────────────────────────────

interface ItemDrawerProps {
  categories: Category[];
  draft: ItemDraft;
  setDraft: React.Dispatch<React.SetStateAction<ItemDraft>>;
  onSave: () => void;
  onClose: () => void;
  isEdit: boolean;
  editId: string | null;
}

// Truthful, user-facing label for every stage of the upload → finalize →
// publish → associate pipeline — never shows "uploaded" or "saved" before
// the corresponding server-side step has actually succeeded.
const STAGE_LABELS: Partial<Record<UploadStage, string>> = {
  validating: 'Checking file…',
  requesting_upload: 'Preparing upload…',
  uploading: 'Uploading…',
  finalizing: 'Verifying upload…',
  ready_for_publication: 'Publishing…',
  publishing: 'Publishing…',
};

const UPLOAD_BUSY_STAGES: UploadStage[] = [
  'validating',
  'requesting_upload',
  'uploading',
  'finalizing',
  'ready_for_publication',
  'publishing',
];

function ItemDrawer({ categories, draft, setDraft, onSave, onClose, isEdit, editId }: ItemDrawerProps) {
  const [ingInput, setIngInput] = useState('');
  const [imageStage, setImageStage] = useState<UploadStage>('idle');
  const [imageError, setImageError] = useState<string | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const uploadGenerationRef = useRef(0);
  const imageUploading = UPLOAD_BUSY_STAGES.includes(imageStage);

  // Revoke the object URL used for the instant local preview once it's no
  // longer needed, so selecting several images in a row doesn't leak blobs.
  useEffect(() => {
    return () => { if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl); };
  }, [localPreviewUrl]);

  // Cancel any in-flight upload if the drawer unmounts mid-flight (e.g. the
  // user navigates away) — the request-upload/finalize/publish sequence
  // must not keep running (or apply its result to unmounted state) after
  // the drawer is gone.
  useEffect(() => {
    return () => { uploadAbortRef.current?.abort(); };
  }, []);

  const activeCat = categories.find(c => c.id === draft.categoryId);
  const availableSubs = activeCat?.subs ?? [];

  const pickImage = () => fileInputRef.current?.click();

  const handleImageSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    // A newer selection always supersedes whatever upload was previously
    // in flight — cancel it and bump the generation so its eventual
    // resolution (success or failure) is ignored.
    uploadAbortRef.current?.abort();
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    const generation = ++uploadGenerationRef.current;
    const isStale = () => uploadGenerationRef.current !== generation;

    setImageError(null);
    const objectUrl = URL.createObjectURL(file);
    setLocalPreviewUrl(objectUrl);

    let venueId: string;
    try {
      venueId = await resolveVenueId();
    } catch {
      if (!isStale()) {
        setImageError('No venue is configured for this organization.');
        setImageStage('failed');
        setLocalPreviewUrl(null);
      }
      return;
    }

    try {
      const result = await uploadAndPublishMenuImage(
        file,
        { venueId, altText: draft.title || undefined, signal: controller.signal },
        (stage) => { if (!isStale()) setImageStage(stage); },
      );
      if (isStale()) return;

      // Existing item: go through the verified, audited association
      // endpoint so MenuItem.imageUrl is only ever written from a
      // server-confirmed published MediaAsset. New item: there's no
      // MenuItem row yet to associate against — the delivery URL from
      // publish is carried in the draft and included in the create
      // request when the drawer is saved.
      let finalUrl = result.publicUrl;
      if (isEdit && editId) {
        try {
          const associated = await associateMenuItem(result.mediaAssetId, editId, controller.signal);
          if (isStale()) return;
          finalUrl = associated.menuItem.imageUrl ?? result.publicUrl;
        } catch (associateErr) {
          // The asset is already published (publicly readable) at this
          // point — a failed association would otherwise leave it orphaned
          // indefinitely, referenced by nothing. Best-effort archive it so
          // it doesn't linger; never let a cleanup failure mask the real
          // error the user needs to see, and never treat cleanup itself as
          // success.
          archiveAsset(result.mediaAssetId).catch(() => {});
          throw associateErr;
        }
      }

      setDraft(d => ({ ...d, imageUrl: finalUrl }));
      setLocalPreviewUrl(null);
      setImageStage('published');
    } catch (err) {
      if (isStale()) return;
      setLocalPreviewUrl(null);
      if (err instanceof UploadCancelledError) {
        setImageStage('cancelled');
        return;
      }
      setImageStage('failed');
      if (err instanceof ClientValidationError) {
        setImageError(err.message);
      } else {
        // Never leak a raw provider/network error string to the user.
        setImageError('Upload failed. Please try again.');
      }
    }
  };

  const cancelUpload = () => {
    uploadAbortRef.current?.abort();
  };

  const clearImage = () => {
    uploadAbortRef.current?.abort();
    uploadGenerationRef.current += 1;
    setDraft(d => ({ ...d, imageUrl: '' }));
    setImageError(null);
    setImageStage('idle');
    setLocalPreviewUrl(null);
  };

  const toggleTag = (label: string) =>
    setDraft(d => ({ ...d, tags: d.tags.includes(label) ? d.tags.filter(t => t !== label) : [...d.tags, label] }));

  const toggleAllergen = (a: string) =>
    setDraft(d => ({ ...d, allergens: d.allergens.includes(a) ? d.allergens.filter(x => x !== a) : [...d.allergens, a] }));

  const addIng = () => {
    const v = ingInput.trim();
    if (v && !draft.ingredients.includes(v)) {
      setDraft(d => ({ ...d, ingredients: [...d.ingredients, v] }));
      setIngInput('');
    }
  };

  const removeIng = (v: string) => setDraft(d => ({ ...d, ingredients: d.ingredients.filter(i => i !== v) }));

  const handleIngKey = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); addIng(); } };

  // ── Modifier groups (Story 15-3) ──────────────────────────────────────────
  // Real, authoritative authoring — the server assigns a stable id to any
  // group/option saved without one (a new entry) and preserves any id
  // already present (an edit). Nothing here is invented menu content; it's
  // exactly what the person using this form types in.
  const addModifierGroup = () =>
    setDraft(d => ({
      ...d,
      modifierGroups: [
        ...d.modifierGroups,
        { name: '', required: false, minSelections: 0, maxSelections: 1, options: [] },
      ],
    }));

  const removeModifierGroup = (groupIdx: number) =>
    setDraft(d => ({ ...d, modifierGroups: d.modifierGroups.filter((_, i) => i !== groupIdx) }));

  const updateModifierGroup = (groupIdx: number, patch: Partial<ModifierGroup>) =>
    setDraft(d => ({
      ...d,
      modifierGroups: d.modifierGroups.map((g, i) => (i === groupIdx ? { ...g, ...patch } : g)),
    }));

  const addModifierOption = (groupIdx: number) =>
    setDraft(d => ({
      ...d,
      modifierGroups: d.modifierGroups.map((g, i) =>
        i === groupIdx
          ? { ...g, options: [...g.options, { name: '', priceDeltaCents: 0, isAvailable: true, sortOrder: g.options.length }] }
          : g,
      ),
    }));

  const removeModifierOption = (groupIdx: number, optionIdx: number) =>
    setDraft(d => ({
      ...d,
      modifierGroups: d.modifierGroups.map((g, i) =>
        i === groupIdx ? { ...g, options: g.options.filter((_, oi) => oi !== optionIdx) } : g,
      ),
    }));

  const updateModifierOption = (groupIdx: number, optionIdx: number, patch: Partial<ModifierOption>) =>
    setDraft(d => ({
      ...d,
      modifierGroups: d.modifierGroups.map((g, i) =>
        i === groupIdx
          ? { ...g, options: g.options.map((o, oi) => (oi === optionIdx ? { ...o, ...patch } : o)) }
          : g,
      ),
    }));

  const previewImage = localPreviewUrl || draft.imageUrl;
  const previewSwatch = previewImage ? `url(${previewImage})` : swatchFor(draft.title || 'item');
  const ic = "w-full border border-gray-300 rounded-[6px] px-3 text-[13.5px] outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/20 bg-white";
  const lc = "block text-[12px] font-semibold text-gray-700 mb-1.5";

  return (
    <>
      <div className="fixed inset-0 bg-gray-900/45 z-[60]" style={{ animation: 'mmFadeIn .15s ease' }} onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? 'Edit item' : 'Add item'}
        className="fixed top-0 right-0 bottom-0 bg-white z-[61] flex flex-col"
        style={{ width: 480, maxWidth: '94vw', boxShadow: '-8px 0 32px rgba(17,24,39,.18)', animation: 'mmDrawerIn .22s cubic-bezier(.16,1,.3,1)' }}
      >
        {/* Header */}
        <div className="flex-none px-[22px] py-[18px] border-b border-gray-200 flex items-center justify-between">
          <div>
            <div className="text-base font-semibold text-gray-900">{isEdit ? 'Edit item' : 'New item'}</div>
            <div className="text-[12px] text-gray-400 mt-0.5">Changes save to PostgreSQL</div>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-[7px] bg-gray-100 text-gray-500 flex items-center justify-center hover:bg-gray-200 transition-colors">
            <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-[22px] flex flex-col gap-5">
          {/* Image */}
          <div>
            <div className="text-[12px] font-semibold text-gray-700 mb-2">Item image</div>
            <div className="flex gap-3.5 items-start">
              <div
                className="rounded-[10px] shrink-0 flex items-center justify-center font-serif border border-gray-200 relative overflow-hidden"
                style={{ width: 118, height: 118, backgroundImage: previewSwatch, backgroundSize: 'cover', backgroundPosition: 'center', fontSize: 30, color: 'rgba(255,255,255,0.6)' }}
              >
                {!previewImage && getInitial(draft.title || '?')}
                {imageUploading && (
                  <div className="absolute inset-0 bg-gray-900/45 flex items-center justify-center text-white text-[11px] font-semibold text-center px-2">
                    {STAGE_LABELS[imageStage] ?? 'Working…'}
                  </div>
                )}
              </div>
              <div className="flex-1 flex flex-col gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleImageSelected}
                  className="hidden"
                  aria-label="Choose item image"
                />
                {/* Accessible status announcement — screen readers hear
                    each stage change without a visible layout shift. */}
                <div role="status" aria-live="polite" className="sr-only">
                  {imageUploading ? (STAGE_LABELS[imageStage] ?? 'Working…') : imageStage === 'published' ? 'Image published' : ''}
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={pickImage} disabled={imageUploading}
                    className="h-9 flex-1 border border-gray-300 rounded-md text-[12.5px] font-semibold text-gray-700 flex items-center justify-center hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                    {imageUploading ? (STAGE_LABELS[imageStage] ?? 'Working…') : draft.imageUrl ? 'Replace image' : 'Upload image'}
                  </button>
                  {imageUploading ? (
                    <button type="button" onClick={cancelUpload}
                      className="h-9 px-3 border border-gray-200 rounded-md text-[12.5px] text-gray-500 flex items-center justify-center hover:bg-gray-50 transition-colors">
                      Cancel
                    </button>
                  ) : draft.imageUrl && (
                    <button type="button" onClick={clearImage}
                      className="h-9 px-3 border border-gray-200 rounded-md text-[12.5px] text-gray-500 flex items-center justify-center hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors">
                      Remove
                    </button>
                  )}
                </div>
                <input
                  type="url"
                  value={draft.imageUrl}
                  onChange={e => setDraft(d => ({ ...d, imageUrl: e.target.value }))}
                  placeholder="or paste an image URL (https://…)"
                  disabled={imageUploading}
                  aria-label="Item image URL"
                  className={`${ic} h-9 disabled:opacity-50 disabled:cursor-not-allowed`}
                />
                {imageError ? (
                  <p className="text-[11px] text-red-600 leading-relaxed" role="alert">{imageError}</p>
                ) : (
                  <p className="text-[11px] text-gray-400 leading-relaxed">JPG, PNG, or WebP, up to 5MB. Uploaded images are reviewed and published automatically before saving.</p>
                )}
              </div>
            </div>
          </div>

          <div className="h-px bg-gray-100" />

          {/* Core fields */}
          <div className="flex flex-col gap-3.5">
            <div>
              <label className={lc}>Item name <span className="text-red-600">*</span></label>
              <input type="text" value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value, titleError: false }))}
                placeholder="e.g. Bread and Dips"
                className={`${ic} h-[38px] ${draft.titleError ? 'border-red-500' : ''}`} />
              {draft.titleError && <p className="text-[11px] text-red-600 mt-1">Name is required.</p>}
            </div>
            <div>
              <label className={lc}>Description</label>
              <textarea value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                rows={3} placeholder="Short, appetizing description shown on the menu"
                className="w-full border border-gray-300 rounded-[6px] px-3 py-2 text-[13.5px] outline-none resize-y leading-relaxed focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/20" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={lc}>Price</label>
                <input
                  type="text"
                  value={draft.priceInput}
                  onChange={e => setDraft(d => ({ ...d, priceInput: e.target.value }))}
                  placeholder="e.g. 16, from 18, 34 / 37 / 37"
                  className={`${ic} h-[38px] font-mono`}
                />
              </div>
              <div>
                <label className={lc}>Prep time (m)</label>
                <input
                  type="number"
                  min={1}
                  value={draft.preparationTime}
                  onChange={e => setDraft(d => ({ ...d, preparationTime: e.target.value }))}
                  placeholder="e.g. 10"
                  className={`${ic} h-[38px] font-mono`}
                />
              </div>
              <div>
                <label className={lc}>Category</label>
                <select
                  value={draft.categoryId}
                  onChange={e => setDraft(d => ({ ...d, categoryId: e.target.value, subCategory: '' }))}
                  className={`${ic} h-[38px] cursor-pointer`}
                >
                  <option value="">Select…</option>
                  {categories.filter(c => c.isActive).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={lc}>Sub-section <span className="text-[11px] font-normal text-gray-400">(optional)</span></label>
              {availableSubs.length > 0 ? (
                <select
                  value={draft.subCategory}
                  onChange={e => setDraft(d => ({ ...d, subCategory: e.target.value }))}
                  className={`${ic} h-[38px] cursor-pointer`}
                >
                  <option value="">None</option>
                  {availableSubs.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              ) : (
                <input type="text" value={draft.subCategory} onChange={e => setDraft(d => ({ ...d, subCategory: e.target.value }))}
                  placeholder="e.g. Sharing plates" className={`${ic} h-[38px]`} />
              )}
            </div>
          </div>

          {/* Dietary tags */}
          <div>
            <label className={lc}>Dietary tags</label>
            <div className="flex flex-wrap gap-1.5">
              {DIETARY.map(({ label, title }) => {
                const active = draft.tags.includes(label);
                return (
                  <button key={label} type="button" title={title} onClick={() => toggleTag(label)}
                    className="font-semibold px-2.5 py-1 rounded-[6px] cursor-pointer transition-colors text-xs"
                    style={{ background: active ? '#f0fdf4' : '#f9fafb', color: active ? '#15803d' : '#374151', border: `1px solid ${active ? '#86efac' : '#e5e7eb'}` }}>
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="text-[10.5px] text-gray-400 mt-2 leading-relaxed">V vegetarian · VG vegan · GF gluten-free · DF dairy-free · + available on request</p>
          </div>

          <div className="h-px bg-gray-100" />

          {/* Toggles */}
          <div className="flex flex-col gap-2.5">
            {[
              { key: 'isAvailable' as const, label: 'Available', sub: 'Unavailable items are dimmed & non-orderable on the menu' },
              { key: 'isFeatured' as const, label: 'Featured item', sub: 'Highlighted with a badge on the menu' },
            ].map(({ key, label, sub }) => (
              <button key={key} type="button" onClick={() => setDraft(d => ({ ...d, [key]: !d[key] }))}
                className="flex items-center gap-3 px-3.5 py-3 border border-gray-200 rounded-lg bg-white cursor-pointer text-left hover:bg-gray-50 transition-colors">
                <Toggle checked={draft[key]} onChange={() => setDraft(d => ({ ...d, [key]: !d[key] }))} ariaLabel={label} />
                <span className="flex-1">
                  <span className="block text-[13.5px] font-semibold text-gray-900">{label}</span>
                  <span className="block text-[11.5px] text-gray-400">{sub}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="h-px bg-gray-100" />

          {/* Ingredients */}
          <div>
            <label className={lc}>Ingredients</label>
            {draft.ingredients.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {draft.ingredients.map(ing => (
                  <span key={ing} className="inline-flex items-center gap-1 bg-gray-100 border border-gray-200 rounded-[6px] pl-2.5 pr-1 py-1 text-[12.5px] text-gray-700">
                    {ing}
                    <button type="button" onClick={() => removeIng(ing)} className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-red-600 border-none bg-transparent cursor-pointer">
                      <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input type="text" value={ingInput} onChange={e => setIngInput(e.target.value)} onKeyDown={handleIngKey}
              placeholder="Type an ingredient, press Enter" className={`${ic} h-9`} />
          </div>

          {/* Nutritional info */}
          <div>
            <label className={lc}>Nutritional information</label>
            <div className="grid grid-cols-5 gap-2">
              {NUTRI_FIELDS.map(({ key, label }) => (
                <div key={key}>
                  <input type="text" inputMode="numeric" value={draft[key]}
                    onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
                    className="w-full h-9 border border-gray-300 rounded-[6px] px-2 text-[13px] text-center outline-none font-mono focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/20" />
                  <div className="text-[10px] text-gray-400 text-center mt-1 tracking-wide">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Allergens */}
          <div>
            <label className={lc}>Allergens</label>
            <div className="flex flex-wrap gap-1.5">
              {ALLERGENS.map(a => {
                const active = draft.allergens.includes(a);
                return (
                  <button key={a} type="button" onClick={() => toggleAllergen(a)}
                    className="text-xs font-medium px-2.5 py-1 rounded-full cursor-pointer transition-colors"
                    style={{ background: active ? '#fef2f2' : '#f9fafb', color: active ? '#dc2626' : '#374151', border: `1px solid ${active ? '#fecaca' : '#e5e7eb'}` }}>
                    {a}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Modifier groups (Story 15-3) — real, authoritative data the
              Order Tablet reads directly; nothing here is inferred from
              the item's name/category. */}
          <div>
            <label className={lc}>Modifier groups</label>
            <div className="space-y-3">
              {draft.modifierGroups.map((group, groupIdx) => (
                <div key={group.id ?? `new-${groupIdx}`} className="border border-gray-200 rounded-[8px] p-3 space-y-2.5 bg-gray-50">
                  <div className="flex gap-2 items-start">
                    <input type="text" value={group.name} placeholder="Group name (e.g. Sauce)"
                      onChange={e => updateModifierGroup(groupIdx, { name: e.target.value })}
                      className={`${ic} h-9 flex-1`} />
                    <button type="button" onClick={() => removeModifierGroup(groupIdx)}
                      className="h-9 px-2.5 rounded-[6px] border border-gray-300 bg-white text-[12px] text-gray-500 hover:text-red-600 hover:border-red-300 transition-colors">
                      Remove group
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-3 items-center text-[12.5px] text-gray-700">
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={group.required}
                        onChange={e => updateModifierGroup(groupIdx, { required: e.target.checked })} />
                      Required
                    </label>
                    <label className="flex items-center gap-1.5">
                      Min
                      <input type="number" min={0} value={group.minSelections}
                        onChange={e => updateModifierGroup(groupIdx, { minSelections: Math.max(0, Number(e.target.value) || 0) })}
                        className="w-14 h-8 border border-gray-300 rounded-[6px] px-2 text-[12.5px] outline-none" />
                    </label>
                    <label className="flex items-center gap-1.5">
                      Max
                      <input type="number" min={1} value={group.maxSelections}
                        onChange={e => updateModifierGroup(groupIdx, { maxSelections: Math.max(1, Number(e.target.value) || 1) })}
                        className="w-14 h-8 border border-gray-300 rounded-[6px] px-2 text-[12.5px] outline-none" />
                    </label>
                  </div>

                  <div className="space-y-1.5">
                    {group.options.map((option, optionIdx) => (
                      <div key={option.id ?? `new-${optionIdx}`} className="flex gap-2 items-center">
                        <input type="text" value={option.name} placeholder="Option name"
                          onChange={e => updateModifierOption(groupIdx, optionIdx, { name: e.target.value })}
                          className={`${ic} h-8 flex-1`} />
                        <div className="flex items-center gap-1">
                          <span className="text-[12px] text-gray-400">$</span>
                          {/* Deliberately uncontrolled (defaultValue, commit
                              on blur, not onChange): a controlled input that
                              reformats to .toFixed(2) on every keystroke eats
                              a user's own decimal point / trailing zero as
                              they type (e.g. typing "0.5" round-trips
                              through 0 -> "0.00" before "5" ever lands) —
                              found via real browser testing, not a
                              hypothetical. defaultValue is safe here because
                              each option row has a stable `key`. */}
                          <input type="number" step="0.01" min={0}
                            defaultValue={(option.priceDeltaCents / 100).toFixed(2)}
                            onBlur={e => updateModifierOption(groupIdx, optionIdx, {
                              priceDeltaCents: Math.max(0, Math.round((Number(e.target.value) || 0) * 100)),
                            })}
                            className="w-20 h-8 border border-gray-300 rounded-[6px] px-2 text-[12.5px] outline-none" />
                        </div>
                        <label className="flex items-center gap-1 text-[12px] text-gray-600 whitespace-nowrap">
                          <input type="checkbox" checked={option.isAvailable}
                            onChange={e => updateModifierOption(groupIdx, optionIdx, { isAvailable: e.target.checked })} />
                          Available
                        </label>
                        <button type="button" onClick={() => removeModifierOption(groupIdx, optionIdx)}
                          className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-600 border-none bg-transparent cursor-pointer">
                          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={() => addModifierOption(groupIdx)}
                      className="text-[12px] font-medium text-emerald-700 hover:text-emerald-800">
                      + Add option
                    </button>
                  </div>
                </div>
              ))}
              <button type="button" onClick={addModifierGroup}
                className="text-[12.5px] font-medium text-emerald-700 hover:text-emerald-800">
                + Add modifier group
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex-none px-[22px] py-3.5 border-t border-gray-200 flex gap-2.5">
          <button type="button" onClick={onClose}
            className="h-10 px-[18px] rounded-[6px] border border-gray-300 bg-white text-[13.5px] font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button type="button" onClick={onSave} disabled={imageUploading}
            className="flex-1 h-10 rounded-[6px] bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[13.5px] flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {imageUploading ? 'Waiting for image…' : isEdit ? 'Save changes' : 'Add item'}
          </button>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────── CategoryDrawer ──────────────────────────────

interface CatDrawerProps {
  draft: CatDraft;
  setDraft: React.Dispatch<React.SetStateAction<CatDraft>>;
  onSave: () => void;
  onClose: () => void;
  isEdit: boolean;
}

function CategoryDrawer({ draft, setDraft, onSave, onClose, isEdit }: CatDrawerProps) {
  const previewSwatch = draft.imageUrl ? `url(${draft.imageUrl})` : swatchFor(draft.name || 'cat');
  const ic = "w-full h-[38px] border border-gray-300 rounded-[6px] px-3 text-[13.5px] outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/20 bg-white";
  const lc = "block text-[12px] font-semibold text-gray-700 mb-1.5";

  return (
    <>
      <div className="fixed inset-0 bg-gray-900/45 z-[60]" style={{ animation: 'mmFadeIn .15s ease' }} onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? 'Edit category' : 'Add category'}
        className="fixed top-0 right-0 bottom-0 bg-white z-[61] flex flex-col"
        style={{ width: 420, maxWidth: '94vw', boxShadow: '-8px 0 32px rgba(17,24,39,.18)', animation: 'mmDrawerIn .22s cubic-bezier(.16,1,.3,1)' }}
      >
        <div className="flex-none px-[22px] py-[18px] border-b border-gray-200 flex items-center justify-between">
          <div className="text-base font-semibold text-gray-900">{isEdit ? `Edit "${draft.name}"` : 'New category'}</div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-[7px] bg-gray-100 text-gray-500 flex items-center justify-center hover:bg-gray-200 transition-colors">
            <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-[22px] flex flex-col gap-[18px]">
          {/* Image */}
          <div>
            <div className="text-[12px] font-semibold text-gray-700 mb-2">Category icon / image</div>
            <div className="flex gap-3.5 items-center">
              <div className="rounded-[10px] shrink-0 flex items-center justify-center font-serif border border-gray-200"
                style={{ width: 72, height: 72, backgroundImage: previewSwatch, backgroundSize: 'cover', backgroundPosition: 'center', fontSize: 24, color: 'rgba(255,255,255,0.7)' }}>
                {!draft.imageUrl && getInitial(draft.name || '?')}
              </div>
              <input type="url" value={draft.imageUrl} onChange={e => setDraft(d => ({ ...d, imageUrl: e.target.value }))}
                placeholder="Image URL (https://…)" className={ic} />
            </div>
          </div>

          <div>
            <label className={lc}>Category name <span className="text-red-600">*</span></label>
            <input type="text" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value, nameError: false }))}
              placeholder="e.g. Temptation"
              className={`${ic} ${draft.nameError ? 'border-red-500' : ''}`} />
            {draft.nameError && <p className="text-[11px] text-red-600 mt-1">Name is required.</p>}
          </div>

          <div>
            <label className={lc}>Description</label>
            <input type="text" value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
              placeholder="Optional helper line" className={ic} />
          </div>

          <div>
            <label className={lc}>Sort order</label>
            <input type="number" value={draft.sortOrder} min={0}
              onChange={e => setDraft(d => ({ ...d, sortOrder: parseInt(e.target.value, 10) || 0 }))}
              className={ic} />
          </div>

          <button type="button" onClick={() => setDraft(d => ({ ...d, isActive: !d.isActive }))}
            className="flex items-center gap-3 px-3.5 py-3 border border-gray-200 rounded-lg bg-white cursor-pointer text-left hover:bg-gray-50 transition-colors">
            <Toggle checked={draft.isActive} onChange={() => setDraft(d => ({ ...d, isActive: !d.isActive }))} ariaLabel="Category enabled" />
            <span className="flex-1">
              <span className="block text-[13.5px] font-semibold text-gray-900">Enabled</span>
              <span className="block text-[11.5px] text-gray-400">Hidden categories won't appear on the public menu</span>
            </span>
          </button>
        </div>

        <div className="flex-none px-[22px] py-3.5 border-t border-gray-200 flex justify-end gap-2.5">
          <button type="button" onClick={onClose}
            className="h-10 px-[18px] rounded-[6px] border border-gray-300 bg-white text-[13.5px] font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button type="button" onClick={onSave}
            className="h-10 px-[18px] rounded-[6px] bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[13.5px] transition-colors">
            {isEdit ? 'Save changes' : 'Add category'}
          </button>
        </div>
      </div>
    </>
  );
}

// ──────────────────────────────── ConfirmDialog ──────────────────────────────

function ConfirmDialog({ state, onClose }: { state: ConfirmState; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 bg-gray-900/45 z-[70]" style={{ animation: 'mmFadeIn .15s ease' }} onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-[71] flex items-center justify-center p-5 pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          onClick={e => e.stopPropagation()}
          className="w-[400px] max-w-full bg-white rounded-xl pointer-events-auto"
          style={{ boxShadow: '0 24px 48px -8px rgba(17,24,39,.3)', padding: 24, animation: 'mmModalIn .2s cubic-bezier(.16,1,.3,1)' }}
        >
          <div className="w-[42px] h-[42px] rounded-full bg-red-50 flex items-center justify-center text-red-600 mb-3.5">
            <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </div>
          <div className="text-base font-semibold text-gray-900 mb-1.5">{state.title}</div>
          <div className="text-[13.5px] text-gray-500 leading-relaxed mb-5">{state.body}</div>
          <div className="flex gap-2.5 justify-end">
            <button type="button" onClick={onClose}
              className="h-[38px] px-4 rounded-[6px] border border-gray-300 bg-white text-[13.5px] font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="button" onClick={state.onConfirm}
              className="h-[38px] px-4 rounded-[6px] bg-red-600 hover:bg-red-700 text-white text-[13.5px] font-semibold transition-colors">
              {state.cta}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ────────────────────────────────── ToastList ────────────────────────────────

function ToastList({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed right-[22px] bottom-[22px] z-[80] flex flex-col gap-2.5 items-end pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className="flex items-center gap-2.5 bg-white rounded-[10px] pointer-events-auto"
          style={{
            border: `1px solid ${t.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
            borderLeft: `3px solid ${t.type === 'success' ? '#16a34a' : '#dc2626'}`,
            boxShadow: '0 8px 16px -4px rgba(17,24,39,.12)',
            padding: '12px 14px',
            minWidth: 260,
            maxWidth: 360,
            animation: 'mmToastIn .22s cubic-bezier(.16,1,.3,1)',
          }}
        >
          <span className="w-6 h-6 rounded-[7px] shrink-0 flex items-center justify-center"
            style={{ background: t.type === 'success' ? '#f0fdf4' : '#fef2f2', color: t.type === 'success' ? '#16a34a' : '#dc2626' }}>
            {t.type === 'success'
              ? <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              : <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            }
          </span>
          <span className="flex-1 text-[13px] text-gray-900 leading-snug">{t.msg}</span>
          <button type="button" onClick={() => onDismiss(t.id)}
            className="w-[22px] h-[22px] border-none bg-transparent text-gray-400 flex items-center justify-center hover:text-gray-700 transition-colors cursor-pointer">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

// ──────────────────────── SubGroupedGrid ─────────────────────────────────────

interface SubGroupedGridProps {
  cat: Category;
  items: MenuItem[];
  selectedIds: Set<string>;
  onToggleSel: (id: string) => void;
  onEdit: (item: MenuItem) => void;
  onDelete: (item: MenuItem) => void;
  onToggleAvail: (item: MenuItem) => void;
}

function SubGroupedGrid({ cat, items, selectedIds, onToggleSel, onEdit, onDelete, onToggleAvail }: SubGroupedGridProps) {
  const groups: { label: string; rows: MenuItem[] }[] = [];

  if (cat.subs.length > 0) {
    for (const sub of cat.subs) {
      const rows = items.filter(i => i.subCategory === sub.name);
      if (rows.length) groups.push({ label: sub.name, rows });
    }
    // Items with no matching sub (e.g. user-added without sub)
    const matched = new Set(cat.subs.map(s => s.name));
    const orphans = items.filter(i => !i.subCategory || !matched.has(i.subCategory));
    if (orphans.length) groups.push({ label: 'Other', rows: orphans });
  } else {
    groups.push({ label: '', rows: items });
  }

  return (
    <div className="flex flex-col gap-8">
      {groups.map(({ label, rows }) => (
        <div key={label}>
          {label && (
            <div className="flex items-center gap-3 mb-4">
              <span className="text-[12px] font-bold text-gray-500 tracking-widest uppercase">{label}</span>
              <span className="text-[11px] text-gray-400 font-medium bg-gray-100 rounded-full px-2 py-0.5 font-mono">{rows.length}</span>
              <div className="flex-1 h-px bg-gray-100" />
            </div>
          )}
          <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(268px,1fr))' }}>
            {rows.map(item => (
              <ItemCard
                key={item.id}
                item={item}
                selected={selectedIds.has(item.id)}
                onToggleSel={() => onToggleSel(item.id)}
                onEdit={() => onEdit(item)}
                onDelete={() => onDelete(item)}
                onToggleAvail={() => onToggleAvail(item)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────── MenuManagementPage ─────────────────────────────

export function MenuManagementPage() {
  const categories = useMenuStore((s) => s.categories);
  const items = useMenuStore((s) => s.items);
  const setCategories = useMenuStore((s) => s.setCategories);
  const setItems = useMenuStore((s) => s.setItems);
  const fetchMenu = useMenuStore((s) => s.fetchMenu);
  const menuLoading = useMenuStore((s) => s.loading);
  const menuLoaded = useMenuStore((s) => s.loaded);
  const menuError = useMenuStore((s) => s.error);

  useEffect(() => {
    fetchMenu();
  }, [fetchMenu]);

  const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);

  const [activeCatId, setActiveCatId] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [itemDrawer, setItemDrawer] = useState<{ open: boolean; editId: string | null }>({ open: false, editId: null });
  const [itemDraft, setItemDraft] = useState<ItemDraft>({ ...ITEM_DEFAULTS });

  const [catDrawer, setCatDrawer] = useState<{ open: boolean; editId: string | null }>({ open: false, editId: null });
  const [catDraft, setCatDraft] = useState<CatDraft>({ ...CAT_DEFAULTS });

  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // ── Persist helpers ───────────────────────────────────────────────────────

  const persistItems = (next: MenuItem[]) => { setItems(next); };
  const persistCats  = (next: Category[]) => { setCategories(next); };

  // ── Toast helpers ─────────────────────────────────────────────────────────

  const addToast = (msg: string, type: Toast['type'] = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  };
  const dismissToast = (id: string) => setToasts(t => t.filter(x => x.id !== id));

  // ── Derived data ──────────────────────────────────────────────────────────

  const viewItems = (activeCatId === 'all' ? items : items.filter(i => i.categoryId === activeCatId))
    .slice()
    .sort(compareMenuItemsAlphabetically);
  const activeCat = sorted.find(c => c.id === activeCatId) ?? null;
  const useGrouped = activeCatId !== 'all' && !!activeCat && activeCat.subs.length > 0;

  // ── Item handlers ─────────────────────────────────────────────────────────

  const toggleSel = (id: string) => setSelectedIds(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const openNewItem = () => {
    const defaultCatId = activeCatId !== 'all' ? activeCatId : (sorted.find(c => c.isActive)?.id ?? '');
    setItemDraft({ ...ITEM_DEFAULTS, categoryId: defaultCatId });
    setItemDrawer({ open: true, editId: null });
  };

  const openEditItem = (item: MenuItem) => {
    const nd = item.nutritionalDetails ?? {};
    setItemDraft({
      title: item.title,
      description: item.description,
      categoryId: item.categoryId,
      subCategory: item.subCategory ?? '',
      priceInput: item.price,
      imageUrl: item.imageUrl ?? '',
      tags: nd.tags ?? [],
      allergens: nd.allergens ?? [],
      isFeatured: nd.isFeatured ?? false,
      isAvailable: item.isAvailable,
      ingredients: nd.ingredients ?? [],
      calories: nd.calories != null ? String(nd.calories) : '',
      protein: nd.protein != null ? String(nd.protein) : '',
      carbs: nd.carbs != null ? String(nd.carbs) : '',
      fat: nd.fat != null ? String(nd.fat) : '',
      fiber: nd.fiber != null ? String(nd.fiber) : '',
      preparationTime: item.preparationTime != null ? String(item.preparationTime) : '10',
      modifierGroups: item.modifierGroups ?? [],
      titleError: false,
    });
    setItemDrawer({ open: true, editId: item.id });
  };

  const saveItem = () => {
    if (!itemDraft.title.trim()) { setItemDraft(d => ({ ...d, titleError: true })); return; }
    const nd: NutritionalDetails = {
      tags: itemDraft.tags,
      allergens: itemDraft.allergens,
      isFeatured: itemDraft.isFeatured,
      ingredients: itemDraft.ingredients,
      ...(itemDraft.calories ? { calories: Number(itemDraft.calories) } : {}),
      ...(itemDraft.protein  ? { protein:  Number(itemDraft.protein)  } : {}),
      ...(itemDraft.carbs    ? { carbs:    Number(itemDraft.carbs)    } : {}),
      ...(itemDraft.fat      ? { fat:      Number(itemDraft.fat)      } : {}),
      ...(itemDraft.fiber    ? { fiber:    Number(itemDraft.fiber)    } : {}),
    };
    const fields = {
      title: itemDraft.title.trim(),
      description: itemDraft.description.trim() || ' ',
      categoryId: itemDraft.categoryId || (sorted[0]?.id ?? ''),
      subCategory: itemDraft.subCategory.trim() || null,
      price: itemDraft.priceInput.trim() || '0',
      imageUrl: itemDraft.imageUrl.trim() || null,
      isAvailable: itemDraft.isAvailable,
      nutritionalDetails: nd,
      preparationTime: Number(itemDraft.preparationTime) || 10,
      modifierGroups: itemDraft.modifierGroups,
    };

    if (itemDrawer.editId) {
      persistItems(items.map(i => i.id === itemDrawer.editId ? { ...i, ...fields } : i));
      addToast('Item saved');
    } else {
      const newItem: MenuItem = { id: uid(), isSpicy: false, sortOrder: items.length, ...fields };
      persistItems([...items, newItem]);
      addToast('Item added');
    }
    setItemDrawer({ open: false, editId: null });
  };

  const deleteItem = (id: string) => {
    persistItems(items.filter(i => i.id !== id));
    setConfirm(null);
    setSelectedIds(s => { const n = new Set(s); n.delete(id); return n; });
    addToast('Item deleted');
  };

  const toggleAvail = (item: MenuItem) => {
    persistItems(items.map(i => i.id === item.id ? { ...i, isAvailable: !i.isAvailable } : i));
  };

  // ── Category handlers ─────────────────────────────────────────────────────

  const openNewCat = () => {
    setCatDraft({ ...CAT_DEFAULTS, sortOrder: sorted.length });
    setCatDrawer({ open: true, editId: null });
  };

  const openEditCat = (cat: Category) => {
    setCatDraft({ name: cat.name, description: cat.description ?? '', imageUrl: cat.imageUrl ?? '', isActive: cat.isActive, sortOrder: cat.sortOrder, nameError: false });
    setCatDrawer({ open: true, editId: cat.id });
  };

  const saveCat = () => {
    if (!catDraft.name.trim()) { setCatDraft(d => ({ ...d, nameError: true })); return; }
    const fields = {
      name: catDraft.name.trim(),
      description: catDraft.description.trim() || null,
      imageUrl: catDraft.imageUrl.trim() || null,
      isActive: catDraft.isActive,
      sortOrder: catDraft.sortOrder,
    };

    if (catDrawer.editId) {
      persistCats(categories.map(c => c.id === catDrawer.editId ? { ...c, ...fields } : c));
      addToast('Category saved');
    } else {
      const newCat: Category = { id: uid(), subs: [], ...fields };
      persistCats([...categories, newCat]);
      addToast('Category added');
    }
    setCatDrawer({ open: false, editId: null });
  };

  if (!menuLoaded && menuLoading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-500">
        Loading menu…
      </div>
    );
  }

  if (!menuLoaded && menuError) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-sm text-gray-500">
        <p>Couldn't load the menu from the server: {menuError}</p>
        <button
          type="button"
          onClick={() => fetchMenu()}
          className="border border-gray-300 bg-white font-medium text-gray-700 hover:bg-gray-50 rounded-lg px-4 py-2"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex-none bg-white border-b border-gray-200">

        {/* Title row */}
        <div className="px-7 pt-6 pb-0 flex items-start justify-end gap-4 flex-wrap">
          <div className="flex items-center gap-2.5">
            {/* Data source badge */}
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1.5">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3M21 5v14c0 1.66-4 3-9 3s-9-1.34-9-3V5" />
              </svg>
              {menuLoading ? 'Syncing…' : 'Live database'}
            </div>
            {/* Add category */}
            <button
              type="button"
              onClick={openNewCat}
              className="flex items-center gap-1.5 border border-gray-300 bg-white font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-colors rounded-lg"
              style={{ height: 38, padding: '0 14px', fontSize: 13 }}
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add category
            </button>
            {/* New item */}
            <button
              type="button"
              onClick={openNewItem}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition-colors rounded-lg"
              style={{ height: 38, padding: '0 16px', fontSize: 13 }}
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New item
            </button>
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex items-end gap-0.5 mt-[18px] overflow-x-auto px-7" style={{ marginBottom: -1 }}>
          {/* All tab */}
          <button
            type="button"
            onClick={() => setActiveCatId('all')}
            className="flex items-center gap-2 shrink-0 border-none bg-transparent cursor-pointer transition-colors"
            style={{
              padding: '11px 15px',
              fontSize: 13.5,
              fontWeight: activeCatId === 'all' ? 600 : 500,
              color: activeCatId === 'all' ? '#15803d' : '#374151',
              borderBottom: `2.5px solid ${activeCatId === 'all' ? '#16a34a' : 'transparent'}`,
            }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            All items
            <span className="font-semibold text-gray-500 bg-gray-100 rounded-full px-1.5 py-0.5 font-mono" style={{ fontSize: 11 }}>{items.length}</span>
          </button>

          {/* Per-category tabs */}
          {sorted.map(cat => {
            const isActive = activeCatId === cat.id;
            const count = items.filter(i => i.categoryId === cat.id).length;
            const swatch = cat.imageUrl ? `url(${cat.imageUrl})` : swatchFor(cat.id);
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCatId(cat.id)}
                className="relative flex items-center gap-2 shrink-0 border-none bg-transparent cursor-pointer transition-colors group"
                style={{
                  padding: '11px 14px',
                  fontSize: 13.5,
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? '#15803d' : '#374151',
                  borderBottom: `2.5px solid ${isActive ? '#16a34a' : 'transparent'}`,
                  opacity: cat.isActive ? 1 : 0.55,
                }}
              >
                <span
                  className="shrink-0 flex items-center justify-center font-serif text-white"
                  style={{ width: 20, height: 20, borderRadius: 6, backgroundImage: swatch, backgroundSize: 'cover', backgroundPosition: 'center', fontSize: 10, fontWeight: 700 }}
                >
                  {!cat.imageUrl && getInitial(cat.name)}
                </span>
                {cat.name}
                <span className="font-semibold text-gray-500 bg-gray-100 rounded-full px-1.5 py-0.5 font-mono" style={{ fontSize: 11 }}>{count}</span>
                {!cat.isActive && (
                  <span className="text-gray-400 border border-gray-200 rounded px-1" style={{ fontSize: 10 }}>hidden</span>
                )}
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); openEditCat(cat); }}
                  aria-label="Edit category"
                  className="hidden group-hover:flex w-[22px] h-[22px] items-center justify-center rounded-[5px] text-gray-400 hover:bg-gray-200 hover:text-emerald-700 transition-colors ml-0.5"
                >
                  <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              </button>
            );
          })}

          {/* Quick-add category */}
          <button
            type="button"
            onClick={openNewCat}
            aria-label="Add category"
            className="flex items-center justify-center shrink-0 border-none bg-transparent cursor-pointer text-gray-400 hover:text-emerald-600 transition-colors"
            style={{ width: 32, height: 40 }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Item grid ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-7 py-4">
        {/* Count bar */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-[13px] text-gray-500">
            Showing <strong className="text-gray-900">{viewItems.length}</strong>{' '}
            {viewItems.length === 1 ? 'item' : 'items'}
            {activeCatId !== 'all' && (
              <span className="text-gray-400"> · {sorted.find(c => c.id === activeCatId)?.name}</span>
            )}
          </p>
          {selectedIds.size > 0 && (
            <button type="button" onClick={() => setSelectedIds(new Set())}
              className="text-[12.5px] text-gray-500 hover:text-gray-700 border-none bg-transparent cursor-pointer">
              Clear {selectedIds.size} selected
            </button>
          )}
        </div>

        {viewItems.length > 0 ? (
          useGrouped && activeCat ? (
            <SubGroupedGrid
              cat={activeCat}
              items={viewItems}
              selectedIds={selectedIds}
              onToggleSel={toggleSel}
              onEdit={openEditItem}
              onDelete={item => setConfirm({
                title: 'Delete item',
                body: `Are you sure you want to permanently delete "${item.title}"? This action cannot be undone.`,
                cta: 'Delete',
                onConfirm: () => deleteItem(item.id),
              })}
              onToggleAvail={toggleAvail}
            />
          ) : (
            <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(268px,1fr))' }}>
              {viewItems.map(item => (
                <ItemCard
                  key={item.id}
                  item={item}
                  selected={selectedIds.has(item.id)}
                  onToggleSel={() => toggleSel(item.id)}
                  onEdit={() => openEditItem(item)}
                  onDelete={() => setConfirm({
                    title: 'Delete item',
                    body: `Are you sure you want to permanently delete "${item.title}"? This action cannot be undone.`,
                    cta: 'Delete',
                    onConfirm: () => deleteItem(item.id),
                  })}
                  onToggleAvail={() => toggleAvail(item)}
                />
              ))}
            </div>
          )
        ) : (
          <div className="text-center py-[70px] px-5">
            <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-3.5 text-gray-400">
              <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <div className="text-[15px] font-semibold text-gray-900 mb-1.5">No items yet</div>
            <div className="text-[13px] text-gray-400 max-w-[320px] mx-auto mb-4">
              {activeCatId === 'all'
                ? 'Add your first menu item to get started.'
                : `No items in this category yet. Add one to get started.`}
            </div>
            <button type="button" onClick={openNewItem}
              className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-[13px] transition-colors">
              Add item
            </button>
          </div>
        )}
      </div>

      {/* ── Overlays ────────────────────────────────────────────────────── */}
      {itemDrawer.open && (
        <ItemDrawer
          categories={sorted}
          draft={itemDraft}
          setDraft={setItemDraft}
          onSave={saveItem}
          onClose={() => setItemDrawer({ open: false, editId: null })}
          isEdit={!!itemDrawer.editId}
          editId={itemDrawer.editId}
        />
      )}

      {catDrawer.open && (
        <CategoryDrawer
          draft={catDraft}
          setDraft={setCatDraft}
          onSave={saveCat}
          onClose={() => setCatDrawer({ open: false, editId: null })}
          isEdit={!!catDrawer.editId}
        />
      )}

      {confirm && <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />}

      <ToastList toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
