// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React from 'react'
import { Terminal, AlertCircle } from 'lucide-react'
import { Link } from 'react-router-dom'

export const ElectronOnlyMessage: React.FC<{ feature: string }> = ({ feature }) => {
  return (
    <div className="flex items-center justify-center h-[calc(100vh-10rem)]">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertCircle size={40} className="text-slate-400" />
        </div>
        
        <h2 className="text-2xl font-black text-slate-800 mb-3">
          功能暂不可用
        </h2>
        
        <p className="text-slate-500 mb-6 leading-relaxed">
          "{feature}" 功能需要连接后端服务器。<br />
          在 Electron 版本中，请使用 <strong>AI 终端</strong> 功能。
        </p>
        
        <Link 
          to="/"
          className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
        >
          <Terminal size={20} />
          返回 AI 终端
        </Link>
        
        <div className="mt-8 p-4 bg-amber-50 border border-amber-200 rounded-xl text-left">
          <div className="text-sm text-amber-800">
            <div className="font-bold mb-1">💡 提示</div>
            <div className="text-xs text-amber-700">
              如果需要使用完整功能，请在浏览器中访问 Web 版本。
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ElectronOnlyMessage
