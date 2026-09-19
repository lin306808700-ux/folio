// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React from 'react'
import { Loader2, Globe, Search, AlertCircle } from 'lucide-react'

interface SearchStatusProps {
  searchStatus: {
    searching: boolean
    keywords?: string
    phase?: 'searching' | 'analyzing'
    failed?: boolean
  }
}

export function SearchStatusDisplay({ searchStatus }: SearchStatusProps) {
  return (
    <>
      {/* 联网搜索状态 */}
      {searchStatus.searching && (
        <div className="flex gap-4 animate-in fade-in">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm bg-white border border-slate-200 text-cyan-500">
            {searchStatus.phase === 'analyzing' ? <Globe size={20} /> : <Search size={20} />}
          </div>
          <div className="px-6 py-4 rounded-[2rem] rounded-tl-none bg-cyan-50 border border-cyan-200 text-cyan-700 text-sm flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            {searchStatus.phase === 'analyzing'
              ? <>已搜索到结果，正在整理回复中...</>
              : <>联网查询中「{searchStatus.keywords}」...</>
            }
          </div>
        </div>
      )}

      {/* 搜索失败提示 */}
      {searchStatus.failed && !searchStatus.searching && (
        <div className="flex gap-4 animate-in fade-in">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm bg-white border border-slate-200 text-amber-500">
            <AlertCircle size={20} />
          </div>
          <div className="px-6 py-3 rounded-[2rem] rounded-tl-none bg-amber-50 border border-amber-200 text-amber-700 text-sm">
            搜索暂不可用，将使用已有知识回答「{searchStatus.keywords}」
          </div>
        </div>
      )}
    </>
  )
}
