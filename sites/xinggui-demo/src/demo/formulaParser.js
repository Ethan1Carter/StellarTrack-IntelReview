/**
 * 安全的数学表达式解析器
 *
 * 使用 Shunting-Yard 算法将中缀表达式转换为 RPN（逆波兰式），
 * 然后基于 RPN 进行计算，全程不使用 eval / new Function，避免代码注入。
 *
 * 支持的运算符： + - * / % ( )
 * 支持的函数：   min,max,abs,round,floor,ceil,sqrt,pow,log,exp,sin,cos
 * 支持的常量：   PI, E
 * 支持的变量：   由调用方传入的任意标识符（如 F1_BASE, F1_BONUS）
 *
 * 用法：
 *   const { evalFormula } = require('./formulaParser');
 *   const result = evalFormula('F1_BASE + F1_BONUS - F1_DEDUCT', {
 *     F1_BASE: 9, F1_BONUS: 5, F1_DEDUCT: 1
 *   }); // => 13
 */

// 允许的函数白名单
const ALLOWED_FUNCS = {
  min:   Math.min,
  max:   Math.max,
  abs:   Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil:  Math.ceil,
  sqrt:  Math.sqrt,
  pow:   Math.pow,
  log:   Math.log,
  exp:   Math.exp,
  sin:   Math.sin,
  cos:   Math.cos,
  // 额外的便捷函数
  clamp: (v, lo, hi) => Math.min(Math.max(v, lo), hi),
  if:    (cond, a, b) => (cond ? a : b)
};

// 允许的常量白名单
const ALLOWED_CONSTS = {
  PI: Math.PI,
  E:  Math.E
};

// Token 类型
const TOK = {
  NUMBER:   'NUMBER',
  IDENT:    'IDENT',   // 变量或函数名
  FUNC:     'FUNC',
  OP:       'OP',
  LPAREN:   'LPAREN',
  RPAREN:   'RPAREN',
  COMMA:    'COMMA'
};

// 运算符优先级（值越大优先级越高）
const PRECEDENCE = {
  '+': 1, '-': 1,
  '*': 2, '/': 2, '%': 2,
  unary: 3 // 一元负号
};

/**
 * 词法分析：将表达式字符串切分为 token 列表
 */
function tokenize(expr) {
  if (typeof expr !== 'string') throw new Error('表达式必须是字符串');
  const tokens = [];
  let i = 0;
  const len = expr.length;

  while (i < len) {
    const ch = expr[i];

    // 跳过空白
    if (/\s/.test(ch)) { i++; continue; }

    // 数字（含小数）
    if (/[0-9.]/.test(ch)) {
      let num = '';
      while (i < len && /[0-9.]/.test(expr[i])) { num += expr[i]; i++; }
      if ((num.match(/\./g) || []).length > 1) {
        throw new Error(`非法数字: ${num}`);
      }
      tokens.push({ type: TOK.NUMBER, value: parseFloat(num) });
      continue;
    }

    // 标识符（变量/函数名/常量）——支持字母数字下划线，必须以字母或下划线开头
    if (/[A-Za-z_]/.test(ch)) {
      let ident = '';
      while (i < len && /[A-Za-z0-9_]/.test(expr[i])) { ident += expr[i]; i++; }
      // 判断是函数名还是变量名：函数名后面紧跟 "("
      let j = i;
      while (j < len && /\s/.test(expr[j])) j++;
      if (expr[j] === '(') {
        tokens.push({ type: TOK.FUNC, value: ident.toLowerCase() });
      } else {
        tokens.push({ type: TOK.IDENT, value: ident });
      }
      continue;
    }

    // 运算符
    if ('+-*/%'.includes(ch)) {
      tokens.push({ type: TOK.OP, value: ch });
      i++;
      continue;
    }

    // 括号
    if (ch === '(') { tokens.push({ type: TOK.LPAREN, value: ch }); i++; continue; }
    if (ch === ')') { tokens.push({ type: TOK.RPAREN, value: ch }); i++; continue; }
    if (ch === ',') { tokens.push({ type: TOK.COMMA, value: ch }); i++; continue; }

    throw new Error(`非法字符: "${ch}" (位置 ${i})`);
  }

  return tokens;
}

/**
 * Shunting-Yard 算法：将中缀 token 序列转换为 RPN
 * 同时处理一元负号（将 "NEG" 作为伪运算符）
 */
