// Distilled from openai/codex utils/path-uri (Apache-2.0, rust-v0.153.4):
// file:// URI ↔ filesystem path conversion (the ApiPathString face).
export function pathToUri(path: string): string {
  const p = path.replace(/\\/g, '/')
  const withScheme = p.startsWith('/') ? `file://${p}` : `file:///${p}`
  return encodeURI(withScheme).replace(/#/g, '%23').replace(/\?/g, '%3F')
}

export function uriToPath(uri: string): string {
  if (!uri.startsWith('file://')) throw new Error(`not a file URI: ${uri}`)
  let p = decodeURI(uri.slice('file://'.length))
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1) // file:///C:/... → C:/...
  // Only Windows drive-style paths get backslash separators; POSIX paths keep
  // forward slashes regardless of the host OS (a win32 host must still be able
  // to round-trip a /home/u/x.txt file:// URI).
  const isWindowsPath = /^[A-Za-z]:/.test(p) && process.platform === 'win32'
  return p.replace(/\//g, isWindowsPath ? '\\' : '/')
}

/** Round-trip guard used by config import paths. */
export function isFileUri(s: string): boolean {
  return s.startsWith('file://')
}
