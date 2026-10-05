/**
 * dsh-ko-locale — host half.
 *
 * The Korean copy itself lives entirely in the browser half (`./client`), which
 * `@deepseek-ai/dsh-client-modules` discovers from this package's `dsh.client`
 * declaration and serves at `/plugins/dsh-ko-locale/client.js`.
 *
 * This module exists because the module registry only composes the boot graph
 * from *enabled loader entries*: a package with no loadable host row is never
 * scanned, so its browser half would never reach the page. The row is therefore
 * an intentionally inert mount point, not a placeholder for missing work.
 *
 * It imports nothing, so the plugin needs no peer dependency on the DSH
 * packages it cooperates with and cannot fail a profile's version check.
 */

/** Cordis plugin name, reported by the loader tree. */
export const name = 'dsh-ko-locale'

/**
 * Mount the plugin. Deliberately no-op: the host owns no Korean state, and the
 * browser half activates on its own once the bundle is served. Kept as an
 * exported function so the loader accepts this module as a plugin entry.
 */
export function apply() {}
