import { ref } from 'vue'

/**
 * D51: the receipt printer plugged into the board (USB, ESC/POS), driven
 * from the page with WebUSB (Chrome, Android included). The device is
 * paired once with a tap on the board's 🖨 button (`requestDevice` needs a
 * user gesture); Chrome remembers the permission, so later visits reconnect
 * silently with `getDevices()`. Every printer-class or vendor-class USB
 * printer with a bulk OUT endpoint works.
 */
type UsbEndpoint = { direction: 'in' | 'out'; type: string; endpointNumber: number }
type UsbAlternate = { endpoints: UsbEndpoint[] }
type UsbInterface = { interfaceNumber: number; alternates: UsbAlternate[] }
type UsbDevice = {
  productName?: string
  opened: boolean
  configuration: { interfaces: UsbInterface[] } | null
  open: () => Promise<void>
  close: () => Promise<void>
  selectConfiguration: (value: number) => Promise<void>
  claimInterface: (number: number) => Promise<void>
  releaseInterface: (number: number) => Promise<void>
  transferOut: (endpoint: number, data: Uint8Array) => Promise<unknown>
}
type Usb = {
  getDevices: () => Promise<UsbDevice[]>
  requestDevice: (options: { filters: Record<string, number>[] }) => Promise<UsbDevice>
}

const device = ref<UsbDevice | null>(null)

function usb(): Usb | null {
  return typeof navigator === 'undefined' ? null : ((navigator as any).usb ?? null)
}

export function useUsbPrinter() {
  const supported = usb() !== null

  /** A printer paired earlier, without a prompt. */
  async function restore() {
    const api = usb()
    if (!api) return null
    try {
      const devices = await api.getDevices()
      device.value = devices[0] ?? null
    } catch {
      device.value = null
    }
    return device.value
  }

  /** Chrome's chooser (needs a tap): printer-class devices first, any device otherwise. */
  async function pair() {
    const api = usb()
    if (!api) return null
    try {
      device.value = await api.requestDevice({ filters: [{ classCode: 7 }] })
    } catch {
      try {
        device.value = await api.requestDevice({ filters: [] })
      } catch {
        return null
      }
    }
    return device.value
  }

  /** Sends raw ESC/POS bytes to the paired printer's bulk OUT endpoint. */
  async function print(bytes: Uint8Array) {
    const current = device.value ?? (await restore())
    if (!current) throw new Error('no printer')
    if (!current.opened) await current.open()
    if (!current.configuration) await current.selectConfiguration(1)
    const interfaces = current.configuration?.interfaces ?? []
    for (const iface of interfaces) {
      for (const alternate of iface.alternates) {
        const out = alternate.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk')
        if (!out) continue
        await current.claimInterface(iface.interfaceNumber)
        try {
          // Small chunks: some printers choke on one large transfer.
          for (let offset = 0; offset < bytes.length; offset += 4096) {
            await current.transferOut(out.endpointNumber, bytes.subarray(offset, offset + 4096))
          }
        } finally {
          await current.releaseInterface(iface.interfaceNumber).catch(() => {})
        }
        return
      }
    }
    throw new Error('no bulk endpoint')
  }

  return { supported, device, restore, pair, print }
}

/** Base64 → bytes (the server sends ESC/POS as base64). */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Android fallback: the RawBT app prints an ESC/POS payload handed over by URL. */
export function rawbtUrl(base64: string): string {
  return `intent:base64,${base64}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`
}
