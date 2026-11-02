// Avaliador seguro de expressões paramétricas (sem eval).
// Suporta: números, unidades (mm, cm, m, in, ft, deg, rad), + - * / ^ %, parênteses,
// funções matemáticas e referências a parâmetros do usuário.

const UNITS = {
  mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8, um: 0.001,
  deg: 1, rad: 180 / Math.PI, '°': 1,
};

const FUNCS = {
  sin: (d) => Math.sin((d * Math.PI) / 180),
  cos: (d) => Math.cos((d * Math.PI) / 180),
  tan: (d) => Math.tan((d * Math.PI) / 180),
  asin: (x) => (Math.asin(x) * 180) / Math.PI,
  acos: (x) => (Math.acos(x) * 180) / Math.PI,
  atan: (x) => (Math.atan(x) * 180) / Math.PI,
  atan2: (y, x) => (Math.atan2(y, x) * 180) / Math.PI,
  sqrt: Math.sqrt, abs: Math.abs, min: Math.min, max: Math.max,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, pow: Math.pow,
  log: Math.log, exp: Math.exp, hypot: Math.hypot,
  clamp: (x, a, b) => Math.min(Math.max(x, a), b),
  if: (c, a, b) => (c ? a : b),
};

const CONSTS = { pi: Math.PI, PI: Math.PI, e: Math.E, tau: Math.PI * 2 };

function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.eE]/.test(src[j])) {
        if ((src[j] === 'e' || src[j] === 'E') && /[+-]/.test(src[j + 1])) j++;
        j++;
      }
      toks.push({ t: 'num', v: parseFloat(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_°]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_°]/.test(src[j])) j++;
      toks.push({ t: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['>=', '<=', '==', '!='].includes(two)) { toks.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/^%(),<>'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    throw new Error(`Caractere inesperado '${c}' na expressão "${src}"`);
  }
  return toks;
}

export function evaluate(src, resolve = () => undefined) {
  if (typeof src === 'number') return src;
  if (typeof src === 'boolean') return src ? 1 : 0;
  if (src == null || src === '') throw new Error('Expressão vazia');
  const toks = tokenize(String(src));
  let p = 0;
  const peek = () => toks[p];
  const eat = (v) => {
    const t = toks[p];
    if (!t || (v && t.v !== v)) throw new Error(`Esperado '${v}' em "${src}"`);
    p++;
    return t;
  };

  const cmp = () => {
    let l = add();
    while (peek() && ['<', '>', '<=', '>=', '==', '!='].includes(peek().v)) {
      const op = eat().v, r = add();
      l = { '<': l < r, '>': l > r, '<=': l <= r, '>=': l >= r, '==': l === r, '!=': l !== r }[op] ? 1 : 0;
    }
    return l;
  };
  const add = () => {
    let l = mul();
    while (peek() && (peek().v === '+' || peek().v === '-')) {
      const op = eat().v, r = mul();
      l = op === '+' ? l + r : l - r;
    }
    return l;
  };
  const mul = () => {
    let l = unary();
    while (peek() && ['*', '/', '%'].includes(peek().v)) {
      const op = eat().v, r = unary();
      l = op === '*' ? l * r : op === '/' ? l / r : l % r;
    }
    return l;
  };
  const unary = () => {
    if (peek() && peek().v === '-') { eat(); return -unary(); }
    if (peek() && peek().v === '+') { eat(); return unary(); }
    return pow();
  };
  const pow = () => {
    const b = postfix();
    if (peek() && peek().v === '^') { eat(); return Math.pow(b, unary()); }
    return b;
  };
  const postfix = () => {
    let v = primary();
    // sufixo de unidade: "10 mm", "2in", "45deg"
    const t = peek();
    if (t && t.t === 'id' && UNITS[t.v] !== undefined) { eat(); v *= UNITS[t.v]; }
    return v;
  };
  const primary = () => {
    const t = eat();
    if (t.t === 'num') return t.v;
    if (t.v === '(') { const v = cmp(); eat(')'); return v; }
    if (t.t === 'id') {
      if (peek() && peek().v === '(') {
        const f = FUNCS[t.v];
        if (!f) throw new Error(`Função desconhecida: ${t.v}`);
        eat('(');
        const args = [];
        if (peek() && peek().v !== ')') {
          args.push(cmp());
          while (peek() && peek().v === ',') { eat(); args.push(cmp()); }
        }
        eat(')');
        return f(...args);
      }
      if (CONSTS[t.v] !== undefined) return CONSTS[t.v];
      const r = resolve(t.v);
      if (r === undefined) throw new Error(`Parâmetro desconhecido: ${t.v}`);
      return r;
    }
    throw new Error(`Token inesperado '${t.v}' em "${src}"`);
  };

  const v = cmp();
  if (p < toks.length) throw new Error(`Sobrou '${toks[p].v}' em "${src}"`);
  if (!Number.isFinite(v)) throw new Error(`Resultado não finito para "${src}"`);
  return v;
}

/** Retorna os identificadores (possíveis parâmetros) usados numa expressão. */
export function references(src) {
  if (typeof src !== 'string') return [];
  try {
    return tokenize(src)
      .filter((t, i, a) => t.t === 'id' && !FUNCS[t.v] && CONSTS[t.v] === undefined && UNITS[t.v] === undefined && a[i + 1]?.v !== '(')
      .map((t) => t.v);
  } catch {
    return [];
  }
}

/** Tabela de parâmetros com resolução preguiçosa e detecção de ciclos. */
export class ParameterTable {
  constructor(defs = {}) {
    this.defs = defs; // name -> { expr, unit?, comment? }
  }
  resolver() {
    const cache = new Map();
    const visiting = new Set();
    const get = (name) => {
      if (cache.has(name)) return cache.get(name);
      const d = this.defs[name];
      if (!d) return undefined;
      if (visiting.has(name)) throw new Error(`Dependência circular no parâmetro '${name}'`);
      visiting.add(name);
      const v = evaluate(d.expr, get);
      visiting.delete(name);
      cache.set(name, v);
      return v;
    };
    return get;
  }
  values() {
    const get = this.resolver();
    const out = {};
    for (const k of Object.keys(this.defs)) {
      try { out[k] = get(k); } catch (e) { out[k] = { error: e.message }; }
    }
    return out;
  }
}
