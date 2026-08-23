# Verdura — Customer Frontend

React + Vite customer-facing website for Verdura restaurant.

## Responsibility

Public landing page, venue/contact information, marketing content, promotions, and public menu browsing. Also handles the customer reservation booking flow. **Not** the in-venue ordering surface — it must not gain cart, checkout, or order-submission features; that's `apps/admin-console`'s Order Tablet device-mode build (see `apps/order-tablet/README.md`). `apps/window-display` reuses several of this app's pages (`Menu`, `BookTable`, `About`, `Contact`) directly via a source-level alias, so changes to those specific pages affect both apps.

## Development

```bash
npm install
npm run dev
```

The dev server runs at `http://localhost:5173` and proxies `/api` requests to the NestJS API at `http://localhost:3000`.

## Environment Variables

`npm run dev` at the repository root creates `.env` from `.env.example` if
needed. The frontend talks only to the NestJS API:

```
VITE_API_URL=
VITE_VENUE_ID=10000000-0000-4000-8000-000000000001
```

## Build

```bash
npm run build
```
