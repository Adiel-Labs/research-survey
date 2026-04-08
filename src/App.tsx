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

import { Button } from '@/components/ui/button'
import { COLLECTIONS, SUPABASE_BUCKETS } from '@/lib/data-model'
import { db } from '@/lib/firebase'
import { getPublicImageUrl, uploadCorrectionOverlayBlob } from '@/lib/image-storage'
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

type DrawTool = 'draw' | 'erase'

function App() {
  const [cases, setCases] = useState<CaseRecord[]>([])
  const [activeCase, setActiveCase] = useState<CaseRecord | null>(null)
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
  const imageRef = useRef<HTMLImageElement | null>(null)
  const imageContainerRef = useRef<HTMLDivElement | null>(null)

  async function loadCases() {
    const casesQuery = query(collection(db, COLLECTIONS.cases), orderBy('createdAt', 'desc'))
    const snapshot = await getDocs(casesQuery)
    const result = snapshot.docs.map((item) => ({
      docId: item.id,
      data: item.data() as DentalCaseDocument,
    }))
    setCases(result)
  }

  function pickRandomCase(pool: CaseRecord[]) {
    if (pool.length === 0) {
      setActiveCase(null)
      return
    }
    const index = Math.floor(Math.random() * pool.length)
    setActiveCase(pool[index])
  }

  useEffect(() => {
    void loadCases()
  }, [])

  useEffect(() => {
    if (decision === 'no') {
      setDrawTool('draw')
    }
  }, [decision])

  const pendingCases = useMemo(
    () => cases.filter((item) => item.data.status !== 'validated'),
    [cases],
  )

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

  async function submitReview(nextDecision: ValidationDecision) {
    if (!activeCase) return

    setIsSubmitting(true)
    setMessage('')

    try {
      const reviewId = crypto.randomUUID()
      const now = new Date().toISOString()
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

      const reviewDoc: CaseReviewDocument = {
        reviewId,
        caseId: activeCase.data.caseId,
        reviewerId: 'demo-reviewer',
        reviewerName: 'Demo Reviewer',
        decision: nextDecision,
        comment: comment || undefined,
        correctionUploadPath,
        correctionUploadUrl,
        corrections: nextDecision === 'no' ? drawnRegions : [],
        submittedAt: now,
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
        updatedAt: now,
      })

      setDecision(null)
      setComment('')
      setDrawnRegions([])
      setMessage(`Saved "${nextDecision.toUpperCase()}" for case ${activeCase.data.caseId}.`)

      await loadCases()
      const remaining = pendingCases.filter((item) => item.docId !== activeCase.docId)
      pickRandomCase(remaining)
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

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Dental Caries Annotation Validation Platform</h1>
        <p className="text-sm text-muted-foreground">
          Existing images are reviewed case-by-case. Select Yes/No and submit to Firestore.
        </p>
      </header>

      <section className="space-y-4 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Validation Queue</h2>
          <Button
            onClick={() => pickRandomCase(pendingCases)}
            disabled={pendingCases.length === 0 || isSubmitting}
          >
            Random Case
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Pending cases: {pendingCases.length} / Total cases: {cases.length}
        </p>
      </section>

      <section className="space-y-4 rounded-lg border p-4">
        {!activeCase ? (
          <p className="text-sm text-muted-foreground">
            Click <strong>Random Case</strong> to start validation.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Case ID: {activeCase.data.caseId}</p>
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
                className="relative max-h-[420px] w-full select-none overflow-hidden rounded-md border touch-none"
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

            <div className="space-y-2">
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
              <div className="space-y-3 rounded-md border p-3">
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
                  className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
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

      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
    </main>
  )
}

export default App
