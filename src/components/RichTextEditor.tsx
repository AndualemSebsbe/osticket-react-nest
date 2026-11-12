import React, { useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  FileCode,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  Underline,
  Unlink,
  Upload,
  Video,
  X,
} from 'lucide-react'

export interface RichTextEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  minHeight?: string
  required?: boolean
  id?: string
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write message here...',
  disabled = false,
  className = '',
  minHeight = 'min-h-[180px]',
  id,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const [isHtmlMode, setIsHtmlMode] = useState(false)
  const [htmlSource, setHtmlSource] = useState(value || '')
  const [showLinkModal, setShowLinkModal] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkText, setLinkText] = useState('')
  const [showImageModal, setShowImageModal] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const [showVideoModal, setShowVideoModal] = useState(false)
  const [videoUrl, setVideoUrl] = useState('')
  const [isEmpty, setIsEmpty] = useState(!value || value === '<p><br></p>' || value === '<br>')
  const savedSelectionRef = useRef<Range | null>(null)

  // Synchronize external value into editor without resetting cursor position
  useEffect(() => {
    if (editorRef.current && !isHtmlMode) {
      if (editorRef.current.innerHTML !== (value || '')) {
        editorRef.current.innerHTML = value || ''
      }
    }
    setHtmlSource(value || '')
    checkEmpty(value || '')
  }, [value, isHtmlMode])

  function checkEmpty(content: string) {
    const textOnly = content.replace(/<[^>]*>/g, '').trim()
    const hasMedia = /<img|<iframe|<video|<audio/i.test(content)
    setIsEmpty(!hasMedia && textOnly.length === 0)
  }

  function handleContentChange() {
    if (!editorRef.current) return
    const currentHtml = editorRef.current.innerHTML
    checkEmpty(currentHtml)
    onChange(currentHtml)
  }

  function saveSelection() {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      savedSelectionRef.current = sel.getRangeAt(0).cloneRange()
    }
  }

  function restoreSelection() {
    if (savedSelectionRef.current) {
      const sel = window.getSelection()
      if (sel) {
        sel.removeAllRanges()
        sel.addRange(savedSelectionRef.current)
      }
    }
  }

  function exec(command: string, arg: string | undefined = undefined) {
    if (disabled || isHtmlMode) return
    editorRef.current?.focus()
    document.execCommand(command, false, arg)
    handleContentChange()
  }

  // Format selection as heading or paragraph
  function formatBlock(tag: string) {
    exec('formatBlock', tag)
  }

  // Insert Hyperlink
  function handleInsertLink(e: React.FormEvent) {
    e.preventDefault()
    if (!linkUrl.trim()) return

    let finalUrl = linkUrl.trim()
    if (!/^https?:\/\//i.test(finalUrl) && !/^mailto:/i.test(finalUrl)) {
      finalUrl = 'https://' + finalUrl
    }

    restoreSelection()
    editorRef.current?.focus()

    if (linkText.trim()) {
      const anchorHtml = `<a href="${finalUrl}" target="_blank" rel="noopener noreferrer" class="text-brand-600 underline">${linkText.trim()}</a>`
      document.execCommand('insertHTML', false, anchorHtml)
    } else {
      exec('createLink', finalUrl)
    }

    handleContentChange()
    setShowLinkModal(false)
    setLinkUrl('')
    setLinkText('')
  }

  // Insert Image (via URL or uploaded data URL)
  function handleInsertImage(url: string) {
    if (!url.trim()) return
    restoreSelection()
    editorRef.current?.focus()
    const imgHtml = `<img src="${url.trim()}" alt="Attached media" class="max-w-full h-auto rounded-lg my-2 inline-block border border-line shadow-sm" style="max-height: 400px;" />`
    document.execCommand('insertHTML', false, imgHtml)
    handleContentChange()
    setShowImageModal(false)
    setImageUrl('')
  }

  // Handle local image file upload
  function handleImageUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        handleInsertImage(reader.result)
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  // Insert Video Embed
  function handleInsertVideo(e: React.FormEvent) {
    e.preventDefault()
    const url = videoUrl.trim()
    if (!url) return

    restoreSelection()
    editorRef.current?.focus()

    let embedHtml = ''
    const ytMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/)
    const vimeoMatch = url.match(/vimeo\.com\/(?:channels\/(?:\w+\/)?|groups\/(?:[^\/]*)\/videos\/|album\/(?:\d+)\/video\/|video\/|)(\d+)/)

    if (ytMatch && ytMatch[1]) {
      embedHtml = `<div class="aspect-video my-3 overflow-hidden rounded-xl border border-line"><iframe src="https://www.youtube.com/embed/${ytMatch[1]}" class="w-full h-full" frameborder="0" allowfullscreen></iframe></div>`
    } else if (vimeoMatch && vimeoMatch[1]) {
      embedHtml = `<div class="aspect-video my-3 overflow-hidden rounded-xl border border-line"><iframe src="https://player.vimeo.com/video/${vimeoMatch[1]}" class="w-full h-full" frameborder="0" allowfullscreen></iframe></div>`
    } else {
      // Direct MP4 or video source
      embedHtml = `<video controls src="${url}" class="max-w-full rounded-xl my-3 border border-line max-h-96"></video>`
    }

    document.execCommand('insertHTML', false, embedHtml)
    handleContentChange()
    setShowVideoModal(false)
    setVideoUrl('')
  }

  // Toggle raw HTML view
  function toggleHtmlMode() {
    if (isHtmlMode) {
      onChange(htmlSource)
      setIsHtmlMode(false)
    } else {
      setHtmlSource(editorRef.current?.innerHTML || '')
      setIsHtmlMode(true)
    }
  }

  return (
    <div
      className={`relative flex flex-col rounded-xl border border-line bg-paper dark:bg-slate-900 transition focus-within:ring-2 focus-within:ring-brand-500 ${className} ${
        disabled ? 'opacity-60 pointer-events-none' : ''
      }`}
    >
      {/* HTML Rich Text Toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-slate-50/80 dark:bg-slate-800/60 p-1.5 rounded-t-xl text-ink-700 dark:text-slate-300">
        {/* Basic Text Formatting */}
        <div className="flex items-center gap-0.5 border-r border-line pr-1 mr-0.5">
          <button
            type="button"
            onClick={() => exec('bold')}
            className="rounded p-1.5 hover:bg-slate-200/70 dark:hover:bg-slate-700 hover:text-ink-900 dark:hover:text-white"
            title="Bold (Ctrl+B)"
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => exec('italic')}
            className="rounded p-1.5 hover:bg-slate-200/70 dark:hover:bg-slate-700 hover:text-ink-900 dark:hover:text-white"
            title="Italic (Ctrl+I)"
          >
            <Italic className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => exec('underline')}
            className="rounded p-1.5 hover:bg-slate-200/70 dark:hover:bg-slate-700 hover:text-ink-900 dark:hover:text-white"
            title="Underline (Ctrl+U)"
          >
            <Underline className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => exec('strikeThrough')}
            className="rounded p-1.5 hover:bg-slate-200/70 dark:hover:bg-slate-700 hover:text-ink-900 dark:hover:text-white"
            title="Strikethrough"
          >
            <Strikethrough className="h-4 w-4" />
          </button>
        </div>

        {/* Headings */}
        <div className="flex items-center gap-0.5 border-r border-line pr-1 mr-0.5">
          <button
            type="button"
            onClick={() => formatBlock('<h1>')}
            className="rounded p-1.5 hover:bg-slate-200/70 dark:hover:bg-slate-700 hover:text-ink-900"
            title="Heading 1"
          >
            <Heading1 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => formatBlock('<h2>')}
            className="rounded p-1.5 hover:bg-slate-200/70 dark:hover:bg-slate-700 hover:text-ink-900"
            title="Heading 2"
          >
            <Heading2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => formatBlock('<h3>')}
            className="rounded p-1.5 hover:bg-slate-200/70 dark:hover:bg-slate-700 hover:text-ink-900"
            title="Heading 3"
          >
            <Heading3 className="h-4 w-4" />
          </button>
        </div>

        {/* Lists & Quotes */}
        <div className="flex items-center gap-0.5 border-r border-line pr-1 mr-0.5">
          <button
            type="button"
            onClick={() => exec('insertUnorderedList')}
            className="rounded p-1.5 hover:bg-slate-200/70 dark:hover:bg-slate-700 hover:text-ink-900"
            title="Bulleted List"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => exec('insertOrderedList')}
            className="rounded p-1.5 hover:bg-slate-200/70 dark:hover:bg-slate-700 hover:text-ink-900"
            title="Numbered List"
          >
            <ListOrdered className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => formatBlock('<blockquote>')}
            className="rounded p-1.5 hover:bg-slate-200/70 dark:hover:bg-slate-700 hover:text-ink-900"
            title="Blockquote"
          >
            <Quote className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => formatBlock('<pre>')}
            className="rounded p-1.5 hover:bg-slate-200/70 dark:hover:bg-slate-700 hover:text-ink-900"
            title="Code Block"
          >
            <Code className="h-4 w-4" />
          </button>
        </div>

        {/* Text Alignments */}
        <div className="flex items-center gap-0.5 border-r border-line pr-1 mr-0.5">
          <button
            type="button"
            onClick={() => exec('justifyLeft')}
            className="rounded p-1.5 hover:bg-slate-200/70 dark:hover:bg-slate-700 hover:text-ink-900"
            title="Align Left"
          >
            <AlignLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => exec('justifyCenter')}
            className="rounded p-1.5 hover:bg-slate-200/70 dark:hover:bg-slate-700 hover:text-ink-900"
            title="Align Center"
          >
            <AlignCenter className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => exec('justifyRight')}
            className="rounded p-1.5 hover:bg-slate-200/70 dark:hover:bg-slate-700 hover:text-ink-900"
            title="Align Right"
          >
            <AlignRight className="h-4 w-4" />
          </button>
        </div>

        {/* Hyperlinks */}
        <div className="flex items-center gap-0.5 border-r border-line pr-1 mr-0.5">
          <button
            type="button"
            onClick={() => {
              saveSelection()
              setShowLinkModal(true)
            }}
            className="rounded p-1.5 hover:bg-slate-200/70 dark:hover:bg-slate-700 hover:text-ink-900"
            title="Attach Hyperlink"
          >
            <Link2 className="h-4 w-4 text-brand-600 dark:text-brand-400" />
          </button>
          <button
            type="button"
            onClick={() => exec('unlink')}
            className="rounded p-1.5 hover:bg-slate-200/70 dark:hover:bg-slate-700 hover:text-ink-900"
            title="Remove Hyperlink"
          >
            <Unlink className="h-4 w-4" />
          </button>
        </div>

        {/* Media: Photos & Videos */}
        <div className="flex items-center gap-0.5 border-r border-line pr-1 mr-0.5">
          <button
            type="button"
            onClick={() => {
              saveSelection()
              setShowImageModal(true)
            }}
            className="rounded p-1.5 hover:bg-slate-200/70 dark:hover:bg-slate-700 hover:text-ink-900"
            title="Upload or Insert Photo"
          >
            <ImageIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </button>
          <button
            type="button"
            onClick={() => {
              saveSelection()
              setShowVideoModal(true)
            }}
            className="rounded p-1.5 hover:bg-slate-200/70 dark:hover:bg-slate-700 hover:text-ink-900"
            title="Embed Video"
          >
            <Video className="h-4 w-4 text-purple-600 dark:text-purple-400" />
          </button>
        </div>

        {/* Source Code Toggle */}
        <div className="ml-auto flex items-center">
          <button
            type="button"
            onClick={toggleHtmlMode}
            className={`rounded px-2 py-1 text-xs font-semibold flex items-center gap-1 transition ${
              isHtmlMode
                ? 'bg-brand-600 text-white'
                : 'bg-slate-200/70 dark:bg-slate-700 hover:text-ink-900 text-ink-700'
            }`}
            title="Toggle HTML Source"
          >
            <FileCode className="h-3.5 w-3.5" />
            <span>HTML</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {isHtmlMode ? (
        <textarea
          value={htmlSource}
          onChange={(e) => {
            setHtmlSource(e.target.value)
            onChange(e.target.value)
          }}
          className={`w-full p-4 font-mono text-xs text-ink-800 dark:text-slate-100 bg-paper dark:bg-slate-900 outline-none resize-y ${minHeight}`}
          placeholder="Type or paste HTML markup..."
        />
      ) : (
        <div className="relative">
          {/* Visual Placeholder */}
          {isEmpty && (
            <div className="pointer-events-none absolute left-4 top-3 text-sm text-ink-400 dark:text-slate-500 select-none">
              {placeholder}
            </div>
          )}

          <div
            id={id}
            ref={editorRef}
            contentEditable={!disabled}
            onInput={handleContentChange}
            onBlur={handleContentChange}
            className={`w-full p-4 text-sm text-ink-800 dark:text-slate-100 outline-none leading-relaxed prose dark:prose-invert max-w-none ${minHeight}`}
            style={{ minHeight: '180px' }}
          />
        </div>
      )}

      {/* Link Modal */}
      {showLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-2.5">
              <h3 className="text-sm font-bold text-ink-800 dark:text-white flex items-center gap-2">
                <Link2 className="h-4 w-4 text-brand-600" /> Attach Hyperlink
              </h3>
              <button
                type="button"
                onClick={() => setShowLinkModal(false)}
                className="text-ink-400 hover:text-ink-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleInsertLink} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-ink-700 dark:text-slate-300 mb-1">
                  Destination URL *
                </label>
                <input
                  type="text"
                  required
                  placeholder="https://example.com"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-brand-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block font-semibold text-ink-700 dark:text-slate-300 mb-1">
                  Display Text (optional)
                </label>
                <input
                  type="text"
                  placeholder="Link label"
                  value={linkText}
                  onChange={(e) => setLinkText(e.target.value)}
                  className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-line">
                <button
                  type="button"
                  onClick={() => setShowLinkModal(false)}
                  className="rounded-xl border border-line px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-paper"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                >
                  Insert Link
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Image Modal */}
      {showImageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-2.5">
              <h3 className="text-sm font-bold text-ink-800 dark:text-white flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-emerald-600" /> Insert Photo or Image
              </h3>
              <button
                type="button"
                onClick={() => setShowImageModal(false)}
                className="text-ink-400 hover:text-ink-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-ink-700 dark:text-slate-300 mb-1">
                  Upload from Device
                </label>
                <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-line p-4 cursor-pointer hover:border-brand-500 bg-paper/40 transition">
                  <Upload className="h-6 w-6 text-ink-400 mb-1" />
                  <span className="font-medium text-ink-700 dark:text-slate-200">Choose Image File</span>
                  <span className="text-[10px] text-ink-400">PNG, JPG, GIF, WebP</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="relative flex items-center py-1">
                <div className="flex-grow border-t border-line"></div>
                <span className="mx-2 shrink text-[10px] uppercase text-ink-400 font-semibold">Or Image URL</span>
                <div className="flex-grow border-t border-line"></div>
              </div>

              <div>
                <input
                  type="url"
                  placeholder="https://example.com/photo.png"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-line">
                <button
                  type="button"
                  onClick={() => setShowImageModal(false)}
                  className="rounded-xl border border-line px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-paper"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!imageUrl.trim()}
                  onClick={() => handleInsertImage(imageUrl)}
                  className="rounded-xl bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  Insert Image
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Video Modal */}
      {showVideoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-2.5">
              <h3 className="text-sm font-bold text-ink-800 dark:text-white flex items-center gap-2">
                <Video className="h-4 w-4 text-purple-600" /> Embed Video
              </h3>
              <button
                type="button"
                onClick={() => setShowVideoModal(false)}
                className="text-ink-400 hover:text-ink-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleInsertVideo} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-ink-700 dark:text-slate-300 mb-1">
                  Video URL (YouTube, Vimeo, or MP4) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-brand-500"
                  autoFocus
                />
                <p className="mt-1 text-[11px] text-ink-400">
                  Paste a link to a YouTube, Vimeo, or direct video file to embed it inside the message.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-line">
                <button
                  type="button"
                  onClick={() => setShowVideoModal(false)}
                  className="rounded-xl border border-line px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-paper"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                >
                  Embed Video
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
