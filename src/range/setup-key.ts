// Two independent 64-bit FNV streams keep persisted compatibility keys bounded.
// This is an identity fingerprint, not a security or authenticity primitive.
export function setupKey(value: unknown): string {
  const text = JSON.stringify(value), mask = (1n << 64n) - 1n, prime = 1099511628211n;
  let forward = 14695981039346656037n, reverse = 7809847782465536322n;
  for (let i = 0; i < text.length; i++) {
    forward = ((forward ^ BigInt(text.charCodeAt(i))) * prime) & mask;
    reverse = ((reverse ^ BigInt(text.charCodeAt(text.length - 1 - i))) * prime) & mask;
  }
  return `setup-v2:${forward.toString(16).padStart(16, '0')}${reverse.toString(16).padStart(16, '0')}`;
}
