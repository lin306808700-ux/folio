import React, { useState, useEffect } from 'react';
import { Brain, Loader2, RefreshCw, Trash2, X } from 'lucide-react';
import { isElectron } from '../utils/config';

const MemoryPage = () => {
  const [summaries, setSummaries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [editingSummary, setEditingSummary] = useState<any>(null);

  const fetchAll = async () => {
    setLoading(true);
    try {
      if (isElectron) {
        const sumData = await (window as any).electronAPI.db.memorySummary.getAll();
        setSummaries(sumData.filter((s: any) => s.status === 'active'));
      } else {
        setSummaries([]);
      }
    } catch (error) {
      console.error('获取记忆失败:', error);
      setSummaries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const delSummary = async (id: string) => {
    if (!confirm('确定要删除这条记忆吗？')) return;
    try {
      await (window as any).electronAPI.db.memorySummary.delete(id);
      fetchAll();
    } catch (error) {
      alert('删除失败');
    }
  };

  const openEdit = (summary: any) => {
    setEditingSummary({ ...summary });
    setShowEdit(true);
  };

  const handleUpdate = async () => {
    if (!editingSummary || !editingSummary.summary?.trim()) {
      alert('请输入记忆内容');
      return;
    }
    try {
      await (window as any).electronAPI.db.memorySummary.update(editingSummary.id, { summary: editingSummary.summary });
      setShowEdit(false);
      setEditingSummary(null);
      fetchAll();
    } catch (error) {
      alert('更新失败');
    }
  };

  return (
    <div className="max-w-5xl mx-auto py-8">
      <div className="flex items-center justify-between mb-10">
        <h2 className="text-3xl font-black flex items-center gap-3"><Brain className="text-indigo-500" />记忆中心</h2>
        <div className="text-sm text-slate-400">
          记忆会自动归纳整理，无需手动操作
        </div>
      </div>

      {loading ? <Loader2 className="animate-spin mx-auto text-indigo-200" size={40} /> : (
        <>
          {summaries.length > 0 ? (
            <div className="space-y-6">
              {summaries.map(s => (
                <div key={s.id} className="bg-purple-50/80 p-8 rounded-[2rem] border border-purple-100 shadow-sm relative group hover:shadow-lg transition-all">
                  <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(s)} className="text-purple-200 hover:text-indigo-500" title="编辑"><RefreshCw size={16} /></button>
                    <button onClick={() => delSummary(s.id)} className="text-purple-200 hover:text-rose-500" title="删除"><Trash2 size={16} /></button>
                  </div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="px-3 py-1 bg-purple-100 text-purple-700 text-[10px] font-black rounded-full uppercase">
                      {s.sourceCount} 条记忆归纳
                    </div>
                    <span className="text-[10px] text-purple-300 font-bold">{new Date(s.created_at).toLocaleString()}</span>
                  </div>
                  <div className="text-slate-700 leading-relaxed whitespace-pre-wrap text-sm">{s.summary}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-20 opacity-30">
              <Brain size={48} className="mx-auto mb-4" />
              <p className="font-bold text-slate-600">暂无记忆</p>
              <p className="text-sm text-slate-400 mt-2">对话中重要信息会自动保存并归纳</p>
            </div>
          )}
        </>
      )}

      {/* 编辑弹窗 */}
      {showEdit && editingSummary && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-[2.5rem] p-10 shadow-2xl animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-2xl font-black">编辑记忆</h3>
              <button onClick={() => setShowEdit(false)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
            </div>
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">记忆内容</label>
                <textarea
                  className="w-full px-5 py-4 bg-slate-50 rounded-xl outline-none focus:ring-2 focus:ring-purple-500 h-64 resize-none"
                  placeholder="输入记忆内容..."
                  value={editingSummary.summary}
                  onChange={e => setEditingSummary({ ...editingSummary, summary: e.target.value })}
                />
              </div>
              <button onClick={handleUpdate} className="w-full py-4 bg-purple-600 text-white rounded-2xl font-black shadow-xl hover:bg-purple-700 transition-all">
                保存修改
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MemoryPage;
