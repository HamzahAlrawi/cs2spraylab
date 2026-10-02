// Items_game repeats whole sections; merge those sections rather than losing kits.
export function parseKeyValues(text) {
  const tokens = text.replace(/^\uFEFF/, '').match(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|[{}]|[^\s{}"]+/g) ?? [];
  let index = 0;
  const decode = token => token.startsWith('"')
    ? token.slice(1, -1).replace(/\\(["\\nt])/g, (_, c) => ({n: '\n', t: '\t'}[c] ?? c)) : token;
  const merge = (a, b) => {
    for (const [key, value] of Object.entries(b)) {
      if (value && typeof value === 'object' && a[key] && typeof a[key] === 'object') merge(a[key], value);
      else a[key] = value;
    }
    return a;
  };
  const next = () => {
    while (tokens[index]?.startsWith('//') || tokens[index]?.startsWith('/*')) index++;
    return tokens[index++];
  };
  function object(nested = false) {
    const output = Object.create(null);
    while (index < tokens.length) {
      const key = next();
      if (key === undefined) break;
      if (key === '}') {
        if (!nested) throw new Error('Unexpected KeyValues closing brace');
        return output;
      }
      if (key === '{') throw new Error('Missing KeyValues key');
      const token = next();
      if (!token || token === '}') throw new Error(`Missing KeyValues value: ${key}`);
      const value = token === '{' ? object(true) : decode(token);
      merge(output, {[decode(key)]: value});
    }
    if (nested) throw new Error('Unclosed KeyValues object');
    return output;
  }
  return object();
}
