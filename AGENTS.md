# AGENTS.md

## Cursor Cloud specific instructions

### Overview

This is a **static front-end web application** (Procurement System for Triana · Logística). There is no build step, no package manager, no bundler, and no server-side code. All JavaScript libraries are loaded via CDN.

### Running the dev server

Serve the files with any static HTTP server from the repository root:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/index.html` in a browser.

### Architecture

- **Frontend**: Vanilla HTML/CSS/JS (no framework). Three pages: `index.html` (login), `dashboard.html` (process list), `process.html` (process detail).
- **Backend**: Supabase (hosted BaaS) — provides PostgreSQL, auth, and file storage. Config in `js/config.js`.
- **Libraries** (CDN-loaded): `@supabase/supabase-js@2`, `xlsx@0.18.5`, `exceljs@4.4.0`, `pdfjs-dist@3.11.174`.
- **SQL migrations**: `sql/schema.sql`, `sql/security.sql`, `sql/security-hardening.sql` — applied to the Supabase project.

### Key caveats

- There is **no linting, no automated tests, and no build step** in this project. Validation is limited to manual browser testing.
- The Supabase URL and anon key are hardcoded in `js/config.js`. To use a different Supabase instance, update both values there.
- Login is restricted to `@triana.co.mz` email addresses (enforced client-side and server-side).
- Full end-to-end testing (beyond the login page) requires a valid Supabase account with the database schema applied.
