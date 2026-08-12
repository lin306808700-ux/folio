import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Zap, Loader2, Trash2, FolderOpen, RefreshCw, Search, Plus,
  AlertTriangle, GitBranch, Settings, BarChart2, Sparkles, X, Upload,
  FileText, ToggleRight, ToggleLeft,
} from 'lucide-react';
import { isElectron } from '../utils/config';
import PageShell from '../components/PageShell';

const api = (window as any).electronAPI;

interface Skill {
  id: string;
  name: string;
  description: string;
  content?: string;
  version?: string;
  triggers?: string[];
  inputs?: Record<string, any>;
  sideEffects?: string[];
  dangerous?: boolean;
  onError?: string;
  source?: string;
  scriptFile?: string;
  enabled?: boolean;
  autoExecute?: boolean;
  depends?: string[];
}

interface SkillStats {
  activations: number;
  successes: number;
  failures: number;
  lastUsed: string | null;
}

const SkillsPage = () => {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [stats, setStats] = useState<Record<string, SkillStats>>({});
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [toast, setToast] = useState<{ show: boolean; message: string; type: 'success' | 'error' }>({ show: false, message: '', type: 'success' });
  const [creating, setCreating] = useState(false);
  const [createDesc, setCreateDesc] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);


  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast(s => ({ ...s, show: false })), 2500);
  };

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    try {
      const data = isElectron ? await api.db.skills.getAll() : [];
      setSkills(data || []);
    } catch {
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const result = isElectron ? await api.db.skills.stats?.() : null;
      if (result?.success) setStats(result.data || {});
    } catch {}
  }, []);

  useEffect(() => {
    fetchSkills();
    fetchStats();
  }, []);

  useEffect(() => {
    if (!isElectron || !api?.db?.skills?.onChanged) return;
    const cleanup = api.db.skills.onChanged(() => fetchSkills());
    return cleanup;
  }, []);

  const filteredSkills = useMemo(() => {
    const kw = searchText.toLowerCase();
    if (!kw) return skills;
    return skills.filter(s =>
      s.name.toLowerCase().includes(kw) ||
      s.description?.toLowerCase().includes(kw) ||
      s.triggers?.some(t => t.toLowerCase().includes(kw))
    );
  }, [skills, searchText]);

  const openSkillFolder = (skill: Skill) => {
    api?.shell?.showItemInFolder?.(skill.id ? `${process.env.HOME || ''}/.ai-terminal/skills/${skill.id}` : '');
  };

  const deleteSkill = async (id: string) => {
    if (!confirm('确定删除此技能？')) return;
    try {
      await api.db.skills.delete(id);
      if (selectedSkill?.id === id) setSelectedSkill(null);
      await fetchSkills();
      showToast('技能已删除');
    } catch {
      showToast('删除失败', 'error');
    }
  };

  const toggleEnabled = async (skill: Skill) => {
    try {
      await api.db.skills.setEnabled(skill.id, !skill.enabled);
      await fetchSkills();
      showToast(`${skill.enabled ? '已禁用' : '已启用'}: ${skill.name}`);
    } catch {
      showToast('操作失败', 'error');
    }
  };

  const handleCreate = async () => {
    if (!createDesc.trim()) return;
    setCreateLoading(true);
    try {
      const result = await api.db.skills.create({ description: createDesc });
      if (result?.success) {
        showToast(`技能「${result.skill?.name}」创建成功`);
        setCreating(false);
        setCreateDesc('');
        await fetchSkills();
      } else {
        showToast(result?.error || '创建失败', 'error');
      }
    } catch (error: any) {
      showToast(error.message || '创建失败', 'error');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleZipInstall = async () => {
    try {
      const selectResult = await api.db.skills.selectZipFile();
      if (!selectResult?.success || selectResult?.canceled) return;
      const result = await api.db.skills.installFromZip({ zipPath: selectResult.filePath });
      if (result?.success) {
        showToast(`技能「${result.skill?.name}」安装成功`);
        await fetchSkills();
      } else {
        showToast(result?.error || '安装失败', 'error');
      }
    } catch (error: any) {
      showToast(error.message || 'zip 安装失败', 'error');
    }
  };

  const getSuccessRate = (skillId: string) => {
    const s = stats[skillId];
    if (!s || s.activations === 0) return null;
    return Math.round((s.successes / s.activations) * 100);
  };


  return (
    <PageShell
      title="技能"
      description="管理 Muse 可调用的能力和工具"
      count={!loading ? `${skills.length} 个` : '加载中'}
      actions={<>
        <button onClick={fetchSkills} className="p-2 text-text-faint transition-colors hover:text-text-primary" title="刷新">
          <RefreshCw size={14} />
        </button>
        <button onClick={handleZipInstall} className="flex items-center gap-1.5 rounded-md px-3 py-2 text-xs text-text-muted transition-colors hover:bg-text-primary/[0.05] hover:text-text-primary">
          <Upload size={13} /> 导入
        </button>
        <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 rounded-md bg-text-primary px-3 py-2 text-xs font-medium text-inset transition-opacity hover:opacity-90">
          <Plus size={13} /> 创建
        </button>
      </>}
      toolbar={
        <div className="relative w-full max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint" />
          <input
            value={searchText}
            onChange={event => setSearchText(event.target.value)}
            placeholder="搜索名称、描述或触发词"
            className="w-full rounded-lg border border-border-subtle/60 bg-surface/[0.06] py-2 pl-9 pr-3 text-xs text-text-primary placeholder-text-faint focus:border-border-strong focus:outline-none"
          />
        </div>
      }
      contentClassName="!overflow-hidden !p-0"
    >
    <div className="flex h-full overflow-hidden text-text-secondary">
      {/* 左侧列表 */}
      <div className="flex flex-col w-full max-w-sm border-r border-border-subtle/60 overflow-hidden flex-shrink-0">
        {/* 技能列表 */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5 scroll-container">
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="animate-spin text-violet-400" size={24} /></div>
          ) : filteredSkills.length === 0 ? (
            <div className="text-center py-16">
              <Zap size={32} className="mx-auto text-text-faint/40 mb-2" />
              <p className="text-xs text-text-muted">{searchText ? '无匹配技能' : '暂无技能'}</p>
              {!searchText && (
                <button onClick={() => setCreating(true)} className="mt-3 text-xs text-violet-500 hover:text-violet-400">
                  + 创建第一个技能
                </button>
              )}
            </div>
          ) : filteredSkills.map(skill => {
            const successRate = getSuccessRate(skill.id);
            const skillStats = stats[skill.id];
            const isSelected = selectedSkill?.id === skill.id;
            const isDisabled = skill.enabled === false;
            return (
              <div
                key={skill.id}
                onClick={() => setSelectedSkill(isSelected ? null : skill)}
                className={`group cursor-pointer rounded-lg border p-3 transition-colors ${
                  isSelected
                    ? 'border-border-strong bg-text-primary/[0.08]'
                    : 'border-transparent hover:border-border-subtle/60 hover:bg-text-primary/[0.04]'
                } ${isDisabled ? 'opacity-50' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-xs font-semibold text-text-primary truncate">{skill.name}</span>
                      {skill.dangerous && <AlertTriangle size={10} className="text-orange-500 flex-shrink-0" />}
                      {skill.version && <span className="text-[10px] text-text-faint">v{skill.version}</span>}
                      {isDisabled && <span className="text-[9px] text-text-faint px-1 rounded bg-text-primary/5">禁用</span>}
                    </div>
                    <p className="text-[11px] text-text-muted line-clamp-2 leading-relaxed">{skill.description}</p>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 flex-shrink-0">
                    <button onClick={e => { e.stopPropagation(); toggleEnabled(skill); }} className="text-text-faint hover:text-violet-500 transition-colors" title={isDisabled ? '启用' : '禁用'}>
                      {isDisabled ? <ToggleLeft size={13} /> : <ToggleRight size={13} />}
                    </button>
                    <button onClick={e => { e.stopPropagation(); openSkillFolder(skill); }} className="text-text-faint hover:text-violet-500 transition-colors" title="打开目录">
                      <FolderOpen size={12} />
                    </button>
                    <button onClick={e => { e.stopPropagation(); deleteSkill(skill.id); }} className="text-text-faint hover:text-rose-500 transition-colors" title="删除">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex items-center text-[10px] text-text-faint">
                  {skillStats && skillStats.activations > 0 && (
                    <span>
                      {skillStats.activations}次 {successRate !== null ? `· ${successRate}%` : ''}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 右侧详情 */}
      <div className="flex-1 overflow-y-auto scroll-container">
        {selectedSkill ? (
          <SkillDetail
            skill={selectedSkill}
            stats={stats[selectedSkill.id]}
            onClose={() => setSelectedSkill(null)}
            onDelete={deleteSkill}
            onOpen={openSkillFolder}
            onToggleEnabled={toggleEnabled}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-text-faint/40">
            <Zap size={40} className="mb-3" />
            <p className="text-sm">选择技能查看详情</p>
          </div>
        )}
      </div>

      {/* 创建技能弹窗 */}
      {creating && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-6" onClick={() => setCreating(false)}>
          <div className="bg-inset border border-border-subtle rounded-lg p-6 w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm flex items-center gap-2 text-text-primary">
                <Sparkles size={15} className="text-violet-500" />
                AI 创建技能
              </h3>
              <button onClick={() => setCreating(false)} className="text-text-faint hover:text-text-secondary transition-colors"><X size={16} /></button>
            </div>
            <p className="text-xs text-text-muted mb-3">描述你想要的技能，AI 会自动生成标准的 SKILL.md 文件</p>
            <textarea
              value={createDesc}
              onChange={e => setCreateDesc(e.target.value)}
              placeholder="例如：帮我创建一个部署前端项目到 daily/pre/prod 环境的技能…"
              rows={4}
              className="w-full px-3 py-2.5 bg-inset border border-border-subtle rounded-xl text-xs text-text-primary placeholder-text-faint focus:outline-none focus:border-violet-500/50 resize-none"
              onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleCreate(); }}
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setCreating(false)} className="px-4 py-1.5 text-xs text-text-muted hover:text-text-primary transition-colors">取消</button>
              <button
                onClick={handleCreate}
                disabled={createLoading || !createDesc.trim()}
                className="px-4 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs rounded-lg font-medium transition-all flex items-center gap-1.5"
              >
                {createLoading ? <><Loader2 size={12} className="animate-spin" /> 生成中…</> : <><Sparkles size={12} /> 生成技能</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast.show && (
        <div className={`fixed bottom-6 right-6 px-4 py-2 rounded-xl shadow-xl text-xs font-medium z-[300] ${
          toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
    </PageShell>
  );
};

/** 技能详情面板 */
function SkillDetail({ skill, stats, onClose, onDelete, onOpen, onToggleEnabled }: {
  skill: Skill;
  stats?: SkillStats;
  onClose: () => void;
  onDelete: (id: string) => void;
  onOpen: (skill: Skill) => void;
  onToggleEnabled: (skill: Skill) => void;
}) {
  const successRate = stats && stats.activations > 0
    ? Math.round((stats.successes / stats.activations) * 100)
    : null;
  const isDisabled = skill.enabled === false;

  return (
    <div className="p-6 max-w-3xl">
      {/* 标题区 */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-base font-bold text-text-primary">{skill.name}</h3>
            {skill.dangerous && (
              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-orange-500/10 text-orange-600 border border-orange-500/20 rounded-full">
                <AlertTriangle size={9} /> 危险
              </span>
            )}
            {skill.version && <span className="text-xs text-text-faint">v{skill.version}</span>}
            {isDisabled && <span className="text-[10px] px-1.5 py-0.5 bg-text-primary/5 text-text-faint rounded">禁用</span>}
          </div>
          <p className="text-sm text-text-muted leading-relaxed">{skill.description}</p>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button
            onClick={() => onToggleEnabled(skill)}
            className={`p-1.5 transition-colors ${isDisabled ? 'text-text-faint hover:text-emerald-500' : 'text-emerald-500 hover:text-emerald-600'}`}
            title={isDisabled ? '启用' : '禁用'}
          >
            {isDisabled ? <ToggleLeft size={16} /> : <ToggleRight size={16} />}
          </button>
          <button onClick={() => onOpen(skill)} className="p-1.5 text-text-faint hover:text-violet-500 transition-colors" title="打开目录编辑">
            <FolderOpen size={15} />
          </button>
          <button onClick={() => onDelete(skill.id)} className="p-1.5 text-text-faint hover:text-rose-500 transition-colors" title="删除">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* 统计卡片 */}
      {stats && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: '激活次数', value: stats.activations, icon: <BarChart2 size={13} /> },
            { label: '成功率', value: successRate !== null ? `${successRate}%` : '-', icon: <Sparkles size={13} /> },
            { label: '最近使用', value: stats.lastUsed ? new Date(stats.lastUsed).toLocaleDateString('zh-CN') : '-', icon: <Settings size={13} /> }
          ].map(item => (
            <div key={item.label} className="bg-surface/50 border border-border-subtle/40 rounded-xl p-3 text-center">
              <div className="flex items-center justify-center gap-1 text-text-muted mb-1">{item.icon}<span className="text-[10px]">{item.label}</span></div>
              <div className="text-sm font-bold text-text-primary">{item.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* 触发词 */}
      {skill.triggers && skill.triggers.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-2">
            <Zap size={12} className="text-cyan-500" /> 触发词
          </div>
          <div className="flex flex-wrap gap-1.5">
            {skill.triggers.map(t => (
              <span key={t} className="text-xs px-2.5 py-1 bg-cyan-500/10 text-cyan-600 border border-cyan-500/20 rounded-lg">{t}</span>
            ))}
          </div>
        </div>
      )}

      {/* 输入参数 */}
      {skill.inputs && Object.keys(skill.inputs).length > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-2">
            <Settings size={12} className="text-blue-500" /> 输入参数
          </div>
          <div className="space-y-2">
            {Object.entries(skill.inputs).map(([name, def]: [string, any]) => (
              <div key={name} className="bg-surface/50 border border-border-subtle/40 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <code className="text-xs font-mono text-violet-600">{name}</code>
                  <span className="text-[10px] text-text-muted bg-elevated px-1.5 rounded">{def.type}</span>
                  {def.required === false && <span className="text-[10px] text-text-faint">可选</span>}
                  {def.default !== undefined && <span className="text-[10px] text-text-faint">默认: {String(def.default)}</span>}
                </div>
                {def.description && <p className="text-[11px] text-text-muted">{def.description}</p>}
                {def.values && <p className="text-[11px] text-emerald-600 mt-0.5">可选值: {def.values.join(' / ')}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 副作用 */}
      {skill.sideEffects && skill.sideEffects.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-2">
            <GitBranch size={12} className="text-orange-500" /> 副作用
          </div>
          <div className="flex flex-wrap gap-1.5">
            {skill.sideEffects.map(effect => (
              <span key={effect} className="text-[11px] px-2 py-0.5 bg-orange-500/10 text-orange-600 border border-orange-500/20 rounded">{effect}</span>
            ))}
          </div>
        </div>
      )}

      {/* 依赖技能 */}
      {skill.depends && skill.depends.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-2">
            <GitBranch size={12} className="text-amber-500" /> 依赖技能
          </div>
          <div className="flex flex-wrap gap-1.5">
            {skill.depends.map(dep => (
              <span key={dep} className="text-[11px] px-2 py-0.5 bg-amber-500/10 text-amber-600 border border-amber-500/20 rounded">{dep}</span>
            ))}
          </div>
        </div>
      )}

      {/* 技能内容 */}
      {skill.content && (
        <div className="mb-5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-2">
            <FileText size={12} className="text-violet-500" /> 技能内容
          </div>
          <div className="bg-inset border border-border-subtle/40 rounded-xl overflow-hidden">
            <pre className="p-4 text-[12px] leading-relaxed text-text-secondary whitespace-pre-wrap font-mono max-h-96 overflow-y-auto scroll-container">
              {skill.content}
            </pre>
          </div>
        </div>
      )}

      {/* 脚本文件 */}
      {skill.scriptFile && (
        <div className="mb-5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-2">
            <FileText size={12} className="text-violet-500" /> 脚本文件
          </div>
          <div className="bg-surface/50 border border-border-subtle/40 rounded-lg px-3 py-2">
            <code className="text-xs text-text-muted">{skill.scriptFile}</code>
          </div>
        </div>
      )}

      {/* 错误策略 */}
      {skill.onError && (
        <div className="text-xs text-text-faint">错误策略：<span className="text-text-muted">{skill.onError}</span></div>
      )}
    </div>
  );
}

export default SkillsPage;
