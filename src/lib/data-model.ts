export const COLLECTIONS = {
  cases: 'cases',
  users: 'users',
  reviews: 'reviews',
} as const

export const SUPABASE_BUCKETS = {
  annotateImages: 'annotate-images',
} as const

export const SUPABASE_FOLDERS = {
  notReviewed: 'NotReviewed',
  reviewCorrections: 'Reviewed',
} as const

export function getCaseImageStoragePath(caseId: string, fileName: string): string {
  return `${SUPABASE_FOLDERS.notReviewed}/${caseId}/${fileName}`
}

export function getCaseOriginalOverlayPath(caseId: string): string {
  return `cases/${caseId}/overlays/original.json`
}

export function getCaseReviewOverlayPath(caseId: string, reviewId: string): string {
  return `cases/${caseId}/overlays/reviews/${reviewId}.json`
}

export function getCaseReviewUploadPath(
  caseId: string,
  reviewId: string,
  fileName: string,
): string {
  return `${SUPABASE_FOLDERS.reviewCorrections}/${caseId}/${reviewId}-${fileName}`
}
