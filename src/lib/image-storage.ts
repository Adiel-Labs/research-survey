import {
  SUPABASE_BUCKETS,
  SUPABASE_FOLDERS,
  getCaseImageStoragePath,
  getCaseReviewUploadPath,
} from '@/lib/data-model'
import { supabase } from '@/lib/supabase'

function buildFileName(file: File): string {
  const safeName = file.name.replace(/\s+/g, '-').toLowerCase()
  return `${Date.now()}-${safeName}`
}

export async function uploadCaseImage(file: File, caseId: string): Promise<{
  bucket: string
  path: string
  publicUrl: string
}> {
  const fileName = buildFileName(file)
  const path = getCaseImageStoragePath(caseId, fileName)
  const bucket = SUPABASE_BUCKETS.annotateImages

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, file, { upsert: false })

  if (uploadError) {
    throw new Error(`Image upload failed: ${uploadError.message}`)
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path)

  return {
    bucket,
    path,
    publicUrl: data.publicUrl,
  }
}

export async function uploadCorrectionOverlay(
  file: File,
  caseId: string,
  reviewId: string,
): Promise<{
  bucket: string
  path: string
  publicUrl: string
}> {
  const fileName = buildFileName(file)
  const path = getCaseReviewUploadPath(caseId, reviewId, fileName)
  const bucket = SUPABASE_BUCKETS.annotateImages

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, file, { upsert: false })

  if (uploadError) {
    throw new Error(`Correction upload failed: ${uploadError.message}`)
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path)

  return {
    bucket,
    path,
    publicUrl: data.publicUrl,
  }
}

export async function uploadCorrectionOverlayBlob(
  blob: Blob,
  caseId: string,
  reviewId: string,
): Promise<{
  bucket: string
  path: string
  publicUrl: string
}> {
  const path = getCaseReviewUploadPath(caseId, reviewId, 'overlay.png')
  const bucket = SUPABASE_BUCKETS.annotateImages

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, blob, { upsert: true, contentType: 'image/png' })

  if (uploadError) {
    throw new Error(`Correction overlay upload failed: ${uploadError.message}`)
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path)

  return {
    bucket,
    path,
    publicUrl: data.publicUrl,
  }
}

export function getPublicImageUrl(bucket: string, path: string): string {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}

async function listFolderRecursive(prefix: string): Promise<string[]> {
  const bucket = SUPABASE_BUCKETS.annotateImages
  const { data, error } = await supabase.storage.from(bucket).list(prefix, {
    limit: 1000,
    sortBy: { column: 'name', order: 'asc' },
  })

  if (error) {
    throw new Error(`Failed to list Supabase folder "${prefix}": ${error.message}`)
  }

  const paths: string[] = []
  for (const entry of data) {
    const nextPath = `${prefix}/${entry.name}`
    if (entry.metadata) {
      paths.push(nextPath)
    } else {
      const nested = await listFolderRecursive(nextPath)
      paths.push(...nested)
    }
  }
  return paths
}

export async function listNotReviewedImagePaths(): Promise<string[]> {
  return listFolderRecursive(SUPABASE_FOLDERS.notReviewed)
}
