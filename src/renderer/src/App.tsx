import React, { useState, useEffect } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import ChatPageComponent from './components/ChatPage';
import MuseSpace from './components/MuseSpace';
import AICopilot from './components/AICopilot';
import FloatingNav from './components/FloatingNav';
import GlobalAmbient from './components/GlobalAmbient';
import HistoryPage from './pages/HistoryPage';
import LearningMapPage from './pages/LearningMapPage';
// 功能减法：技能/变更分析/信箱/作品/爬虫/伴侣演示入口已隐藏，页面文件保留待后续恢复
import { ErrorBoundary } from './components/ErrorBoundary';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { baseUrl, getAuthHeaders, isElectron } from './utils/config';

const ChatPage = ChatPageComponent;

/** Ant Design 全局配置 — 暗色算法跟随应用主题，主色对齐品牌青色 */
function AntdProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: { colorPrimary: '#06b6d4', borderRadius: 8 },
      }}
    >
      {children}
    </ConfigProvider>
  );
}

const AppContent = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === '/';
  const noPaddingRoutes = ['/history', '/learning'];
  const mainPadding = noPaddingRoutes.includes(location.pathname) ? 'p-0' : 'p-4 pt-8';

  // ESC 键一键回到首页
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 已在首页，不处理
      if (location.pathname === '/') return;
      // 有模态框打开时，让模态框优先处理
      if (document.querySelector('[role="dialog"], [data-modal], .modal')) return;
      // 焦点在输入框 / 可编辑区域时，不拦截（避免误触）
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName)) return;
      if (activeEl?.getAttribute('contenteditable') === 'true') return;

      e.preventDefault();
      navigate('/');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [location.pathname, navigate]);

  return (
    <>
      {/* MuseSpace — 默认活体空间（logo 点击回到这里） */}
      {isHome && (
        <main className="flex-1 overflow-hidden">
          <MuseSpace onSummonChat={() => navigate('/chat')} />
        </main>
      )}
      {/* 其他路由（含对话） */}
      {!isHome && (
        <main className={`flex-1 overflow-hidden ${mainPadding}`}>
          <ErrorBoundary level="section" regionName="页面">
            <Routes>
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/learning" element={<LearningMapPage />} />
            </Routes>
          </ErrorBoundary>
        </main>
      )}
    </>
  );
};

const App = () => {
  const [query, setQuery] = useState<string | undefined>();
  const [status, setStatus] = useState<'pending' | 'ok' | 'error'>('pending');

  useEffect(() => {
    if (!baseUrl || isElectron) {
      setStatus(isElectron ? 'ok' : 'error');
      return;
    }
    axios.get(`${baseUrl}/api/ping`, { headers: getAuthHeaders() }).then(() => setStatus('ok')).catch(() => setStatus('error'));
  }, []);

  return (
    <ThemeProvider>
    <AntdProvider>
    <div className="h-screen bg-base font-sans flex overflow-hidden relative">
      {/* 意识体氛围背景 */}
      <GlobalAmbient />

      {/* macOS 内容区拖拽区域 */}
      {isElectron && <div className="drag-region fixed top-0 left-0 right-0 h-7 z-40" />}

      {/* 左侧导航（文档流，展开时占用空间） */}
      <FloatingNav />

      {/* 状态指示器 - Electron 环境不显示 */}
      {!isElectron && (
        <div className="fixed top-4 right-20 z-50 flex items-center gap-2 px-4 py-2 bg-text-primary/[0.06] backdrop-blur-md border border-border-subtle/60 rounded-full shadow-lg text-[11px] font-bold">
          <div className={`w-2.5 h-2.5 rounded-full ${status === 'ok' ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : status === 'error' ? 'bg-rose-500' : 'bg-amber-500 animate-pulse'}`} />
          <span className={status === 'error' ? 'text-rose-400' : 'text-text-muted'}>{status === 'ok' ? '矩阵已同步' : status === 'error' ? '链路中断' : '同步中'}</span>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <AppContent />

        {/* AICopilot - Electron 环境不显示 */}
        {!isElectron && <AICopilot onSelectQuestion={setQuery} />}
      </div>
    </div>
    </AntdProvider>
    </ThemeProvider>
  );
};

export default App;
