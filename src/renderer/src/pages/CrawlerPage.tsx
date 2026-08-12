import React, { useState, useEffect } from 'react';
import { Globe, Loader2, ArrowRight, ExternalLink } from 'lucide-react';
import axios from 'axios';
import { baseUrl, getAuthHeaders } from '../utils/config';

const CrawlerPage = () => {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  
  const fetchH = () => axios.get(`${baseUrl}/api/crawler/history`, { headers: getAuthHeaders() }).then(res => setHistory(res.data.data || []));
  
  useEffect(() => { fetchH(); }, []);
  
  const crawl = async () => { 
    if(!url.trim() || loading) return; 
    setLoading(true); 
    setResult(null); 
    try { 
      const res = await axios.post(`${baseUrl}/api/crawler/run`, { url }, { headers: getAuthHeaders() }); 
      if (res.data.success) { 
        setResult(res.data.data); 
        fetchH(); 
      } 
    } finally { 
      setLoading(false); 
    } 
  };
  
  return (
    <div className="max-w-5xl mx-auto py-8 space-y-12">
      <div className="bg-white p-12 rounded-[3.5rem] shadow-xl border border-slate-100 relative overflow-hidden">
        <div className="flex items-center gap-3 mb-8"><Globe className="text-cyan-500" size={32} /><h2 className="text-3xl font-black text-slate-900">网页深潜</h2></div>
        <div className="flex gap-4"><input type="text" className="flex-1 px-8 py-5 bg-slate-50 rounded-3xl outline-none font-bold text-slate-700 border-none" placeholder="https://..." value={url} onChange={e => setUrl(e.target.value)} /><button onClick={crawl} disabled={loading || !url} className="px-12 py-5 bg-slate-900 text-white rounded-3xl font-black shadow-xl disabled:opacity-50 flex items-center gap-3">{loading ? <Loader2 className="animate-spin" size={24} /> : <ArrowRight size={24} />}开始</button></div>
        {result && <div className="mt-10 p-10 bg-indigo-50/50 rounded-[2.5rem] border border-indigo-100/50 text-slate-700 leading-relaxed font-medium whitespace-pre-wrap">{result}</div>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">{history.map(h => (
        <div key={h.id} className="bg-white p-8 rounded-3xl border border-slate-100 hover:shadow-md transition-all"><div className="flex justify-between items-start mb-4"><div className="flex items-center gap-2 text-[10px] font-black text-cyan-600 uppercase truncate max-w-[220px]"><ExternalLink size={10} />{h.url}</div></div><div className="text-xs text-slate-500 leading-relaxed line-clamp-4 italic">"{h.result?.content}"</div></div>
      ))}</div>
    </div>
  );
};

export default CrawlerPage;
