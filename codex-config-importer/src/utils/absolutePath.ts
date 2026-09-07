// Port of openai/codex utils/absolute-path (Apache-2.0, rust-v0.153.4):
// paths guaranteed absolute, with resolve/join/canonicalize/parent faces.
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { isAbsolute, join, resolve, dirname } from 'node:path'

export class AbsolutePathBuf {
  readonly path: string

  constructor(path: string) {
    if (!isAbsolute(path)) throw new Error(`not an absolute path: ${path}`)
    this.path = resolve(path)
  }

  static fromAbsolute(path: string): AbsolutePathBuf {
    return new AbsolutePathBuf(path)
  }

  static fromAbsoluteChecked(path: string): AbsolutePathBuf | null {
    return existsSync(path) ? new AbsolutePathBuf(path) : null
  }

  static currentDir(): AbsolutePathBuf {
    return new AbsolutePathBuf(process.cwd())
  }

  static resolvePathAgainstBase(path: string, base: string): AbsolutePathBuf {
    return new AbsolutePathBuf(isAbsolute(path) ? path : join(base, path))
  }

  relativeToCurrentDir(path: string): AbsolutePathBuf {
    return new AbsolutePathBuf(resolve(process.cwd(), path))
  }

  join(path: string): AbsolutePathBuf {
    return new AbsolutePathBuf(join(this.path, path))
  }

  canonicalize(): AbsolutePathBuf {
    return new AbsolutePathBuf(realpathSync(this.path))
  }

  /** Create the directory if missing, then canonicalize. */
  mkdirCanonical(): AbsolutePathBuf {
    mkdirSync(this.path, { recursive: true })
    return this.canonicalize()
  }

  parent(): AbsolutePathBuf | null {
    const parent = dirname(this.path)
    return parent === this.path ? null : new AbsolutePathBuf(parent)
  }

  toString(): string { return this.path }
}
