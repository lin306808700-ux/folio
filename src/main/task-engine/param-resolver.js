/**
 * 参数解析器
 * 解析步骤参数中的变量引用（$stepId、属性访问、.map() 语法等）
 */

/**
 * 解析参数中的变量引用
 * @param {*} params - 待解析的参数（支持 string / array / object）
 * @param {object} context - 任务上下文，包含各步骤的执行结果
 * @returns {*} 解析后的参数值
 */
function resolveParams(params, context) {
  if (!params) return params;
  
  if (typeof params === 'string') {
    // 处理 $stepId 引用
    if (params.startsWith('$')) {
      const varPath = params.slice(1);
      
      // 处理函数调用语法，如 $1.map(item => item.path)
      const funcMatch = varPath.match(/^(\d+)\.map\(([^)]+)\)$/);
      if (funcMatch) {
        const stepId = funcMatch[1];
        const data = context[stepId];
        if (Array.isArray(data)) {
          const arrowMatch = funcMatch[2].match(/=>\s*(.+)$/);
          if (arrowMatch) {
            const propPath = arrowMatch[1].trim().replace(/item\./g, '');
            return data.map(item => {
              const parts = propPath.split('.');
              let value = item;
              for (const part of parts) {
                value = value?.[part];
              }
              return value;
            });
          }
        }
        return data;
      }
      
      // 简单属性访问
      const parts = varPath.split('.');
      let value = context;
      for (const part of parts) {
        value = value?.[part];
      }
      return value;
    }
    return params;
  }

  if (Array.isArray(params)) {
    return params.map(p => resolveParams(p, context));
  }

  if (typeof params === 'object') {
    const resolved = {};
    for (const [key, value] of Object.entries(params)) {
      resolved[key] = resolveParams(value, context);
    }
    return resolved;
  }

  return params;
}

module.exports = { resolveParams };
