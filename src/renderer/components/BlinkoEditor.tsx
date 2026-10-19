/**
 * Blinko's card editor.
 *
 * Blinko edits notes with Vditor in `ir` (instant-rendering) mode — markdown
 * syntax stays visible but headings, bold, lists, tables, code, images and
 * math render inline as you type. We mount the same editor with the same
 * toolbar and the same `#hashtag` hint, so writing on a card feels identical.
 *
 * Unlike Blinko (which uploads to its server) files are written straight into
 * the vault and referenced with `vault:///…`; paste, drop and the file button
 * all funnel through the same path.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import { ImagePlus, Loader2, Mic } from 'lucide-react'
import { useStore } from '../store'
import { assetMarkdown, saveVaultAsset } from '../blinkoAssets'
import { BlinkoRecorder, type RecordedVoice } from './BlinkoRecorder'

/** Blinko's desktop toolbar, minus the bits that need its server/AI. */
const TOOLBAR = [
  'emoji',
  'headings',
  'bold',
  'italic',
  'strike',
  'link',
  'list',
  'ordered-list',
  'check',
  'table',
  'code',
  'inline-code',
  '|',
  'undo',
  'redo'
]

export interface BlinkoEditorHandle {
  insert: (markdown: string) => void
  clear: () => void
  focus: () => void
  getValue: () => string
}

export interface BlinkoEditorProps {
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
  placeholder?: string
  minHeight?: number
  autoFocus?: boolean
  /** vault path of the `.blinko` workspace, used to place assets */
  target: string
  /** known tags, offered when typing `#` */
  tags: string[]
  onError?: (message: string) => void
}

export const BlinkoEditor = forwardRef<BlinkoEditorHandle, BlinkoEditorProps>(function BlinkoEditor(
  { value, onChange, onSubmit, placeholder, minHeight = 44, autoFocus, target, tags, onError },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const vditorRef = useRef<Vditor | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const tagsRef = useRef<string[]>(tags)
  const targetRef = useRef(target)
  const onChangeRef = useRef(onChange)
  const onSubmitRef = useRef(onSubmit)
  const onErrorRef = useRef(onError)
  const dark = useStore((s) => s.mode) === 'dark'
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)

  tagsRef.current = tags
  targetRef.current = target
  onChangeRef.current = onChange
  onSubmitRef.current = onSubmit
  onErrorRef.current = onError

  /** Save dropped/pasted/picked files into the vault and insert the markdown. */
  const insertFiles = useCallback(async (files: File[]): Promise<void> => {
    if (files.length === 0) return
    setBusy(true)
    try {
      const parts: string[] = []
      for (const file of files) {
        const asset = await saveVaultAsset(targetRef.current, file)
        parts.push(assetMarkdown(asset))
      }
      vditorRef.current?.insertValue(parts.join('\n'))
    } catch (err) {
      onErrorRef.current?.(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [])
  const insertFilesRef = useRef(insertFiles)
  insertFilesRef.current = insertFiles

  // The Vditor instance is created once per theme; everything else is read
  // through refs so typing never tears the editor down.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let destroyed = false

    const editor = new Vditor(host, {
      cdn: './vditor',
      mode: 'ir',
      theme: dark ? 'dark' : 'classic',
      lang: 'en_US',
      width: '100%',
      minHeight,
      placeholder: placeholder ?? '',
      cache: { enable: false },
      resize: { enable: false },
      outline: { enable: false, position: 'left' },
      counter: { enable: false },
      toolbar: TOOLBAR,
      toolbarConfig: { hide: false },
      tab: '\t',
      undoDelay: 20,
      preview: {
        delay: 20,
        theme: { current: dark ? 'dark' : 'light', path: './vditor/dist/css/content-theme' },
        hljs: { enable: true, style: dark ? 'github-dark' : 'github', lineNumber: true },
        math: { engine: 'KaTeX', inlineDigit: false }
      },
      hint: {
        extend: [
          {
            key: '#',
            hint(query: string): IHintData[] {
              const needle = query.replace('#', '').toLowerCase()
              return tagsRef.current
                .filter((t) => t.toLowerCase().includes(needle))
                .map((t) => ({
                  html: `<span class="blp-tag-hint">#${t}</span>`,
                  value: `#${t}&nbsp;`
                }))
            }
          }
        ]
      },
      upload: {
        handler: async (files: File[]) => {
          await insertFilesRef.current(files.filter((f) => f instanceof File) as File[])
          return null
        },
        max: 30 * 1024 * 1024,
        multiple: true,
        accept: 'image/*,audio/*,video/*,.pdf,.txt,.md,.json,.csv'
      },
      value,
      input: (v: string) => onChangeRef.current(v),
      ctrlEnter: () => onSubmitRef.current?.(),
      after: () => {
        if (destroyed) return
        vditorRef.current = editor
        if (value) editor.setValue(value)
        if (autoFocus) editor.focus()
      }
    })

    return () => {
      destroyed = true
      vditorRef.current = null
      try {
        editor.destroy()
      } catch {
        // already gone
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark])

  // Pull in external value changes (submit clears, switching edited card).
  useEffect(() => {
    const editor = vditorRef.current
    if (!editor) return
    if (value !== editor.getValue()) editor.setValue(value || '')
  }, [value])

  useImperativeHandle(
    ref,
    () => ({
      insert: (markdown: string) => vditorRef.current?.insertValue(markdown),
      clear: () => {
        vditorRef.current?.setValue('')
        onChangeRef.current('')
      },
      focus: () => vditorRef.current?.focus(),
      getValue: () => vditorRef.current?.getValue() ?? ''
    }),
    []
  )

  const onVoice = async (voice: RecordedVoice): Promise<void> => {
    setRecording(false)
    const name = `voice-note.${voice.ext}`
    const file = new File([voice.blob], name, { type: voice.blob.type || 'audio/webm' })
    try {
      setBusy(true)
      const asset = await saveVaultAsset(targetRef.current, file, name)
      vditorRef.current?.insertValue(`\n${assetMarkdown(asset)}\n`)
    } catch (err) {
      onErrorRef.current?.(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="blp-editor" data-busy={busy ? '1' : undefined}>
      <div className="blp-editor-host" ref={hostRef} />
      <div className="blp-editor-tools">
        <button
          type="button"
          className="blp-icon-btn"
          title="Insert image or file"
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus size={15} />
        </button>
        <button
          type="button"
          className="blp-icon-btn"
          title="Record a voice note"
          onClick={() => setRecording(true)}
        >
          <Mic size={15} />
        </button>
        {busy && <Loader2 size={14} className="blp-spin" />}
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          accept="image/*,audio/*,video/*,.pdf,.txt,.md,.json,.csv"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            void insertFiles(files)
          }}
        />
      </div>
      {recording && <BlinkoRecorder onDone={(v) => void onVoice(v)} onClose={() => setRecording(false)} />}
    </div>
  )
})
