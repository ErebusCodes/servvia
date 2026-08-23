# Static menu images — canonical source

This folder is the **single source of truth** for default/catalogue menu item
and category images. It is git-tracked and bundled into every frontend build.

## Convention

- Filename: lowercase, hyphen-separated slug matching the product name, e.g.
  `arayes-cheese.jpg`, `kuwaiti-lamb-shank-machboos.jpg`.
- Referenced from the database as a site-relative path:
  `MenuItem.imageUrl = "/menu-images/<filename>"`.
- Accepted formats: `.jpg`, `.png`, `.webp` (see
  `backend/src/menu/dto/image-url.pattern.ts` for the full validation rule).

## What does *not* belong here

- **`admin-frontend/dist/menu-images/`** — generated build output (Vite
  copies this folder into `dist/` on `npm run build`). It is gitignored,
  disposable, and regenerated on every build. Never edit or add files there
  directly; never reference `dist/` from source code, docs, or database rows.
- **Runtime admin-uploaded photos** — those go through `MediaService`
  (`backend/src/media/`), land in `backend/storage/menu-items/`, and are
  served from `/media/menu-items/<file>`, not from this folder. See
  `docs/architecture.md` §6 for the full split.

## Adding a new default image

1. Drop the file in here with a slug-style filename.
2. Set the matching `MenuItem.imageUrl` (or `Category.imageUrl`) to
   `/menu-images/<filename>` — via the Admin Menu Management UI or a direct
   update, same as any other field.
3. Commit the image file alongside the change.
