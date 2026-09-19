// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { useState, useEffect } from 'react'
import { Loader2, FolderOpen, X, ZoomIn, Copy } from 'lucide-react'

export function BrowserScreenshot({ filename }: { filename: string }) {
  const [imageData, setImageData] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [fullPath, setFullPath] = useState<string>('')

  useEffect(() => { loadScreenshot() }, [filename])

  const loadScreenshot = async () => {
    if (!window.electronAPI?.task?.getScreenshot) { setError('截图功能不可用'); setLoading(false); return }
    try {
      const result = await window.electronAPI.task.getScreenshot(filename)
      if (result.success && result.data) {
        setImageData(`data:${result.mimeType};base64,${result.data}`)
        setFullPath(result.fullPath || filename)
      }
      else setError(result.error || '加载截图失败')
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const handleOpenInFolder = async () => {
    if (!window.electronAPI?.task?.openInFolder) {
      setError('打开目录功能不可用')
      return
    }
    try {
      await window.electronAPI.task.openInFolder(filename)
    } catch (e: any) {
      setError(`打开目录失败: ${e.message}`)
    }
  }

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(fullPath)
    } catch (e) {
      console.error('复制失败:', e)
    }
  }

  if (loading) return <div className="mt-3 p-4 bg-slate-50 rounded-lg flex items-center justify-center"><Loader2 className="animate-spin mr-2" size={16} /><span className="text-sm text-slate-500">加载截图...</span></div>
  if (error) return <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg"><span className="text-sm text-red-600">截图加载失败: {error}</span></div>

  return (
    <div className="mt-3">
      {/* 文件信息栏 */}
      <div className="flex items-center justify-between mb-2 px-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-xs text-slate-500 truncate font-mono" title={fullPath}>
            📸 {fullPath}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopyPath}
            className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-400 hover:text-slate-600"
            title="复制路径"
          >
            <Copy size={12} />
          </button>
          <button
            onClick={handleOpenInFolder}
            className="flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors text-xs text-slate-600"
            title="打开所在目录"
          >
            <FolderOpen size={12} />
            <span>打开目录</span>
          </button>
        </div>
      </div>

      {/* 截图预览 */}
      <div className="relative group cursor-pointer overflow-hidden rounded-lg border border-slate-200" onClick={() => setShowModal(true)}>
        <img src={imageData!} alt="网页截图" className="w-full h-auto max-h-96 object-contain bg-slate-100" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
          <span className="px-3 py-1 bg-black/70 text-white text-sm rounded-full flex items-center gap-1.5">
            <ZoomIn size={14} />
            点击放大查看
          </span>
        </div>
      </div>

      {/* 放大查看模态框 */}
      {showModal && imageData && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setShowModal(false)}
        >
          <div className="relative max-w-6xl max-h-[90vh] w-full" onClick={(e) => e.stopPropagation()}>
            {/* 关闭按钮 */}
            <button
              onClick={() => setShowModal(false)}
              className="absolute -top-12 right-0 p-2 text-white/80 hover:text-white transition-colors"
              title="关闭"
            >
              <X size={24} />
            </button>

            {/* 图片 */}
            <img
              src={imageData}
              alt="网页截图（放大）"
              className="w-full h-auto max-h-[90vh] object-contain rounded-lg shadow-2xl"
            />

            {/* 底部信息 */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/70 text-white text-sm rounded-full backdrop-blur-sm">
              {fullPath}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