function toRPN(tokens) {
  const output = [];
  const stack = []; // 运算符/函数栈
  let prevType = null; // 用于识别一元负号

  for (const token of tokens) {
    switch (token.type) {
      case TOK.NUMBER:
      case TOK.IDENT:
        output.push(token);
        break;

      case TOK.FUNC:
        stack.push(token);
        break;

      case TOK.COMMA:
        while (stack.length && stack[stack.length - 1].type !== TOK.LPAREN) {
          output.push(stack.pop());
        }
        if (!stack.length) throw new Error('逗号不匹配括号');
        break;

      case TOK.OP: {
        // 判断是否为一元负号：当前是 "-" 且（前面没有token / 前面是 OP / LPAREN / COMMA）
        const isUnary = token.value === '-' && (
          prevType === null ||
          prevType === TOK.OP ||
          prevType === TOK.LPAREN ||
          prevType === TOK.COMMA
        );
        if (isUnary) {
          stack.push({ type: TOK.OP, value: 'NEG', unary: true });
        } else {
          while (
            stack.length &&
            stack[stack.length - 1].type === TOK.OP &&
            (PRECEDENCE[stack[stack.length - 1].value] || 0) >= PRECEDENCE[token.value]
          ) {
            output.push(stack.pop());
          }
          stack.push(token);
        }
        break;
      }

      case TOK.LPAREN:
        stack.push(token);
        break;

      case TOK.RPAREN: {
        while (stack.length && stack[stack.length - 1].type !== TOK.LPAREN) {
          output.push(stack.pop());
        }
        if (!stack.length) throw new Error('括号不匹配');
        stack.pop(); // 弹出 LPAREN
        // 若栈顶是函数，则一并弹出
        if (stack.length && stack[stack.length - 1].type === TOK.FUNC) {
          output.push(stack.pop());
        }
        break;
      }
    }
    prevType = token.type;
  }

  while (stack.length) {
    const top = stack[stack.length - 1];
    if (top.type === TOK.LPAREN) throw new Error('括号不匹配');
    output.push(stack.pop());
  }

  return output;
}

/**
 * 基于 RPN 计算结果
 * @param {Array} rpn
 * @param {Object} vars 变量值映射
 */
function evalRPN(rpn, vars = {}) {
  const stack = [];

  for (const token of rpn) {
    switch (token.type) {
      case TOK.NUMBER:
        stack.push(token.value);
        break;

      case TOK.IDENT: {
        // 先查常量，再查变量
        if (Object.prototype.hasOwnProperty.call(ALLOWED_CONSTS, token.value)) {
          stack.push(ALLOWED_CONSTS[token.value]);
        } else if (Object.prototype.hasOwnProperty.call(vars, token.value)) {
          const v = vars[token.value];
          if (typeof v !== 'number' || Number.isNaN(v)) {
            // 允许字符串数字
            const n = Number(v);
            if (Number.isNaN(n)) throw new Error(`变量 ${token.value} 不是数字`);
            stack.push(n);
          } else {
            stack.push(v);
          }
        } else {
          throw new Error(`未知变量: ${token.value}`);
        }
        break;
      }

      case TOK.OP: {
        if (token.unary) {
          // 一元运算符
          const a = stack.pop();
          if (a === undefined) throw new Error('表达式不完整');
          if (token.value === 'NEG') stack.push(-a);
          else throw new Error(`未知一元运算符: ${token.value}`);
        } else {
          const b = stack.pop();
          const a = stack.pop();
          if (a === undefined || b === undefined) throw new Error('表达式不完整');
          switch (token.value) {
            case '+': stack.push(a + b); break;
            case '-': stack.push(a - b); break;
            case '*': stack.push(a * b); break;
            case '/':
              if (b === 0) throw new Error('除以零');
              stack.push(a / b); break;
            case '%':
              if (b === 0) throw new Error('模零');
              stack.push(a % b); break;
            default: throw new Error(`未知运算符: ${token.value}`);
          }
        }
        break;
      }

      case TOK.FUNC: {
        const fn = ALLOWED_FUNCS[token.value];
        if (!fn) throw new Error(`未知函数: ${token.value}`);
        // 函数参数从栈顶取，但 min/max/if 可变参：约定栈顶是参数个数 N，下面依次是 args
        // 为简化实现，约定：所有函数都以"参数个数N + N个参数"形式压栈
        const argCount = stack.pop();
        if (typeof argCount !== 'number') throw new Error(`函数 ${token.value} 缺少参数计数`);
        const args = [];
        for (let i = 0; i < argCount; i++) {
          const v = stack.pop();
          if (v === undefined) throw new Error(`函数 ${token.value} 参数不足`);
          args.unshift(v);
        }
        stack.push(fn(...args));
        break;
      }

      default:
        throw new Error(`未知 token 类型: ${token.type}`);
    }
  }

  if (stack.length !== 1) throw new Error(`表达式无效，剩余 ${stack.length} 个值`);
  const result = stack[0];
  if (typeof result !== 'number' || Number.isNaN(result)) throw new Error('计算结果无效');
  return result;
}

