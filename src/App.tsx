import type { Session } from '@supabase/supabase-js'
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore'

import { CheckCircle2, Loader2 } from 'lucide-react'

import { LoginPage } from '@/components/LoginPage'
import { Button } from '@/components/ui/button'
import { COLLECTIONS, SUPABASE_BUCKETS } from '@/lib/data-model'
import { db } from '@/lib/firebase'
import { getPublicImageUrl, uploadCorrectionOverlayBlob } from '@/lib/image-storage'
import { supabase } from '@/lib/supabase'
import type {
  CaseReviewDocument,
  CorrectionRegion,
  DentalCaseDocument,
  ValidationDecision,
} from '@/types/validation'

type CaseRecord = {
  docId: string
  data: DentalCaseDocument
}

type ReviewRecord = {
  docId: string
  data: CaseReviewDocument
}

type DrawTool = 'draw' | 'erase'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)

  const [cases, setCases] = useState<CaseRecord[]>([])
  const [reviewsByCaseId, setReviewsByCaseId] = useState<Record<string, ReviewRecord[]>>({})
  const [activeIndex, setActiveIndex] = useState(0)
  const [decision, setDecision] = useState<ValidationDecision | null>(null)
  const [comment, setComment] = useState('')
  const [drawnRegions, setDrawnRegions] = useState<CorrectionRegion[]>([])
  const [isDrawing, setIsDrawing] = useState(false)
  const [draftStroke, setDraftStroke] = useState<Array<{ x: number; y: number }>>([])
  const [activeKind, setActiveKind] = useState<CorrectionRegion['kind']>('incorrect_label')
  const [drawTool, setDrawTool] = useState<DrawTool>('draw')
  const [strokeWidth, setStrokeWidth] = useState(8)
  const [cursorPoint, setCursorPoint] = useState<{ x: number; y: number } | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<string>('')
  const [isQueueLoading, setIsQueueLoading] = useState(false)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const imageContainerRef = useRef<HTMLDivElement | null>(null)

  async function loadCases() {
    const casesQuery = query(collection(db, COLLECTIONS.cases), orderBy('createdAt', 'desc'))
    const snapshot = await getDocs(casesQuery)
    const caseRecords = snapshot.docs.map((item) => ({
      docId: item.id,
      data: item.data() as DentalCaseDocument,
    }))

    const reviewLists = await Promise.all(
      caseRecords.map(async (caseRecord) => {
        const reviewSnapshot = await getDocs(
          collection(db, COLLECTIONS.cases, caseRecord.docId, COLLECTIONS.reviews),
        )
        const reviews = reviewSnapshot.docs.map((reviewDoc) => ({
          docId: reviewDoc.id,
          data: reviewDoc.data() as CaseReviewDocument,
        }))
        return [caseRecord.docId, reviews] as const
      }),
    )

    // Set together so Total Reviewed never briefly sees cases without review data (looked like 0).
    setCases(caseRecords)
    setReviewsByCaseId(Object.fromEntries(reviewLists))
  }

  useEffect(() => {
    void supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      setSession(initialSession)
      setAuthReady(true)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setIsQueueLoading(false)
      return
    }
    let cancelled = false
    setIsQueueLoading(true)
    void loadCases()
      .catch(() => {
        /* loadCases errors surface via submit message; queue still needs to unblock */
      })
      .finally(() => {
        if (!cancelled) setIsQueueLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [session])

  useEffect(() => {
    if (decision === 'no') {
      setDrawTool('draw')
    }
  }, [decision])

  const reviewerEmail = session?.user.email?.toLowerCase() ?? ''
  function canReviewerSeeCase(caseDocId: string, email: string): boolean {
    if (!email) return false
    const reviews = reviewsByCaseId[caseDocId] ?? []
    if (reviews.length === 0) return true
    return reviews.some((review) => review.data.reviewerEmail?.toLowerCase() === email)
  }

  const visibleCases = useMemo(() => {
    if (!reviewerEmail) return []
    return cases.filter((item) => canReviewerSeeCase(item.docId, reviewerEmail))
  }, [cases, reviewsByCaseId, reviewerEmail])

  const reviewedCount = useMemo(() => {
    if (!reviewerEmail) return 0
    return cases.filter((item) => {
      const reviews = reviewsByCaseId[item.docId] ?? []
      return reviews.some((review) => review.data.reviewerEmail?.toLowerCase() === reviewerEmail)
    }).length
  }, [cases, reviewsByCaseId, reviewerEmail])

  const activeCase = visibleCases[activeIndex] ?? null

  const activeImageUrl = useMemo(() => {
    if (!activeCase) return ''
    if (activeCase.data.imagePublicUrl) return activeCase.data.imagePublicUrl
    return getPublicImageUrl(
      activeCase.data.imageBucket || SUPABASE_BUCKETS.annotateImages,
      activeCase.data.imagePath,
    )
  }, [activeCase])

  async function handleSubmitYes() {
    if (!activeCase) return
    await submitReview('yes')
  }

  async function handleSubmitNo() {
    if (!activeCase) return
    if (drawnRegions.length === 0) {
      setMessage('For "No", draw at least one correction region on the image.')
      return
    }
    await submitReview('no')
  }

  function getRenderedImageBox() {
    const container = imageContainerRef.current
    const image = imageRef.current
    if (!container || !image) return null
    const containerRect = container.getBoundingClientRect()
    const naturalWidth = image.naturalWidth
    const naturalHeight = image.naturalHeight
    if (!containerRect.width || !containerRect.height || !naturalWidth || !naturalHeight) return null

    const scale = Math.min(
      containerRect.width / naturalWidth,
      containerRect.height / naturalHeight,
    )
    const renderedWidth = naturalWidth * scale
    const renderedHeight = naturalHeight * scale
    const offsetLeft = (containerRect.width - renderedWidth) / 2
    const offsetTop = (containerRect.height - renderedHeight) / 2

    return {
      containerRect,
      offsetLeft,
      offsetTop,
      renderedWidth,
      renderedHeight,
    }
  }

  function getRelativePoint(event: PointerEvent<HTMLDivElement>): { x: number; y: number } | null {
    const box = getRenderedImageBox()
    if (!box) return null

    const xPx = event.clientX - box.containerRect.left - box.offsetLeft
    const yPx = event.clientY - box.containerRect.top - box.offsetTop
    if (xPx < 0 || yPx < 0 || xPx > box.renderedWidth || yPx > box.renderedHeight) return null

    const x = xPx / box.renderedWidth
    const y = yPx / box.renderedHeight
    return { x, y }
  }

  function handleDrawStart(event: PointerEvent<HTMLDivElement>) {
    if (decision !== 'no') return
    if (event.button !== 0) return
    event.preventDefault()
    const point = getRelativePoint(event)
    if (!point) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDrawing(true)
    setDraftStroke([point])
  }

  function handleDrawMove(event: PointerEvent<HTMLDivElement>) {
    const point = getRelativePoint(event)
    setCursorPoint(point)
    if (!isDrawing || decision !== 'no') return
    if ((event.buttons & 1) !== 1) return
    if (!point) return
    setDraftStroke((prev) => [...prev, point])
  }

  function minDistance(a: { x: number; y: number }, b: { x: number; y: number }) {
    const dx = a.x - b.x
    const dy = a.y - b.y
    return Math.sqrt(dx * dx + dy * dy)
  }

  function eraseStrokeSegments(
    regions: CorrectionRegion[],
    eraserPoints: Array<{ x: number; y: number }>,
    threshold: number,
  ): CorrectionRegion[] {
    const result: CorrectionRegion[] = []
    for (const region of regions) {
      const chunks: Array<Array<{ x: number; y: number }>> = []
      let currentChunk: Array<{ x: number; y: number }> = []
      for (const point of region.points) {
        const touched = eraserPoints.some((eraserPoint) => minDistance(point, eraserPoint) <= threshold)
        if (touched) {
          if (currentChunk.length >= 2) chunks.push(currentChunk)
          currentChunk = []
        } else {
          currentChunk.push(point)
        }
      }
      if (currentChunk.length >= 2) chunks.push(currentChunk)

      if (chunks.length === 0) continue
      for (const chunk of chunks) {
        result.push({
          ...region,
          id: crypto.randomUUID(),
          points: chunk,
        })
      }
    }
    return result
  }

  function strokeLength(points: Array<{ x: number; y: number }>) {
    let total = 0
    for (let i = 1; i < points.length; i += 1) {
      total += minDistance(points[i - 1], points[i])
    }
    return total
  }

  function handleDrawEnd(event?: PointerEvent<HTMLDivElement>) {
    if (event && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!isDrawing || draftStroke.length < 2 || strokeLength(draftStroke) < 0.01) {
      setIsDrawing(false)
      setDraftStroke([])
      return
    }

    if (drawTool === 'erase') {
      const threshold = Math.max(0.008, strokeWidth / 1000)
      setDrawnRegions((prev) => eraseStrokeSegments(prev, draftStroke, threshold))
    } else {
      setDrawnRegions((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          kind: activeKind,
          mode: 'freehand',
          points: draftStroke,
          strokeWidth,
          createdAt: new Date().toISOString(),
        },
      ])
    }

    setIsDrawing(false)
    setDraftStroke([])
  }

  function handlePointerLeave() {
    setCursorPoint(null)
  }

  function resetTransientEditorState() {
    setIsDrawing(false)
    setDraftStroke([])
    setCursorPoint(null)
    setMessage('')
  }

  function goToCaseByOffset(offset: number) {
    resetTransientEditorState()
    setActiveIndex((prev) => {
      if (visibleCases.length === 0) return 0
      const next = prev + offset
      if (next < 0) return 0
      if (next >= visibleCases.length) return visibleCases.length - 1
      return next
    })
  }

  function moveToNextCase() {
    goToCaseByOffset(1)
  }

  function moveToPreviousCase() {
    goToCaseByOffset(-1)
  }

  async function submitReview(nextDecision: ValidationDecision) {
    if (!activeCase || !session?.user) return

    setIsSubmitting(true)
    setMessage('')

    try {
      const reviewId = session.user.id
      const now = new Date().toISOString()
      const userEmail = session.user.email?.toLowerCase()
      if (!userEmail) {
        throw new Error('Signed-in user does not have an email.')
      }
      let correctionUploadPath: string | undefined
      let correctionUploadUrl: string | undefined

      if (nextDecision === 'no') {
        if (!activeImageUrl) {
          throw new Error('Image URL is missing, cannot generate overlay.')
        }

        const overlayBlob = await buildOverlayImage(activeImageUrl, drawnRegions)
        const uploaded = await uploadCorrectionOverlayBlob(
          overlayBlob,
          activeCase.data.caseId,
          reviewId,
        )
        correctionUploadPath = uploaded.path
        correctionUploadUrl = uploaded.publicUrl
      }

      const displayName =
        typeof session.user.user_metadata?.display_name === 'string'
          ? session.user.user_metadata.display_name
          : undefined

      const trimmedComment = comment.trim()
      const reviewDoc: CaseReviewDocument = {
        reviewId,
        caseId: activeCase.data.caseId,
        reviewerId: session.user.id,
        reviewerEmail: userEmail,
        reviewerName: displayName ?? session.user.email?.split('@')[0] ?? 'Reviewer',
        decision: nextDecision,
        corrections: nextDecision === 'no' ? drawnRegions : [],
        submittedAt: now,
        ...(trimmedComment ? { comment: trimmedComment } : {}),
        ...(correctionUploadPath ? { correctionUploadPath } : {}),
        ...(correctionUploadUrl ? { correctionUploadUrl } : {}),
      }

      const reviewRef = doc(
        db,
        COLLECTIONS.cases,
        activeCase.docId,
        COLLECTIONS.reviews,
        reviewId,
      )
      await setDoc(reviewRef, reviewDoc)

      await updateDoc(doc(db, COLLECTIONS.cases, activeCase.docId), {
        status: 'validated',
        assignedReviewerEmail: userEmail,
        annotatedImageUrl: correctionUploadUrl ?? null,
        lastReviewDecision: nextDecision,
        updatedAt: now,
        reviewedAt: now,
      })

      setDecision(null)
      setComment('')
      setDrawnRegions([])
      setMessage(`Saved "${nextDecision.toUpperCase()}" for case ${activeCase.data.caseId}.`)

      await loadCases()
      moveToNextCase()
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Submission failed.'
      setMessage(text)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function buildOverlayImage(
    originalImageUrl: string,
    regions: CorrectionRegion[],
  ): Promise<Blob> {
    const img = imageRef.current
    const width = img?.naturalWidth ?? 0
    const height = img?.naturalHeight ?? 0
    if (!width || !height) {
      throw new Error('Could not read image dimensions for overlay generation.')
    }

    const response = await fetch(originalImageUrl)
    if (!response.ok) {
      throw new Error('Failed to download original image for overlay.')
    }

    const imageBlob = await response.blob()
    const bitmap = await createImageBitmap(imageBlob)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Could not create overlay canvas context.')
    }

    ctx.drawImage(bitmap, 0, 0, width, height)
    for (const region of regions) {
      const isMissing = region.kind === 'missing_caries'
      ctx.strokeStyle = isMissing ? 'rgba(22, 163, 74, 0.95)' : 'rgba(220, 38, 38, 0.95)'
      const relativeWidth = (region.strokeWidth ?? 8) / 1000
      ctx.lineWidth = Math.max(2, width * relativeWidth)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      region.points.forEach((point, index) => {
        const x = point.x * width
        const y = point.y * height
        if (index === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
    }

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((value) => resolve(value), 'image/png'),
    )
    if (!blob) {
      throw new Error('Failed to encode overlay image.')
    }
    return blob
  }

  useEffect(() => {
    setActiveIndex((prev) => {
      if (visibleCases.length === 0) return 0
      if (prev >= visibleCases.length) return visibleCases.length - 1
      return prev
    })
  }, [visibleCases])

  useEffect(() => {
    if (!activeCase || !reviewerEmail) {
      setDecision(null)
      setComment('')
      setDrawnRegions([])
      return
    }

    const reviews = reviewsByCaseId[activeCase.docId] ?? []
    const ownReview = reviews.find(
      (review) => review.data.reviewerEmail?.toLowerCase() === reviewerEmail,
    )
    if (!ownReview) {
      setDecision(null)
      setComment('')
      setDrawnRegions([])
      return
    }

    setDecision(ownReview.data.decision)
    setComment(ownReview.data.comment ?? '')
    setDrawnRegions(ownReview.data.corrections ?? [])
  }, [activeCase, reviewsByCaseId, reviewerEmail])

  if (!authReady) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    )
  }

  if (!session) {
    return <LoginPage />
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-muted/50 via-background to-background">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-6 rounded-2xl border bg-card/80 p-6 shadow-sm backdrop-blur-sm ring-1 ring-border/60">
        <div className="space-y-2">
          <h1 className="text-balance text-2xl font-semibold tracking-tight">
            Dental Caries Annotation Validation
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Verify each case with Yes or No. Corrections use red and green strokes on the image.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-3 sm:items-end">
          <span className="max-w-[260px] truncate rounded-lg bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground sm:max-w-xs">
            {session.user.email}
          </span>
          <Button variant="outline" size="sm" onClick={() => void supabase.auth.signOut()}>
            Log out
          </Button>
        </div>
      </header>

      <section className="rounded-2xl border bg-card p-6 shadow-sm ring-1 ring-border/60">
        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <CheckCircle2 className="h-7 w-7" strokeWidth={1.75} aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">Total Reviewed</p>
            <p className="mt-0.5 text-4xl font-semibold tabular-nums tracking-tight text-foreground">
              {isQueueLoading ? (
                <span className="text-muted-foreground/80" aria-busy="true" aria-label="Loading count">
                  —
                </span>
              ) : (
                reviewedCount
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Cases you have submitted a validation for
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-5 rounded-2xl border bg-card p-6 shadow-sm ring-1 ring-border/60">
        {isQueueLoading ? (
          <div
            className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
            <p className="text-sm">Loading cases…</p>
          </div>
        ) : !activeCase ? (
          <p className="text-sm text-muted-foreground">
            No cases available for your account.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Current case
                </p>
                <p className="mt-1 font-mono text-sm font-medium text-foreground">
                  {activeCase.data.caseId}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={moveToPreviousCase} disabled={activeIndex === 0}>
                  Previous
                </Button>
                <Button
                  variant="outline"
                  onClick={moveToNextCase}
                  disabled={activeIndex >= visibleCases.length - 1}
                >
                  Next
                </Button>
              </div>
            </div>
            {decision === 'no' ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
                <span className="text-sm text-muted-foreground">Tool:</span>
                <Button
                  size="sm"
                  variant={drawTool === 'draw' ? 'default' : 'outline'}
                  onClick={() => setDrawTool('draw')}
                >
                  Draw
                </Button>
                <Button
                  size="sm"
                  variant={drawTool === 'erase' ? 'default' : 'outline'}
                  onClick={() => setDrawTool('erase')}
                >
                  Eraser
                </Button>
                <span className="ml-2 text-sm text-muted-foreground">Type:</span>
                <Button
                  size="sm"
                  variant={activeKind === 'incorrect_label' ? 'default' : 'outline'}
                  onClick={() => setActiveKind('incorrect_label')}
                  disabled={drawTool === 'erase'}
                  className="border-red-600 text-red-700"
                >
                  Red
                </Button>
                <Button
                  size="sm"
                  variant={activeKind === 'missing_caries' ? 'default' : 'outline'}
                  onClick={() => setActiveKind('missing_caries')}
                  disabled={drawTool === 'erase'}
                  className="border-green-600 text-green-700"
                >
                  Green
                </Button>
                <label className="ml-2 text-sm text-muted-foreground" htmlFor="strokeWidth">
                  Width:
                </label>
                <input
                  id="strokeWidth"
                  type="range"
                  min={2}
                  max={24}
                  value={strokeWidth}
                  onChange={(event) => setStrokeWidth(Number(event.target.value))}
                />
                <span className="text-xs text-muted-foreground">{strokeWidth}px</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDrawnRegions((prev) => prev.slice(0, -1))}
                  disabled={drawnRegions.length === 0 || isSubmitting}
                >
                  Undo
                </Button>
              </div>
            ) : null}

            {activeImageUrl ? (
              <div
                ref={imageContainerRef}
                className="relative max-h-[420px] w-full select-none overflow-hidden rounded-xl border border-border/80 bg-muted/30 shadow-inner touch-none ring-1 ring-black/[0.03] dark:ring-white/[0.06]"
                onPointerDown={handleDrawStart}
                onPointerMove={handleDrawMove}
                onPointerUp={handleDrawEnd}
                onPointerCancel={handleDrawEnd}
                onPointerLeave={handlePointerLeave}
              >
                <img
                  ref={imageRef}
                  src={activeImageUrl}
                  alt={`Case ${activeCase.data.caseId}`}
                  className="max-h-[420px] w-full object-contain"
                  draggable={false}
                  onDragStart={(event) => event.preventDefault()}
                />
                <svg className="pointer-events-none absolute inset-0 h-full w-full">
                  {(() => {
                    const box = getRenderedImageBox()
                    if (!box) return null
                    return (
                      <svg
                        x={box.offsetLeft}
                        y={box.offsetTop}
                        width={box.renderedWidth}
                        height={box.renderedHeight}
                        viewBox="0 0 1 1"
                        preserveAspectRatio="none"
                      >
                        {drawnRegions.map((region) => (
                          <polyline
                            key={region.id}
                            points={region.points.map((p) => `${p.x},${p.y}`).join(' ')}
                            fill="none"
                            stroke={
                              region.kind === 'missing_caries'
                                ? 'rgba(22,163,74,0.95)'
                                : 'rgba(220,38,38,0.95)'
                            }
                            strokeWidth={`${Math.max(0.003, (region.strokeWidth ?? 8) / 1000)}`}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        ))}
                        {draftStroke.length > 1 ? (
                          <polyline
                            points={draftStroke.map((p) => `${p.x},${p.y}`).join(' ')}
                            fill="none"
                            stroke={
                              drawTool === 'erase'
                                ? 'rgba(107,114,128,0.45)'
                                : activeKind === 'missing_caries'
                                  ? 'rgba(34,197,94,0.95)'
                                  : 'rgba(248,113,113,0.95)'
                            }
                            strokeWidth={`${Math.max(0.003, strokeWidth / 1000)}`}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeDasharray={drawTool === 'erase' ? '0.01 0.01' : undefined}
                          />
                        ) : null}
                        {drawTool === 'erase' && cursorPoint ? (
                          <circle
                            cx={cursorPoint.x}
                            cy={cursorPoint.y}
                            r={Math.max(0.006, strokeWidth / 1000)}
                            fill="rgba(107,114,128,0.12)"
                            stroke="rgba(75,85,99,0.9)"
                            strokeWidth="0.002"
                          />
                        ) : null}
                      </svg>
                    )
                  })()}
                </svg>
              </div>
            ) : (
              <div className="flex h-56 items-center justify-center rounded-md border bg-muted text-sm text-muted-foreground">
                No image URL available for this case.
              </div>
            )}

            <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
              <p className="text-base font-medium">Is this caries annotation correct?</p>
              <div className="flex gap-2">
                <Button
                  variant={decision === 'yes' ? 'default' : 'outline'}
                  onClick={() => setDecision('yes')}
                >
                  Yes
                </Button>
                <Button
                  variant={decision === 'no' ? 'default' : 'outline'}
                  onClick={() => setDecision('no')}
                >
                  No
                </Button>
              </div>
            </div>

            {decision === 'yes' ? (
              <Button onClick={handleSubmitYes} disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Submit Yes & Next'}
              </Button>
            ) : null}

            {decision === 'no' ? (
              <div className="space-y-3 rounded-xl border border-border/60 bg-muted/10 p-4">
                <p className="text-sm font-medium">
                  Hand-draw correction strokes directly on the image (required for "No")
                </p>
                <p className="text-sm text-muted-foreground">
                  Use red for incorrect labels, green for missing caries, and eraser to remove marks.
                </p>
                <p className="text-sm text-muted-foreground">
                  Regions drawn: {drawnRegions.length}
                </p>
                <textarea
                  placeholder="Optional dentist comment"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setDrawnRegions([])}
                    disabled={isSubmitting || drawnRegions.length === 0}
                  >
                    Clear Drawings
                  </Button>
                  <Button variant="outline" onClick={() => setDecision(null)} disabled={isSubmitting}>
                    Cancel
                  </Button>
                  <Button onClick={handleSubmitNo} disabled={isSubmitting}>
                    {isSubmitting ? 'Saving...' : 'Submit Correction & Next'}
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>

      {message ? (
        <p className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
      </div>
    </main>
  )
}

export default App
