# Dental Caries Annotation Validation Platform

Tooth-Level Caries Annotation and Clinical Validation System.

## Stack

- Bun + React + TypeScript + Vite
- Tailwind CSS v4 + `shadcn/ui`
- Firebase (Firestore + Auth)
- Supabase Storage (`annotate-images` bucket)

## Run locally

```bash
npm install
bun run dev
```

## Firebase setup

1. Copy `.env.example` to `.env`.
2. Fill all `VITE_FIREBASE_*` values from your Firebase project settings.
3. Fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Firebase client helpers are in `src/lib/firebase.ts`.

## Data model

The exact Firestore schema and Storage folder conventions are documented in:

- `docs/FIREBASE_DATA_MODEL.md`

Key rule: **images go to Firebase Storage, metadata and reviews go to Firestore**.
