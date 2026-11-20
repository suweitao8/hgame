/**
 * Zero-eval recursive-descent arithmetic expression parser and parameter resolver.
 * Supports: numbers, $paramName references, unary +/-, binary + - * /, parentheses ( ).
 * 100% CSP-compliant and mini-game safe.
 */

export type ParamValue = number | boolean | string;
export type ParamMap = Record<string, ParamValue>;

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'var'; name: string }
  | { kind: 'op'; op: '+' | '-' | '*' | '/' }
  | { kind: 'lparen' }
  | { kind: 'rparen' };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ kind: 'op', op: ch });
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen' });
      i++;
      continue;
    }
    if (ch === '$') {
      i++;
      const start = i;
      while (i < n && /[A-Za-z0-9_]/.test(input[i]!)) i++;
      if (i === start) {
        throw new Error(`Invalid parameter reference '$' at position ${start - 1} in "${input}"`);
      }
      tokens.push({ kind: 'var', name: input.slice(start, i) });
      continue;
    }
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      const start = i;
      let dotCount = ch === '.' ? 1 : 0;
      i++;
      while (i < n) {
        const c = input[i]!;
        if (c >= '0' && c <= '9') {
          i++;
        } else if (c === '.' && dotCount === 0) {
          dotCount = 1;
          i++;
        } else {
          break;
        }
      }
      const numStr = input.slice(start, i);
      const val = Number(numStr);
      if (!Number.isFinite(val)) {
        throw new Error(`Invalid number literal "${numStr}" in "${input}"`);
      }
      tokens.push({ kind: 'num', value: val });
      continue;
    }
    throw new Error(`Unexpected character "${ch}" at position ${i} in "${input}"`);
  }
  return tokens;
}

export function extractExprParamRefs(exprText: string): string[] {
  const body = exprText.startsWith('expr:') ? exprText.slice(5) : exprText;
  const tokens = tokenize(body);
  const refs = new Set<string>();
  for (const t of tokens) {
    if (t.kind === 'var') refs.add(t.name);
  }
  return [...refs];
}

export function evaluateSafeExpr(exprText: string, params: ParamMap = {}): number {
  const body = exprText.startsWith('expr:') ? exprText.slice(5) : exprText;
  const tokens = tokenize(body);
  if (tokens.length === 0) {
    throw new Error(`Empty expression "${exprText}"`);
  }
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const consume = (): Token | undefined => tokens[pos++];

  function parseExpression(): number {
    let left = parseTerm();
    while (true) {
      const t = peek();
      if (t && t.kind === 'op' && (t.op === '+' || t.op === '-')) {
        consume();
        const right = parseTerm();
        left = t.op === '+' ? left + right : left - right;
      } else {
        break;
      }
    }
    return left;
  }

  function parseTerm(): number {
    let left = parseUnary();
    while (true) {
      const t = peek();
      if (t && t.kind === 'op' && (t.op === '*' || t.op === '/')) {
        consume();
        const right = parseUnary();
        if (t.op === '/') {
          if (right === 0) throw new Error(`Division by zero in expression "${exprText}"`);
          left = left / right;
        } else {
          left = left * right;
        }
      } else {
        break;
      }
    }
    return left;
  }

  function parseUnary(): number {
    const t = peek();
    if (t && t.kind === 'op' && (t.op === '+' || t.op === '-')) {
      consume();
      const val = parseUnary();
      return t.op === '-' ? -val : val;
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    const t = consume();
    if (!t) {
      throw new Error(`Unexpected end of expression "${exprText}"`);
    }
    if (t.kind === 'num') return t.value;
    if (t.kind === 'var') {
      if (!(t.name in params)) {
        throw new Error(`Missing parameter "$${t.name}" in expression "${exprText}"`);
      }
      const v = params[t.name];
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new Error(`Parameter "$${t.name}" must be a finite number (got ${typeof v})`);
      }
      return v;
    }
    if (t.kind === 'lparen') {
      const val = parseExpression();
      const close = consume();
      if (!close || close.kind !== 'rparen') {
        throw new Error(`Missing closing parenthesis in expression "${exprText}"`);
      }
      return val;
    }
    throw new Error(`Unexpected token in expression "${exprText}"`);
  }

  const result = parseExpression();
  if (pos < tokens.length) {
    throw new Error(`Trailing tokens in expression "${exprText}"`);
  }
  if (!Number.isFinite(result)) {
    throw new Error(`Non-finite expression result in "${exprText}"`);
  }
  return result;
}

export function resolveParamValue<T extends ParamValue = ParamValue>(
  raw: unknown,
  params: ParamMap = {}
): T {
  if (typeof raw === 'string') {
    if (raw.startsWith('expr:')) {
      return evaluateSafeExpr(raw, params) as T;
    }
    if (raw.startsWith('$')) {
      const key = raw.slice(1);
      if (!(key in params)) {
        throw new Error(`Missing parameter "${raw}"`);
      }
      return params[key] as T;
    }
  }
  return raw as T;
}

export function resolveNumber(raw: unknown, params: ParamMap = {}, fallback?: number): number {
  if (raw === undefined && fallback !== undefined) return fallback;
  const v = resolveParamValue(raw, params);
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`Expected finite numeric value, got ${JSON.stringify(raw)} -> ${String(v)}`);
  }
  return v;
}

export function resolveBoolean(raw: unknown, params: ParamMap = {}, fallback = false): boolean {
  if (raw === undefined) return fallback;
  if (typeof raw === 'string' && raw.startsWith('!')) {
    return !resolveBoolean(raw.slice(1).trim(), params, !fallback);
  }
  const v = resolveParamValue(raw, params);
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  throw new Error(`Expected boolean value, got ${JSON.stringify(raw)}`);
}

export function resolveVec3(
  raw: unknown,
  params: ParamMap = {},
  fallback: [number, number, number] = [0, 0, 0]
): [number, number, number] {
  if (raw === undefined) return fallback;
  if (!Array.isArray(raw) || raw.length !== 3) {
    throw new Error(`Expected 3-element vector, got ${JSON.stringify(raw)}`);
  }
  return [
    resolveNumber(raw[0], params),
    resolveNumber(raw[1], params),
    resolveNumber(raw[2], params),
  ];
}
