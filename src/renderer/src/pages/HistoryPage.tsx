import React, { useState, useEffect } from 'react';
import { Clock, Loader2, User, Bot, X, MessageCircle } from 'lucide-react';
import { isElectron } from '../utils/config';
import PageShell from '../components/PageShell';

interface HistoryItem {
  id: string;
  query: string;
  result: { content: string };
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  created_at: string;
}

const SessionDetailModal = ({ item, onClose }: { item: HistoryItem; onClose: () => void }) => {
  const messages = item.messages && item.messages.length > 0
    ? item.messages
    : [
        { role: 'user' as const, content: item.query },
        { role: 'assistant' as const, content: item.result?.content || '' }
      ];

  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-border-subtle bg-inset shadow-2xl shadow-black/20"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 弹窗头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle/60 dark:border-slate-700/40 shrink-0">
          <div className="flex items-center gap-2 text-text-muted text-xs">
            <Clock size={12} />
            {new Date(item.created_at).toLocaleString()}
          </div>
          <button onClick={onClose} className="text-text-faint hover:text-text-secondary transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* 对话内容 */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 scroll-container">
          {messages.map((msg, index) => (
            <div key={index} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-violet-500/15 ring-1 ring-violet-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot size={13} className="text-violet-500 dark:text-violet-400" />
                </div>
              )}
              <div className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-bubble-user text-bubble-user-text dark:bg-slate-700/80 dark:text-slate-100 rounded-tr-sm'
                  : 'bg-elevated text-text-secondary dark:bg-slate-800/60 dark:text-slate-200 rounded-tl-sm border border-border-subtle/60 dark:border-slate-700/40'
              }`}>
                {msg.content}
              </div>
              {msg.role === 'user' && (
                <div className="w-7 h-7 rounded-full bg-elevated dark:bg-slate-600/60 ring-1 ring-border-subtle dark:ring-slate-500/30 flex items-center justify-center shrink-0 mt-0.5">
                  <User size={13} className="text-text-muted dark:text-slate-300" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const HistoryPage = () => {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (isElectron) {
        const data = await (window as any).electronAPI.db.history.getAll();
        // 按 query 去重，保留最新的一条
        const seen = new Set<string>();
        const deduped = (data || []).filter((item: HistoryItem) => {
          const key = item.query?.trim();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setHistory(deduped);
      } else {
        setHistory([]);
      }
    } catch (error) {
      console.error('获取历史失败:', error);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  return (
    <PageShell
      title="历史"
      description="浏览之前的对话记录"
      count={loading ? '加载中' : `${history.length} 条`}
    >
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-violet-500 dark:text-violet-400" size={32} />
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-24 text-text-faint">
            <MessageCircle size={40} className="mx-auto mb-3" />
            <p className="text-sm font-medium">暂无对话记录</p>
          </div>
        ) : (
          <div className="space-y-2">
            {history.map(item => (
              <div
                key={item.id}
                onClick={() => setSelectedItem(item)}
                className="group cursor-pointer rounded-lg border border-border-subtle/50 bg-surface/[0.05] px-5 py-4 transition-colors hover:border-border-strong/60 hover:bg-surface/[0.1]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-primary truncate">{item.query}</div>
                    <div className="text-xs text-text-muted mt-1 line-clamp-1 leading-relaxed">
                      {item.result?.content}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.messages && item.messages.length > 0 && <span className="text-[10px] text-text-faint">{item.messages.length} 条</span>}
                    <span className="text-[11px] text-text-faint">
                      {new Date(item.created_at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      {selectedItem && (
        <SessionDetailModal item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}
    </PageShell>
  );
};

export default HistoryPage;
