// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import { useState, useMemo, useCallback } from 'react';

export interface SlashCommand {
  command: string;
  description: string;
  icon: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { command: '/self-check', description: '运行系统自检（全部场景）', icon: 'Shield' },
  { command: '/self-check 任务编排执行', description: '自检：任务编排执行分组', icon: 'Shield' },
  { command: '/self-check 记忆与系统集成', description: '自检：记忆与系统集成分组', icon: 'Shield' },
  { command: '/clear', description: '清空当前对话', icon: 'Trash2' },
  { command: '/reset', description: '重置会话（新 sessionId）', icon: 'RefreshCw' },
];

export function useSlashCommands() {
  const [isSlashMenuOpen, setIsSlashMenuOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // 根据 filter 过滤匹配的命令（模糊匹配 command 和 description）
  const filteredCommands = useMemo(() => {
    if (!filter) return SLASH_COMMANDS;
    const lowerFilter = filter.toLowerCase();
    return SLASH_COMMANDS.filter(cmd => 
      cmd.command.toLowerCase().includes(lowerFilter) ||
      cmd.description.toLowerCase().includes(lowerFilter)
    );
  }, [filter]);

  // 打开面板并设置过滤条件
  const openMenu = useCallback((filterStr: string) => {
    setFilter(filterStr);
    setIsSlashMenuOpen(true);
    setSelectedIndex(0);
  }, []);

  // 关闭面板
  const closeMenu = useCallback(() => {
    setIsSlashMenuOpen(false);
    setFilter('');
    setSelectedIndex(0);
  }, []);

  // 选中命令，返回完整命令文本
  const selectCommand = useCallback((cmd: SlashCommand): string => {
    closeMenu();
    return cmd.command;
  }, [closeMenu]);

  // 处理键盘事件，返回是否消费了事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent): boolean => {
    if (!isSlashMenuOpen || filteredCommands.length === 0) return false;

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev <= 0 ? filteredCommands.length - 1 : prev - 1
        );
        return true;

      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev >= filteredCommands.length - 1 ? 0 : prev + 1
        );
        return true;

      case 'Enter':
        e.preventDefault();
        return true; // 返回 true 表示需要选中当前项，具体处理由调用方完成

      case 'Escape':
        e.preventDefault();
        closeMenu();
        return true;

      default:
        return false;
    }
  }, [isSlashMenuOpen, filteredCommands.length, closeMenu]);

  return {
    filteredCommands,
    isSlashMenuOpen,
    selectedIndex,
    setSelectedIndex,
    openMenu,
    closeMenu,
    selectCommand,
    handleKeyDown,
  };
}
