# Firebase Data Model

This project uses:

- **Supabase Storage** for dental image files
- **Cloud Firestore** for metadata, annotations, and dentist reviews

## Storage Folder Structure (Supabase bucket: `annotate-images`)

Use deterministic paths to keep data easy to audit and export.

- `cases/{caseId}/original/{fileName}`: source dental image
- `cases/{caseId}/overlays/original.json`: initial manual polygon annotation payload
- `cases/{caseId}/overlays/reviews/{reviewId}.json`: optional exported correction overlay payload

## Firestore Collections

### `cases/{caseId}`

Stores one image-level annotation unit to be validated.

Suggested fields:

- `caseId: string`
- `imageProvider: "supabase"`
- `imageBucket: "annotate-images"`
- `imagePath: string` (storage path)
- `imagePublicUrl?: string`
- `source: "intraoral" | "tooth" | "other"`
- `originalAnnotations: Array<{ id: string; points: Array<{x:number;y:number}> }>`
- `status: "pending" | "in_review" | "validated"`
- `createdAt: string` (or server timestamp)
- `updatedAt: string` (or server timestamp)

### `cases/{caseId}/reviews/{reviewId}`

Stores dentist validation output for one review action.

Suggested fields:

- `reviewId: string`
- `caseId: string`
- `reviewerId: string`
- `reviewerName?: string`
- `decision: "yes" | "no"`
- `comment?: string`
- `corrections: Array<CorrectionRegion>`
- `submittedAt: string` (or server timestamp)

Where `CorrectionRegion`:

- `id: string`
- `kind: "incorrect_label" | "missing_caries"`  
  - `incorrect_label` = red tool  
  - `missing_caries` = green tool
- `mode: "polygon" | "freehand"`
- `points: Array<{x:number;y:number}>`
- `createdAt: string`

### `users/{userId}`

Suggested fields:

- `userId: string`
- `role: "dentist" | "admin"`
- `displayName: string`
- `email: string`
- `createdAt: string`

## Workflow Mapping

1. Display `cases/{caseId}` image + original annotation polygons.
2. Ask: **Is this caries annotation correct?**
3. If **Yes**:
   - write `reviews/{reviewId}` with `decision: "yes"` and empty `corrections`
   - move to next image
4. If **No**:
   - enable red and green drawing tools
   - save corrected regions in `corrections`
   - submit review and move to next image

## Query Patterns

- Unreviewed queue: query `cases` by `status == "pending"`
- Dentist history: query `reviews` by `reviewerId`
- Rejected annotations: query `reviews` by `decision == "no"`

## Notes

- Keep image binaries out of Firestore.
- Store only references/metadata in Firestore.
- Prefer `serverTimestamp()` in production writes for auditability.
