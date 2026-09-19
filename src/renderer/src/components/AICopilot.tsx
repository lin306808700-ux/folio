import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { X, Loader2, Sparkles, ChevronRight } from 'lucide-react';
import axios from 'axios';
import { baseUrl, getAuthHeaders } from '../utils/config';

interface AICopilotProps {
  onSelectQuestion: (q: string) => void;
}

const AICopilot = ({ onSelectQuestion }: AICopilotProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const location = useLocation();

  const fetchSuggestions = async () => {
    if (!baseUrl) return;
    setLoading(true);
    try {
      const res = await axios.post(`${baseUrl}/api/copilot/suggest`, {
        pageType: location.pathname,
        context: "用户浏览 " + location.pathname
      }, { headers: getAuthHeaders() });
      setSuggestions(res.data.data || []);
    } catch (err) {
      setSuggestions(["Muse 能帮我做什么？", "帮我分析系统状态"]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (isOpen) fetchSuggestions(); }, [isOpen, location.pathname]);

  return (
    <div className="fixed bottom-10 right-10 z-[100] flex flex-col items-end gap-5">
      {isOpen && (
        <div className="w-80 bg-white/95 backdrop-blur-2xl rounded-[2.5rem] shadow-2xl border border-slate-100 p-8 animate-in zoom-in-95">
          <div className="flex items-center justify-between mb-6">
            <span className="font-bold text-slate-800">智能副驾</span>
            <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors"><X size={16} /></button>
          </div>
          <div className="space-y-4">
            {loading ? <div className="py-4 text-center"><Loader2 className="animate-spin inline-block text-indigo-500" /></div> : (
              suggestions.map((s, i) => (
                <button key={i} onClick={() => { onSelectQuestion(s); setIsOpen(false); }} className="w-full text-left px-4 py-3 bg-slate-50 hover:bg-indigo-50 rounded-xl text-sm transition-all border border-transparent hover:border-indigo-100 flex justify-between items-center group">
                  <span className="truncate flex-1 pr-2">{s}</span>
                  <ChevronRight size={14} className="opacity-0 group-hover:opacity-100 flex-shrink-0" />
                </button>
              ))
            )}
          </div>
        </div>
      )}
      <button onClick={() => setIsOpen(!isOpen)} className={`w-16 h-16 rounded-full flex items-center justify-center text-white shadow-2xl transition-all active:scale-95 ${isOpen ? 'bg-slate-900 rotate-90' : 'bg-indigo-600 shadow-indigo-200'}`}>
        {isOpen ? <X size={28} /> : <Sparkles size={28} />}
      </button>
    </div>
  );
};

export default AICopilot;
