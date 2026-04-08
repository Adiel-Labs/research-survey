export type ValidationDecision = 'yes' | 'no'

export type CorrectionKind = 'incorrect_label' | 'missing_caries'
export type DrawingMode = 'polygon' | 'freehand'

export type Point2D = {
  x: number
  y: number
}

export type CorrectionRegion = {
  id: string
  kind: CorrectionKind
  mode: DrawingMode
  points: Point2D[]
  strokeWidth?: number
  createdAt: string
}

export type CariesPolygon = {
  id: string
  points: Point2D[]
}

export type CaseStatus = 'pending' | 'in_review' | 'validated'

export type DentalCaseDocument = {
  caseId: string
  imageProvider: 'supabase'
  imageBucket: string
  imagePath: string
  imagePublicUrl?: string
  source: 'intraoral' | 'tooth' | 'other'
  originalAnnotations: CariesPolygon[]
  status: CaseStatus
  createdAt: string
  updatedAt: string
}

export type CaseReviewDocument = {
  reviewId: string
  caseId: string
  reviewerId: string
  reviewerName?: string
  decision: ValidationDecision
  comment?: string
  correctionUploadPath?: string
  correctionUploadUrl?: string
  corrections: CorrectionRegion[]
  submittedAt: string
}

export type UserDocument = {
  userId: string
  role: 'dentist' | 'admin'
  displayName: string
  email: string
  createdAt: string
}
