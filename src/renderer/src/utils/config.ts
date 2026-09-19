// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

// 配置常量和辅助函数

export const ONEDAY_CONFIG = (window as any).ONEDAY_CONFIG || (window.parent as any)?.window?.ONEDAY_CONFIG;

export const baseUrl = (ONEDAY_CONFIG?.fc?.baseUrl || '').replace(/\/$/, '');

export const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;

export const safeEncodeHeader = (obj: any): string => {
  try {
    const jsonStr = JSON.stringify(obj);
    return btoa(encodeURIComponent(jsonStr).replace(/%([0-9A-F]{2})/g, (match, p1) => String.fromCharCode(parseInt(p1, 16))));
  } catch (e) {
    return "";
  }
};

export const getAuthHeaders = (): Record<string, string> => {
  const token = ONEDAY_CONFIG?.jwtToken?.access_token;
  const headers: Record<string, string> = {};
  const minimalConfig = {
    jwtToken: { access_token: token },
    database_config: ONEDAY_CONFIG?.database_config,
    user: { workid: ONEDAY_CONFIG?.user?.workid, name: ONEDAY_CONFIG?.user?.name }
  };
  headers['oneday-config'] = safeEncodeHeader(minimalConfig);
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};
