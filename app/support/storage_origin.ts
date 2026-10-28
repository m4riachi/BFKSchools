/**
 * S3 storage settings shared by config/drive.ts (the S3 client) and
 * config/shield.ts (the CSP `img-src`). MediaController redirects
 * `<img src="/media/meal-photos/:id/thumb">` to a signed bucket URL, and
 * browsers check `img-src` again on the redirect target: the CSP must list
 * exactly the origin the signed URLs use. Both are derived here, from the
 * same values, so they cannot drift (tests/unit/storage_origin.spec.ts
 * compares the helper with URLs signed by the real Drive S3 driver).
 */

export type StorageEnv = {
  DRIVE_DISK: string
  S3_REGION?: string
  S3_BUCKET?: string
  S3_ENDPOINT?: string
  S3_FORCE_PATH_STYLE?: boolean
  /** Optional override of the derived origin (https origin, no path). */
  S3_PUBLIC_ORIGIN?: string
}

/** Reads the storage settings from the env service (start/env.ts). */
export function readStorageEnv(env: { get(key: string): unknown }): StorageEnv {
  const text = (key: string) => {
    const value = env.get(key)
    return typeof value === 'string' && value !== '' ? value : undefined
  }
  return {
    DRIVE_DISK: String(env.get('DRIVE_DISK')),
    S3_REGION: text('S3_REGION'),
    S3_BUCKET: text('S3_BUCKET'),
    S3_ENDPOINT: text('S3_ENDPOINT'),
    S3_FORCE_PATH_STYLE: env.get('S3_FORCE_PATH_STYLE') === true,
    S3_PUBLIC_ORIGIN: text('S3_PUBLIC_ORIGIN'),
  }
}

/**
 * Region, bucket and endpoint options of the S3 driver (config/drive.ts).
 * Credentials and visibility are added by the config.
 */
export function s3DriverSettings(values: StorageEnv) {
  return {
    region: values.S3_REGION ?? 'auto',
    bucket: values.S3_BUCKET ?? '',
    ...s3EndpointOptions(values),
  }
}

/** Endpoint-related options passed to the S3 client (and so to presigning). */
export function s3EndpointOptions(values: StorageEnv) {
  if (!values.S3_ENDPOINT) return {}
  return {
    endpoint: values.S3_ENDPOINT,
    forcePathStyle: values.S3_FORCE_PATH_STYLE ?? false,
    // Cloudflare R2 (and most non-AWS providers) have no object ACLs.
    supportsACL: false,
  }
}

/**
 * Mirrors the AWS SDK rule (`isVirtualHostableS3Bucket`, without
 * sub-domains): 3–63 chars of lowercase letters, digits and hyphens, not
 * starting or ending with a hyphen. Other names (e.g. with dots) are
 * addressed path-style by the SDK even when forcePathStyle is off.
 */
export function isVirtualHostableBucket(bucket: string): boolean {
  return /^(?!-)(?!.*-$)[a-z0-9-]{3,63}$/.test(bucket)
}

/**
 * `https://host[:port]` with nothing else: the only accepted form for
 * S3_PUBLIC_ORIGIN. Returns the normalized origin or null.
 */
export function parseHttpsOrigin(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  const bare =
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    (url.pathname === '/' || url.pathname === '') &&
    !url.search &&
    !url.hash &&
    !value.includes('*') &&
    // no trailing path, query or fragment in the raw value either
    /^https:\/\/[^/?#]+\/?$/i.test(value.trim())
  return bare ? url.origin : null
}

/**
 * Origin of the signed URLs of the `s3` disk, or null when DRIVE_DISK is
 * not s3. Throws when the settings don't allow a reliable answer.
 *
 * - S3_PUBLIC_ORIGIN set → that origin (override for providers whose signed
 *   URL host can't be derived from the settings below);
 * - S3_ENDPOINT + path-style (forced, or bucket not DNS-safe) → endpoint origin;
 * - S3_ENDPOINT, virtual-hosted → `<scheme>://<bucket>.<endpoint host[:port]>`;
 * - no endpoint (AWS): virtual-hosted `https://<bucket>.s3.<region>.amazonaws.com`,
 *   path-style `https://s3.<region>.amazonaws.com`.
 */
export function s3PublicOrigin(values: StorageEnv): string | null {
  if (values.DRIVE_DISK !== 's3') return null

  if (values.S3_PUBLIC_ORIGIN) {
    const origin = parseHttpsOrigin(values.S3_PUBLIC_ORIGIN)
    if (!origin) {
      throw new Error(
        'S3_PUBLIC_ORIGIN must be an https origin without path, e.g. https://cdn.example.com'
      )
    }
    return origin
  }

  const bucket = values.S3_BUCKET ?? ''
  if (!bucket) throw new Error('S3_BUCKET is required to compute the storage origin')
  const pathStyle = !isVirtualHostableBucket(bucket) || (values.S3_FORCE_PATH_STYLE ?? false)

  if (values.S3_ENDPOINT) {
    const endpoint = new URL(values.S3_ENDPOINT)
    if (!['https:', 'http:'].includes(endpoint.protocol)) {
      throw new Error('S3_ENDPOINT must be an http(s) URL')
    }
    return pathStyle ? endpoint.origin : `${endpoint.protocol}//${bucket}.${endpoint.host}`
  }

  const region = values.S3_REGION ?? ''
  if (!/^[a-z0-9-]+$/.test(region) || region === 'auto') {
    throw new Error('S3_REGION must be an AWS region when S3_ENDPOINT is not set')
  }
  return pathStyle
    ? `https://s3.${region}.amazonaws.com`
    : `https://${bucket}.s3.${region}.amazonaws.com`
}

/** CSP `img-src`: our origin, inline data/blob previews, and the bucket origin when used. */
export function imgSrcDirective(values: StorageEnv): string[] {
  const origin = s3PublicOrigin(values)
  return [`'self'`, 'data:', 'blob:', ...(origin ? [origin] : [])]
}
