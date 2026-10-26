// `@padcom/vite-config-lib` ships JavaScript without type declarations.
declare module '@padcom/vite-config-lib' {
  import type { UserConfig } from 'vite'

  /**
   * Package metadata used to name the library and compute its externals.
   */
  interface PackageJSON {
    /** package name */
    name: string
    /** runtime dependencies (externals) */
    dependencies?: Record<string, string>
    /** peer dependencies (externals) */
    peerDependencies?: Record<string, string>
    /** optional dependencies (externals) */
    optionalDependencies?: Record<string, string>
  }

  /**
   * Vite config plus options for `vite-plugin-dts`.
   */
  interface LibConfig extends UserConfig {
    /** overrides for `vite-plugin-dts` */
    dts?: Record<string, unknown>
  }

  export function defineLibConfig(pkg: PackageJSON, overrides?: LibConfig): UserConfig
}
