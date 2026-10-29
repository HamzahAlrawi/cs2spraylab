const linear = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const gamma = v => v <= .0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - .055;

// Default RGBA / MULTIPLY lookup layer. VRF's spritecard interpretation uses
// gamma-space BT.709 luminance, not the red channel, to address the gradient.
export function tintInfernoPixels(pixels, gradient, blend) {
  for (let at = 0; at < pixels.length; at += 4) {
    const heat = (pixels[at] * .2125 + pixels[at + 1] * .7154 + pixels[at + 2] * .0721) / 255;
    const next = gradient.findIndex(stop => stop.m_flPosition >= heat);
    const b = gradient[next < 0 ? gradient.length - 1 : next], a = gradient[Math.max(0, next < 0 ? gradient.length - 2 : next - 1)];
    const t = Math.max(0, Math.min(1, (heat - a.m_flPosition) / Math.max(.000001, b.m_flPosition - a.m_flPosition)));
    for (let c = 0; c < 3; c++) {
      const ramp = linear((a.m_Color[c] + (b.m_Color[c] - a.m_Color[c]) * t) / 255);
      pixels[at + c] = Math.round(gamma(linear(pixels[at + c] / 255) * (1 - blend + ramp * blend)) * 255);
    }
    const alpha = pixels[at + 3] / 255;
    pixels[at + 3] = Math.round(alpha * (1 - blend + alpha * blend) * 255);
  }
  return pixels;
}
