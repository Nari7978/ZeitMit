// Minimal OKLCH -> sRGB hex conversion so the prototype's oklch() placeholder
// colours render identically on native, where CSS colour functions aren't supported.

const cache = new Map<string, string>();

export function oklch(l: number, c: number, h: number): string {
  const key = `${l}|${c}|${h}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;

  const lin = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
  const hex = lin
    .map((v) => {
      const x = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
      return Math.round(Math.min(1, Math.max(0, x)) * 255)
        .toString(16)
        .padStart(2, '0');
    })
    .join('');
  const out = `#${hex}`;
  cache.set(key, out);
  return out;
}
