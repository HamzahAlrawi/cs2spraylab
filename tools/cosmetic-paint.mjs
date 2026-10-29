export function nativePaintInputs(material) {
  const variables = [];
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (value.m_strName) variables.push(value);
    for (const child of Object.values(value)) walk(child);
  };
  walk(material);
  const named = name => variables.find(v => v.m_strName === name);
  const colors = material.m_vectorParams?.filter(v => /^g_vColor\d$/.test(v.m_name)).map(v => v.m_value.slice(0, 3)) ??
    variables.filter(v => /^g_vColor\d$/.test(v.m_strName)).sort((a, b) => a.m_strName.localeCompare(b.m_strName)).map(v =>
      Array.isArray(v.m_cValueColor4) ? v.m_cValueColor4.slice(0, 3).map(c => Number.isFinite(c) ? c / 255 : NaN) : [v.m_flValueFloatX, v.m_flValueFloatY, v.m_flValueFloatZ]);
  if (colors.some(c => c.length !== 3 || !c.every(Number.isFinite))) throw Error('Invalid native paint palette');
  const paintByNumber = named('g_bUsePaintByNumberMasks')?.m_bValueBoolean === true && named('g_bOverrideDefaultMasks')?.m_bValueBoolean === true;
  const paintByNumberTexture = paintByNumber ? named('g_tPaintByNumberMasks')?.m_strTextureRuntimeResourcePath : undefined;
  if (paintByNumber && (!paintByNumberTexture || colors.length !== 4)) throw Error('Incomplete native paint-by-number inputs');
  return {colors, paintByNumberTexture,
    texture: named('g_tPattern')?.m_strTextureRuntimeResourcePath ?? material.m_textureParams?.find(v => v.m_name === 'g_tPattern')?.m_pValue,
    scale: named('g_flPatternTexCoordScale')?.m_flValueFloatX ?? 1};
}

export function isMissingTexturePixels(pixels) {
  const channels = 4;
  if (!pixels.length || pixels.length % channels) throw Error('Expected RGBA pixels');
  let pink = 0;
  for (let i = 0; i < pixels.length; i += channels) if (pixels[i] > 245 && pixels[i + 1] < 12 && pixels[i + 2] > 245) pink++;
  return pink / (pixels.length / channels) > .99;
}
