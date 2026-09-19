/**
 * 任务执行器工具函数
 * 通用的条件评估和对象查询逻辑
 */

/**
 * 获取嵌套对象的值
 * @param {object} obj - 要查询的对象
 * @param {string} path - 点号分隔的路径，如 "data.installed"
 * @returns {*} 路径对应的值，不存在时返回 undefined
 */
function getNestedValue(obj, path) {
  if (!path || typeof path !== 'string') return obj;
  return path.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : undefined;
  }, obj);
}

/**
 * 评估条件是否满足
 * @param {object} condition - 条件配置 { step, field, operator, value }
 * @param {object} context - 任务上下文，包含各步骤的执行结果
 * @returns {{ satisfied: boolean, reason: string }} 条件是否满足及原因
 */
function evaluateCondition(condition, context) {
  // 兼容 condition.step 和 condition.stepId 两种写法
  const stepKey = condition.step || condition.stepId;
  const stepResult = context[stepKey];
  if (stepResult === undefined) {
    return { satisfied: false, reason: `依赖的步骤 ${stepKey} 尚未执行` };
  }

  // 步骤状态条件：{ type: 'failed'|'success'|'skipped', stepId: '...' }
  // 当 condition.type 是步骤状态语义且没有 field/operator 时，走状态判断逻辑
  const condType = condition.type;
  const isStatusCondition = ['failed', 'success', 'skipped'].includes(condType) && !condition.field && !condition.operator;

  if (isStatusCondition) {
    const stepFailed = stepResult._error || stepResult._depFailed || (stepResult.success === false);
    const stepSkipped = !!stepResult.skipped;
    const stepSucceeded = !stepFailed && !stepSkipped;

    let satisfied = false;
    switch (condType) {
      case 'failed':
        satisfied = stepFailed;
        break;
      case 'success':
        satisfied = stepSucceeded;
        break;
      case 'skipped':
        satisfied = stepSkipped;
        break;
    }

    const statusDesc = stepFailed ? 'failed' : stepSkipped ? 'skipped' : 'success';
    const reason = satisfied
      ? `条件满足: 步骤 ${stepKey} 状态为 ${statusDesc}，期望 ${condType}`
      : `条件不满足: 步骤 ${stepKey} 状态为 ${statusDesc}，期望 ${condType}`;
    return { satisfied, reason };
  }

  // 字段值比较条件：{ field: '...', operator: '...', value: '...' }
  const actualValue = getNestedValue(stepResult, condition.field);
  let satisfied = false;
  
  // 兼容语义化操作符（equals/notEquals）和符号操作符（===/!==）
  const operator = condition.operator || condition.type;
  switch (operator) {
    case 'equals':
    case '===':
      satisfied = actualValue === condition.value;
      break;
    case 'notEquals':
    case '!==':
      satisfied = actualValue !== condition.value;
      break;
    case '==':
      satisfied = actualValue == condition.value;
      break;
    case '!=':
      satisfied = actualValue != condition.value;
      break;
    case 'exists':
      satisfied = actualValue !== undefined && actualValue !== null;
      break;
    case 'notExists':
      satisfied = actualValue === undefined || actualValue === null;
      break;
    case 'truthy':
      satisfied = !!actualValue;
      break;
    case 'falsy':
      satisfied = !actualValue;
      break;
    default:
      return { satisfied: false, reason: `不支持的操作符: ${operator}` };
  }
  
  const reason = satisfied 
    ? `条件满足: ${condition.field} ${operator} ${JSON.stringify(condition.value)} (实际值: ${JSON.stringify(actualValue)})`
    : `条件不满足: ${condition.field} ${operator} ${JSON.stringify(condition.value)} (实际值: ${JSON.stringify(actualValue)})`;
  
  return { satisfied, reason };
}

module.exports = { getNestedValue, evaluateCondition };
