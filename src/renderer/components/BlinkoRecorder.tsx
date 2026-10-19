/**
 * Voice-note recorder, ported from Blinko's `AudioDialog`/`AudioRecorder`.
 *
 * Same behaviour: recording starts the moment the dialog opens, the label
 * shows REC with a pulsing dot, a 30-bar spectrum scrolls behind a big
 * mm:ss.cs timer, the green button stops, then you either keep or discard.
 * On keep, the webm is handed back to be saved into the vault.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Mic, X } from 'lucide-react'
import { clockTime } from '../blinkoAssets'

const BAR_COUNT = 30

export interface RecordedVoice {
  blob: Blob
  /** file extension matching the recorded mime */
  ext: string
  /** duration in whole seconds */
  seconds: number
}

function pickMime(): { mime: string; ext: string } {
  const candidates: Array<[string, string]> = [
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/webm', 'webm'],
    ['audio/mp4', 'm4a'],
    ['audio/ogg;codecs=opus', 'ogg']
  ]
  const MR: typeof MediaRecorder | undefined = window.MediaRecorder
  for (const [mime, ext] of candidates) {
    if (MR && typeof MR.isTypeSupported === 'function' && MR.isTypeSupported(mime)) return { mime, ext }
  }
  return { mime: '', ext: 'webm' }
}

export function BlinkoRecorder({
  onDone,
  onClose
}: {
  onDone: (voice: RecordedVoice) => void
  onClose: () => void
}): JSX.Element {
  const [state, setState] = useState<'starting' | 'recording' | 'stopped' | 'denied'>('starting')
  const [levels, setLevels] = useState<number[]>(() => Array(BAR_COUNT).fill(3))
  const [ms, setMs] = useState(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const blobRef = useRef<Blob | null>(null)
  const extRef = useRef('webm')
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef(0)

  const stopVisualiser = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    if (tickRef.current) clearInterval(tickRef.current)
    tickRef.current = null
    try {
      sourceRef.current?.disconnect()
    } catch {
      // already gone
    }
    sourceRef.current = null
    analyserRef.current = null
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      void audioCtxRef.current.close().catch(() => undefined)
    }
    audioCtxRef.current = null
  }, [])

  const teardown = useCallback(() => {
    stopVisualiser()
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop()
      } catch {
        // ignore
      }
    }
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [stopVisualiser])

  const stopRecording = useCallback(() => {
    setState((s) => (s === 'recording' ? 'stopped' : s))
    const rec = recorderRef.current
    if (rec && rec.state === 'recording') {
      try {
        rec.stop()
      } catch {
        // ignore
      }
    }
    stopVisualiser()
  }, [stopVisualiser])

  useEffect(() => {
    let alive = true
    const start = async (): Promise<void> => {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch {
        if (alive) setState('denied')
        return
      }
      if (!alive) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream

      const { mime, ext } = pickMime()
      extRef.current = ext
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      recorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        blobRef.current = new Blob(chunksRef.current, { type: recorder.mimeType || mime || 'audio/webm' })
      }
      recorder.start()
      startedAtRef.current = Date.now()
      setState('recording')

      // ── live spectrum, like Blinko's analyser (low/mid weighted) ──
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ctx = new Ctx()
        audioCtxRef.current = ctx
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 128
        analyser.smoothingTimeConstant = 0.7
        analyserRef.current = analyser
        const source = ctx.createMediaStreamSource(stream)
        source.connect(analyser)
        sourceRef.current = source

        const paint = (): void => {
          const a = analyserRef.current
          if (!a) return
          const data = new Uint8Array(a.frequencyBinCount)
          a.getByteFrequencyData(data)
          let sum = 0
          for (let i = 0; i < data.length; i++) {
            const weight = i < data.length / 3 ? 1.5 : i < (data.length * 2) / 3 ? 1.2 : 0.8
            sum += (data[i] ?? 0) * weight
          }
          const scaled = Math.max((sum / data.length) * 1.5, 3)
          setLevels((prev) => {
            const next = prev.slice(1)
            next.push(scaled)
            return next
          })
          rafRef.current = requestAnimationFrame(paint)
        }
        rafRef.current = requestAnimationFrame(paint)
      } catch {
        // visualiser is decorative — keep recording without it
      }

      tickRef.current = setInterval(() => setMs(Date.now() - startedAtRef.current), 100)
    }

    void start()
    return () => {
      alive = false
      teardown()
    }
  }, [teardown])

  const keep = (): void => {
    const blob = blobRef.current
    if (!blob) return
    const seconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000))
    teardown()
    onDone({ blob, ext: extRef.current, seconds })
  }

  const seconds = Math.floor(ms / 1000)
  const centis = Math.floor((ms % 1000) / 10)

  return (
    <div className="blp-rec-overlay" role="dialog" aria-label="Voice recording">
      <div className="blp-rec">
        {state === 'denied' ? (
          <div className="blp-rec-denied">
            <Mic size={30} />
            <h3>Microphone access needed</h3>
            <p>Allow microphone access to record voice notes on a card.</p>
            <button className="blp-rec-discard" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="blp-rec-head">
              <span>REC</span>
              {state === 'recording' && <i className="blp-rec-dot" />}
            </div>
            <div className="blp-rec-bars" aria-hidden="true">
              {levels.map((v, i) => (
                <span key={i} style={{ height: `${Math.min(v, 100)}%`, opacity: state === 'recording' ? 1 : 0.5 }} />
              ))}
            </div>
            <div className="blp-rec-time">
              {clockTime(seconds)}.{String(centis).padStart(2, '0')}
            </div>
            <div className="blp-rec-actions">
              {state === 'recording' ? (
                <button className="blp-rec-stop" title="Stop" onClick={stopRecording}>
                  <span />
                </button>
              ) : (
                <>
                  <button className="blp-rec-discard" title="Discard" onClick={onClose}>
                    <X size={26} />
                  </button>
                  <button className="blp-rec-keep" title="Keep" onClick={keep}>
                    <Check size={26} />
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