/**
 * 标记函数调用，在 RPN 中嵌入参数个数
 * 改进的解析：在 toRPN 后对函数 token 进行参数计数处理
 */
function toRPNWithArgCount(tokens) {
  // 先得到普通 RPN（函数 token 仍在）
  const rpn = toRPN(tokens);
  // 我们需要在函数调用处压入参数个数
  // 简化方案：在后处理阶段，将 FUNC token 前的 COMMA 数量 +1 作为参数个数
  // 但 RPN 中 COMMA 已被移除，因此改用另一种策略：
  // 直接在 evalRPN 时通过跟踪 COMMA 压入特殊标记 —— 这里改为函数调用前先压入参数计数
  // 为了避免改动太多，重写 evalRPN 中 FUNC 的处理：通过查找原始括号匹配计算参数个数

  // 由于标准 Shunting-Yard 在弹出函数时不带参数个数信息，
  // 这里采用一个简化方案：要求函数调用必须以 "func(arg1, arg2, ...)" 形式出现，
  // 在 evalRPN 中我们使用「栈顶依次取值直到遇到特殊哨兵」的方式。
  // 因此我们改用哨兵法：在 LPAREN 入栈时压入哨兵标记。

  // 重新实现：返回一个新的 RPN 数组，函数调用通过哨兵识别
  return rpn;
}

// 由于标准实现需要哨兵，这里改用另一种方案：函数参数由调用方在表达式中使用方括号包裹
// 简化方案：约定所有函数使用固定参数个数
const FUNC_ARG_COUNT = {
  min: null, max: null, // 可变参数，需特殊处理
  abs: 1, round: 1, floor: 1, ceil: 1, sqrt: 1,
  pow: 2, log: 1, exp: 1, sin: 1, cos: 1,
  clamp: 3, if: 3
};

/**
 * 重写：使用哨兵法的 Shunting-Yard，支持可变参数函数
 */
function toRPNV2(tokens) {
  const output = [];
  const stack = [];
  let prevType = null;

  for (const token of tokens) {
    switch (token.type) {
      case TOK.NUMBER:
      case TOK.IDENT:
        output.push(token);
        break;

      case TOK.FUNC:
        stack.push(token);
        break;

      case TOK.COMMA:
        while (stack.length && stack[stack.length - 1].type !== TOK.LPAREN) {
          output.push(stack.pop());
        }
        if (!stack.length) throw new Error('逗号不匹配括号');
        // 计数：每个逗号意味着一个参数（用于可变参数函数）
        {
          const lp = stack[stack.length - 1];
          if (lp && lp.type === TOK.LPAREN) {
            lp.argCount = (lp.argCount || 0) + 1;
          }
        }
        break;

      case TOK.OP: {
        const isUnary = token.value === '-' && (
          prevType === null ||
          prevType === TOK.OP ||
          prevType === TOK.LPAREN ||
          prevType === TOK.COMMA
        );
        if (isUnary) {
          stack.push({ type: TOK.OP, value: 'NEG', unary: true });
        } else {
          const tokenPrec = PRECEDENCE[token.value] || 0;
          while (
            stack.length &&
            stack[stack.length - 1].type === TOK.OP
          ) {
            const top = stack[stack.length - 1];
            // 一元运算符使用 PRECEDENCE.unary，二元运算符使用 PRECEDENCE[value]
            const topPrec = top.unary ? PRECEDENCE.unary : (PRECEDENCE[top.value] || 0);
            if (topPrec >= tokenPrec) {
              output.push(stack.pop());
            } else {
              break;
            }
          }
          stack.push(token);
        }
        break;
      }

      case TOK.LPAREN:
        stack.push({ ...token, argCount: 0, outputLen: output.length });
        break;

      case TOK.RPAREN: {
        while (stack.length && stack[stack.length - 1].type !== TOK.LPAREN) {
          output.push(stack.pop());
        }
        if (!stack.length) throw new Error('括号不匹配');
        const lparen = stack.pop(); // 弹出 LPAREN
        // 修正 argCount：逗号数 + (括号内是否有内容)
        const hasContent = output.length > lparen.outputLen;
        const realArgCount = (lparen.argCount || 0) + (hasContent ? 1 : 0);
        // 若栈顶是函数，则弹出并附加参数个数
        if (stack.length && stack[stack.length - 1].type === TOK.FUNC) {
          const func = stack.pop();
          output.push({ ...func, argCount: realArgCount });
        }
        break;
      }
    }
    prevType = token.type;
  }

  while (stack.length) {
    const top = stack[stack.length - 1];
    if (top.type === TOK.LPAREN) throw new Error('括号不匹配');
    output.push(stack.pop());
  }

  return output;
}

