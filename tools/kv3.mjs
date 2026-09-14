export function parseKv3(raw) {
  const tokens = raw.replace(/<!--[^]*?-->/g, '').match(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?|[\w.]+|[{}\[\]=,:]/gi).filter(t => !t.startsWith('//'));
  let cursor = 0;
  function value() {
    const token = tokens[cursor++];
    if (token === '{') {
      const object = {};
      while (tokens[cursor] !== '}') {
        if (cursor >= tokens.length) throw new Error('Unclosed KV3 object');
        const key = tokens[cursor++].replace(/^"|"$/g, '');
        if (tokens[cursor++] !== '=') throw new Error(`Missing = at ${key}`);
        object[key] = value();
        if (tokens[cursor] === ',') cursor++;
      }
      cursor++; return object;
    }
    if (token === '[') {
      const array = [];
      while (tokens[cursor] !== ']') {
        if (cursor >= tokens.length) throw new Error('Unclosed KV3 array');
        array.push(value());
        if (tokens[cursor] === ',') cursor++;
      }
      cursor++; return array;
    }
    if (tokens[cursor] === ':') { cursor++; return value(); }
    if (token.startsWith('"')) return JSON.parse(token);
    if (token === 'true' || token === 'false') return token === 'true';
    if (token === 'null') return null;
    return Number.isFinite(Number(token)) ? Number(token) : token;
  }
  return value();
}