/**
 * 基于 RPN (V2) 计算结果，使用 argCount 支持可变参数
 */
function evalRPNV2(rpn, vars = {}) {
  const stack = [];

  for (const token of rpn) {
    switch (token.type) {
      case TOK.NUMBER:
        stack.push(token.value);
        break;

      case TOK.IDENT: {
        if (Object.prototype.hasOwnProperty.call(ALLOWED_CONSTS, token.value)) {
          stack.push(ALLOWED_CONSTS[token.value]);
        } else if (Object.prototype.hasOwnProperty.call(vars, token.value)) {
          const v = vars[token.value];
          const n = typeof v === 'number' ? v : Number(v);
          if (Number.isNaN(n)) throw new Error(`变量 ${token.value} 不是数字`);
          stack.push(n);
        } else {
          throw new Error(`未知变量: ${token.value}`);
        }
        break;
      }

      case TOK.OP: {
        if (token.unary) {
          const a = stack.pop();
          if (a === undefined) throw new Error('表达式不完整');
          if (token.value === 'NEG') stack.push(-a);
          else throw new Error(`未知一元运算符: ${token.value}`);
        } else {
          const b = stack.pop();
          const a = stack.pop();
          if (a === undefined || b === undefined) throw new Error('表达式不完整');
          switch (token.value) {
            case '+': stack.push(a + b); break;
            case '-': stack.push(a - b); break;
            case '*': stack.push(a * b); break;
            case '/':
              if (b === 0) throw new Error('除以零');
              stack.push(a / b); break;
            case '%':
              if (b === 0) throw new Error('模零');
              stack.push(a % b); break;
            default: throw new Error(`未知运算符: ${token.value}`);
          }
        }
        break;
      }

      case TOK.FUNC: {
        const fn = ALLOWED_FUNCS[token.value];
        if (!fn) throw new Error(`未知函数: ${token.value}`);
        const argCount = token.argCount;
        // 对于固定参数的函数，校验参数个数
        const expected = FUNC_ARG_COUNT[token.value];
        if (expected !== null && argCount !== expected) {
          throw new Error(`函数 ${token.value} 需要 ${expected} 个参数，实际 ${argCount} 个`);
        }
        const args = [];
        for (let i = 0; i < argCount; i++) {
          const v = stack.pop();
          if (v === undefined) throw new Error(`函数 ${token.value} 参数不足`);
          args.unshift(v);
        }
        stack.push(fn(...args));
        break;
      }

      default:
        throw new Error(`未知 token 类型: ${token.type}`);
    }
  }

  if (stack.length !== 1) throw new Error(`表达式无效，剩余 ${stack.length} 个值`);
  const result = stack[0];
  if (typeof result !== 'number' || Number.isNaN(result)) throw new Error('计算结果无效');
  return result;
}

/**
 * 计算表达式
 * @param {string} expr 数学表达式
 * @param {Object} vars 变量值映射，如 { F1_BASE: 9, F1_BONUS: 5 }
 * @returns {number}
 */
function evalFormula(expr, vars = {}) {
  if (!expr || typeof expr !== 'string' || !expr.trim()) {
    throw new Error('表达式为空');
  }
  const tokens = tokenize(expr);
  const rpn = toRPNV2(tokens);
  return evalRPNV2(rpn, vars);
}

/**
 * 校验表达式是否合法（不实际计算，仅做语法检查）
 * @param {string} expr
 * @param {Array<string>} allowedVars 允许的变量名列表
 * @returns {{ valid: boolean, error?: string }}
 */
function validateFormula(expr, allowedVars = []) {
  try {
    if (!expr || typeof expr !== 'string' || !expr.trim()) {
      return { valid: false, error: '表达式为空' };
    }
    const tokens = tokenize(expr);
    const rpn = toRPNV2(tokens);
    // 用占位值（1）测试所有变量，确认无未知变量
    const fakeVars = {};
    const allowedSet = new Set(allowedVars);
    for (const t of rpn) {
      if (t.type === TOK.IDENT && !ALLOWED_CONSTS[t.value]) {
        if (allowedSet.size > 0 && !allowedSet.has(t.value)) {
          return { valid: false, error: `不允许的变量: ${t.value}` };
        }
        fakeVars[t.value] = 1;
      }
    }
    evalRPNV2(rpn, fakeVars);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

export { evalFormula, validateFormula };