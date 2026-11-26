// Baked textures (Canvas 2D or plain pixel arrays, painted once at load): the silk's pattern, the
// window's light mask, the view outside per palette, the wall, the floor, the sill things and the brass.

import { MASK, WIN, type Palette } from './scene'

export function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

// ---------- the silk ----------

export const CLOTH_W = 1.76
export const CLOTH_H = 2.15
/** eight satin stripes 0.035 m wide, evenly spaced across the panel */
export const STRIPES = Array.from({ length: 8 }, (_, i) => ((i + 0.5) / 8) * CLOTH_W)

/** 512 x 512: RGB colour, A = sheen multiplier / 2.2 (so 1 in the ground reads 0.4545, the stripes 1) */
export function patternPixels(): Uint8Array {
  const N = 512
  const out = new Uint8Array(N * N * 4)
  const r = rng(11)
  // slubs: a few slightly thicker weft threads, the irregularity that says "woven silk", not plastic
  const slub = new Float32Array(N)
  for (let y = 0; y < N; y++) slub[y] = r() < 0.05 ? 0.5 + r() * 0.5 : 0
  const base = [244, 235, 221]
  for (let y = 0; y < N; y++) {
    const vz = (y / (N - 1)) * CLOTH_H // metres down from the top
    for (let x = 0; x < N; x++) {
      const ux = (x / (N - 1)) * CLOTH_W
      let sheen = 1
      let tone = 1
      for (const s of STRIPES) {
        const d = Math.abs(ux - s)
        if (d < 0.0175) {
          const e = Math.min(1, (0.0175 - d) / 0.003) // a soft woven edge
          sheen = 1 + 1.2 * e
          tone = 1 - 0.02 * e
        }
      }
      // slub: a faint warm line, breaking off along its length
      const sl = slub[y] * (0.5 + 0.5 * Math.sin(x * 0.07 + y * 1.3) * Math.sin(x * 0.021 + y))
      tone *= 1 - 0.018 * Math.max(0, sl)
      let rr = base[0] * tone,
        gg = base[1] * tone,
        bb = base[2] * tone * (1 - 0.01 * sl)
      // hems: doubled hem 0.06 m at the bottom, 0.04 m heading at the top, rolled edges at the sides
      const hemB = vz > CLOTH_H - 0.06,
        hemT = vz < 0.04,
        side = ux < 0.01 || ux > CLOTH_W - 0.01
      if (hemB || hemT || side) {
        rr *= 0.95
        gg *= 0.935
        bb *= 0.91
      }
      // stitch lines just inside the hems
      if (Math.abs(vz - (CLOTH_H - 0.052)) < 0.0018 || Math.abs(vz - 0.034) < 0.0018) {
        if ((x >> 2) & 1) {
          rr *= 0.88
          gg *= 0.86
          bb *= 0.83
        }
      }
      const o = (y * N + x) * 4
      out[o] = rr
      out[o + 1] = gg
      out[o + 2] = bb
      out[o + 3] = Math.round((sheen / 2.2) * 255)
    }
  }
  return out
}

// ---------- the sill things (shared shapes for the mask and the sprites) ----------

type Pt = (x: number, z: number) => [number, number]

/** the cat, sitting on the sill with its back to the room, in world metres (x, z) */
export const CAT = { x: -0.3, z: 0.75 }
export function catPath(ctx: CanvasRenderingContext2D, P: Pt, paw = 0, flick = 0) {
  const { x, z } = CAT
  const m = (dx: number, dz: number) => P(x + dx, z + dz)
  ctx.beginPath()
  // body: a pear seen from behind, haunches wide on the sill, a narrow neck under a round head
  ctx.moveTo(...m(-0.12, 0))
  ctx.bezierCurveTo(...m(-0.135, 0.07), ...m(-0.11, 0.15), ...m(-0.05, 0.19))
  ctx.bezierCurveTo(...m(-0.04, 0.2), ...m(-0.045, 0.21), ...m(-0.055, 0.225))
  // head, left side, up to the left ear (tall, pointed, set wide)
  ctx.bezierCurveTo(...m(-0.075, 0.25), ...m(-0.075, 0.29), ...m(-0.062, 0.31))
  ctx.lineTo(...m(-0.07, 0.375))
  ctx.lineTo(...m(-0.028, 0.33))
  // crown between the ears
  ctx.bezierCurveTo(...m(-0.012, 0.336), ...m(0.012, 0.336), ...m(0.028, 0.33))
  // right ear
  ctx.lineTo(...m(0.07, 0.375))
  ctx.lineTo(...m(0.062, 0.31))
  ctx.bezierCurveTo(...m(0.075, 0.29), ...m(0.075, 0.25), ...m(0.055, 0.225))
  ctx.bezierCurveTo(...m(0.045, 0.21), ...m(0.04, 0.2), ...m(0.05, 0.19))
  ctx.bezierCurveTo(...m(0.11, 0.15), ...m(0.135, 0.07), ...m(0.12, 0))
  ctx.closePath()
  // the tail: out to the right along the sill, then up in a hook
  ctx.moveTo(...m(0.1, 0.0))
  if (flick) {
    // the flick: the tip whips up and over toward the back
    ctx.bezierCurveTo(...m(0.18, -0.004), ...m(0.22, 0.02), ...m(0.215, 0.11))
    ctx.bezierCurveTo(...m(0.212, 0.16), ...m(0.18, 0.19), ...m(0.162, 0.178))
    ctx.bezierCurveTo(...m(0.155, 0.17), ...m(0.19, 0.15), ...m(0.19, 0.1))
    ctx.bezierCurveTo(...m(0.19, 0.05), ...m(0.17, 0.028), ...m(0.1, 0.03))
  } else {
    ctx.bezierCurveTo(...m(0.18, -0.004), ...m(0.235, 0.0), ...m(0.25, 0.07))
    ctx.bezierCurveTo(...m(0.258, 0.11), ...m(0.24, 0.135), ...m(0.222, 0.128))
    ctx.bezierCurveTo(...m(0.212, 0.122), ...m(0.228, 0.1), ...m(0.226, 0.075))
    ctx.bezierCurveTo(...m(0.22, 0.035), ...m(0.18, 0.024), ...m(0.1, 0.03))
  }
  ctx.closePath()
  if (paw) {
    // a raised paw (phase 3: the cat bats back)
    ctx.moveTo(...m(0.05, 0.16))
    ctx.bezierCurveTo(...m(0.11, 0.2), ...m(0.13, 0.26), ...m(0.12, 0.29))
    ctx.bezierCurveTo(...m(0.1, 0.3), ...m(0.085, 0.27), ...m(0.085, 0.24))
    ctx.bezierCurveTo(...m(0.08, 0.21), ...m(0.06, 0.2), ...m(0.04, 0.19))
    ctx.closePath()
  }
}

/** pothos in a clay pot at the right of the sill, trailing over the edge */
export const POT = { x: 0.36, z: 0.75 }
function potPath(ctx: CanvasRenderingContext2D, P: Pt) {
  const { x, z } = POT
  const m = (dx: number, dz: number) => P(x + dx, z + dz)
  ctx.beginPath()
  ctx.moveTo(...m(-0.055, 0))
  ctx.lineTo(...m(-0.07, 0.11))
  ctx.lineTo(...m(0.07, 0.11))
  ctx.lineTo(...m(0.055, 0))
  ctx.closePath()
}
const LEAVES: [number, number, number, number][] = [
  // dx, dz, size, angle
  [-0.05, 0.15, 0.038, -0.6],
  [0.0, 0.18, 0.042, 0.1],
  [0.05, 0.16, 0.04, 0.7],
  [-0.085, 0.12, 0.034, -1.2],
  [0.09, 0.12, 0.034, 1.3],
  [0.02, 0.22, 0.034, 0.3],
  [-0.03, 0.21, 0.032, -0.3],
  // the trailing vine over the sill's edge
  [0.1, 0.05, 0.03, 2.0],
  [0.12, -0.02, 0.028, 2.4],
  [0.115, -0.09, 0.026, 2.8],
  [0.13, -0.16, 0.024, 2.6],
]
function leafPath(ctx: CanvasRenderingContext2D, P: Pt, l: [number, number, number, number]) {
  const [dx, dz, s, a] = l
  const cx = POT.x + dx,
    cz = POT.z + dz
  const ca = Math.cos(a),
    sa = Math.sin(a)
  const q = (u: number, v: number) => P(cx + u * s * ca - v * s * sa, cz + u * s * sa + v * s * ca)
  // a heart leaf pointing along +v
  ctx.moveTo(...q(0, -0.55))
  ctx.bezierCurveTo(...q(0.75, -0.75), ...q(0.85, 0.35), ...q(0, 1))
  ctx.bezierCurveTo(...q(-0.85, 0.35), ...q(-0.75, -0.75), ...q(0, -0.55))
}

/** the glass wind chime hanging from the top of the frame at the right */
export const CHIME = { x: 0.4, z: 2.05 }
function chimePath(ctx: CanvasRenderingContext2D, P: Pt, swing = 0) {
  const m = (dx: number, dz: number) => P(CHIME.x + dx + swing * (2.05 - (CHIME.z + dz)), CHIME.z + dz)
  ctx.beginPath()
  // the bell
  ctx.moveTo(...m(-0.035, -0.17))
  ctx.bezierCurveTo(...m(-0.035, -0.115), ...m(-0.02, -0.105), ...m(0, -0.105))
  ctx.bezierCurveTo(...m(0.02, -0.105), ...m(0.035, -0.115), ...m(0.035, -0.17))
  ctx.closePath()
}
function chimeStrip(ctx: CanvasRenderingContext2D, P: Pt, swing = 0) {
  const m = (dx: number, dz: number) => P(CHIME.x + dx + swing * (2.05 - (CHIME.z + dz)), CHIME.z + dz)
  const a = m(-0.013, -0.19),
    b = m(0.013, -0.33)
  ctx.beginPath()
  ctx.rect(a[0], a[1], b[0] - a[0], b[1] - a[1])
}

// ---------- the window's light mask ----------

/** 256 x 256 over MASK: R sharp, G blurred 0.02 m, B blurred 0.07 m. 1 where sunlight passes. */
export function maskPixels(paw = 0, flick = 0, cat = true): Uint8Array {
  const N = 256
  const c = canvas(N, N)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  const P: Pt = (x, z) => [((x - MASK.x0) / (MASK.x1 - MASK.x0)) * N, ((MASK.z1 - z) / (MASK.z1 - MASK.z0)) * N]
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, N, N)
  ctx.fillStyle = '#fff'
  const fr = 0.03 // frame inside the opening
  const [ax, ay] = P(WIN.x0 + fr, WIN.z1 - fr)
  const [bx, by] = P(WIN.x1 - fr, WIN.z0 + 0.005)
  ctx.fillRect(ax, ay, bx - ax, by - ay)
  ctx.fillStyle = '#000'
  for (const [x0, z0, x1, z1] of barRects()) {
    const [px, py] = P(x0, z1)
    const [qx, qy] = P(x1, z0)
    ctx.fillRect(px, py, qx - px, qy - py)
  }
  if (cat) {
    catPath(ctx, P, paw, flick)
    ctx.fill()
  }
  potPath(ctx, P)
  ctx.fill()
  ctx.beginPath()
  for (const l of LEAVES) leafPath(ctx, P, l)
  ctx.fill()
  // chime: the string, the bell, the strip
  ctx.fillRect(P(CHIME.x - 0.002, 0)[0], P(0, WIN.z1)[1], 1, P(0, CHIME.z - 0.105)[1] - P(0, WIN.z1)[1])
  chimePath(ctx, P)
  ctx.fill()
  chimeStrip(ctx, P)
  ctx.fillStyle = 'rgba(0,0,0,0.55)' // paper: lets some light through
  ctx.fill()
  const src = ctx.getImageData(0, 0, N, N).data
  const a = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) a[i] = src[i * 4] / 255
  const px = N / (MASK.x1 - MASK.x0)
  const g = blur(a, N, Math.round(0.02 * px * 0.6))
  const b = blur(a, N, Math.round(0.07 * px * 0.6))
  const out = new Uint8Array(N * N * 4)
  for (let i = 0; i < N * N; i++) {
    out[i * 4] = a[i] * 255
    out[i * 4 + 1] = g[i] * 255
    out[i * 4 + 2] = b[i] * 255
    out[i * 4 + 3] = 255
  }
  return out
}

/** glazing bars: one vertical, two horizontal, 0.04 m wide */
export function barRects(): [number, number, number, number][] {
  const h = WIN.bar / 2
  const z1 = WIN.z0 + (WIN.z1 - WIN.z0) / 3,
    z2 = WIN.z0 + ((WIN.z1 - WIN.z0) * 2) / 3
  return [
    [-h, WIN.z0, h, WIN.z1],
    [WIN.x0, z1 - h, WIN.x1, z1 + h],
    [WIN.x0, z2 - h, WIN.x1, z2 + h],
  ]
}

/** three box passes (close to a gaussian), clamped at the edges */
function blur(src: Float32Array, N: number, r: number): Float32Array {
  if (r < 1) return src.slice()
  let a = src.slice()
  let b = new Float32Array(N * N)
  for (let pass = 0; pass < 3; pass++) {
    for (let dir = 0; dir < 2; dir++) {
      for (let line = 0; line < N; line++) {
        let acc = 0
        const at = (k: number) => {
          const kk = Math.max(0, Math.min(N - 1, k))
          return dir ? a[kk * N + line] : a[line * N + kk]
        }
        for (let k = -r; k <= r; k++) acc += at(k)
        for (let k = 0; k < N; k++) {
          const v = acc / (2 * r + 1)
          if (dir) b[k * N + line] = v
          else b[line * N + k] = v
          acc += at(k + r + 1) - at(k - r)
        }
      }
      const t = a
      a = b
      b = t
    }
  }
  return a
}

// ---------- outside: sky, tree, the building opposite, the washing ----------

/** the outside quad: a plane 2 m behind the wall */
export const OUT = { y: -2.2, x0: -1.4, x1: 1.4, z0: 0.15, z1: 3.0 }

/** extra things in the view: the odd sock on the line (a portal visit from void; drawn by sock.ts) */
export const extras: { sock?: (g: CanvasRenderingContext2D, at: [number, number], u: number, v: number, night: boolean) => void } = {}

export function paintOutside(pal: Palette): HTMLCanvasElement {
  const W = 768,
    H = Math.round((W * (OUT.z1 - OUT.z0)) / (OUT.x1 - OUT.x0))
  const c = canvas(W, H)
  const g = c.getContext('2d')!
  const r = rng(5)
  const P = (x: number, z: number): [number, number] => [((x - OUT.x0) / (OUT.x1 - OUT.x0)) * W, ((OUT.z1 - z) / (OUT.z1 - OUT.z0)) * H]
  const night = pal.night
  const sky = g.createLinearGradient(0, 0, 0, H)
  if (pal.id === 'golden') {
    sky.addColorStop(0, '#F59A58')
    sky.addColorStop(0.55, pal.sky[0])
    sky.addColorStop(1, pal.sky[1])
  } else {
    sky.addColorStop(0, pal.sky[0])
    sky.addColorStop(1, pal.sky[1])
  }
  g.fillStyle = sky
  g.fillRect(0, 0, W, H)
  if (night) {
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(255,255,240,${0.3 + r() * 0.6})`
      const s = r() < 0.15 ? 2.2 : 1.2
      g.fillRect(r() * W, r() * H * 0.6, s, s)
    }
    // the moon, in the upper right pane
    const [mx, my] = P(0.42, 2.45)
    const halo = g.createRadialGradient(mx, my, 4, mx, my, 70)
    halo.addColorStop(0, 'rgba(220,230,255,0.45)')
    halo.addColorStop(1, 'rgba(220,230,255,0)')
    g.fillStyle = halo
    g.fillRect(mx - 80, my - 80, 160, 160)
    g.fillStyle = '#F4F1E4'
    g.beginPath()
    g.arc(mx, my, 17, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = 'rgba(190,190,180,0.35)'
    g.beginPath()
    g.arc(mx - 5, my - 3, 4, 0, Math.PI * 2)
    g.arc(mx + 6, my + 5, 3, 0, Math.PI * 2)
    g.fill()
  } else {
    // two soft clouds (day) or a warm haze band (golden)
    const cloud = (cx: number, cy: number, s: number, a: number) => {
      for (let i = 0; i < 9; i++) {
        const x = cx + (r() - 0.5) * s * 2.4,
          y = cy + (r() - 0.5) * s * 0.5
        const rad = s * (0.35 + r() * 0.4)
        const gr = g.createRadialGradient(x, y, 0, x, y, rad)
        gr.addColorStop(0, `rgba(255,255,255,${a})`)
        gr.addColorStop(1, 'rgba(255,255,255,0)')
        g.fillStyle = gr
        g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
      }
    }
    if (pal.id === 'day') {
      cloud(...P(-0.15, 2.6), 60, 0.75)
      cloud(...P(0.55, 2.2), 45, 0.6)
    } else {
      cloud(...P(0.1, 2.3), 80, 0.25)
    }
  }
  // the building opposite: five storeys, warm render, 14 windows in view
  const bx0 = -0.85,
    bx1 = 1.2,
    btop = 1.82
  const wallCol = night ? '#2A2E45' : pal.id === 'golden' ? '#E8B88A' : '#E9DCC6'
  g.fillStyle = wallCol
  const [b0x, b0y] = P(bx0, btop)
  const [b1x, b1y] = P(bx1, OUT.z0)
  g.fillRect(b0x, b0y, b1x - b0x, b1y - b0y)
  // roof line and a water tank
  g.fillStyle = night ? '#20243A' : pal.id === 'golden' ? '#C98E62' : '#CDBEA6'
  g.fillRect(b0x, b0y, b1x - b0x, 5)
  const [tx, ty] = P(0.75, btop + 0.12)
  g.fillRect(tx, ty, 34, P(0, btop)[1] - ty)
  // the shaded side
  const side = g.createLinearGradient(b0x, 0, b1x, 0)
  side.addColorStop(0, 'rgba(0,0,0,0)')
  side.addColorStop(1, night ? 'rgba(0,0,0,0.25)' : 'rgba(90,60,40,0.12)')
  g.fillStyle = side
  g.fillRect(b0x, b0y, b1x - b0x, b1y - b0y)
  let wi = 0
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 4; col++) {
      if (wi >= 14) break
      if (row === 3 && col > 1) continue
      wi++
      const wx = bx0 + 0.18 + col * 0.5,
        wz = btop - 0.18 - row * 0.36
      const [p0, p1] = P(wx, wz)
      const [q0, q1] = P(wx + 0.22, wz - 0.24)
      const lit = night && r() < 0.45
      g.fillStyle = night ? (lit ? '#F6C977' : '#151829') : pal.id === 'golden' ? '#8E6A5A' : '#7C8C99'
      g.fillRect(p0, p1, q0 - p0, q1 - p1)
      // the neighbour's own curtain in the third window of the second row
      if (row === 1 && col === 2) {
        g.fillStyle = night ? '#C9A97A' : '#E9E2D2'
        g.fillRect(p0, p1, (q0 - p0) * 0.5, q1 - p1)
        g.fillRect(p0 + (q0 - p0) * 0.5, p1, (q0 - p0) * 0.5, q1 - p1)
        g.fillStyle = 'rgba(0,0,0,0.12)'
        g.fillRect(p0 + (q0 - p0) * 0.5 - 0.5, p1, 1, q1 - p1)
      }
      if (!night) {
        g.fillStyle = 'rgba(255,255,255,0.28)'
        g.fillRect(p0, p1, q0 - p0, 2)
      }
      g.fillStyle = night ? '#1C2036' : '#B9AC98'
      g.fillRect(p0 - 2, q1, q0 - p0 + 4, 3)
    }
  // the plane tree's crown at the left: two leaf layers
  const tree = (col: string, n: number, sc: number, seed: number) => {
    const tr = rng(seed)
    g.fillStyle = col
    for (let i = 0; i < n; i++) {
      const x = -1.35 + tr() * 0.75,
        z = 1.2 + tr() * 1.6
      const [px, py] = P(x, z)
      g.beginPath()
      g.ellipse(px, py, (16 + tr() * 22) * sc, (12 + tr() * 16) * sc, tr() * 3, 0, Math.PI * 2)
      g.fill()
    }
  }
  tree(night ? '#18261F' : pal.id === 'golden' ? '#6E7A3A' : '#5E8F4A', 70, 1.2, 3)
  tree(night ? '#22352A' : pal.id === 'golden' ? '#9AA04A' : '#7FAE5C', 55, 0.9, 4)
  if (!night) {
    g.fillStyle = pal.id === 'golden' ? 'rgba(255,210,120,0.35)' : 'rgba(220,255,190,0.3)'
    for (let i = 0; i < 30; i++) {
      const [px, py] = P(-1.3 + r() * 0.6, 1.5 + r() * 1.3)
      g.beginPath()
      g.ellipse(px, py, 7, 5, r() * 3, 0, Math.PI * 2)
      g.fill()
    }
  }
  // the bamboo washing pole at the right with two shirts and a quilt
  const [p0x, p0y] = P(0.05, 1.55)
  const [p1x, p1y] = P(1.4, 1.6)
  g.strokeStyle = night ? '#5B5640' : '#C9B27A'
  g.lineWidth = 4
  g.beginPath()
  g.moveTo(p0x, p0y)
  g.lineTo(p1x, p1y)
  g.stroke()
  const cloth = (x: number, w: number, h: number, col: string, shirt: boolean) => {
    const [a, b] = P(x, 1.555 + (x - 0.05) * 0.037)
    const pw = (w / (OUT.x1 - OUT.x0)) * W,
      ph = (h / (OUT.z1 - OUT.z0)) * H
    g.fillStyle = night ? 'rgba(60,64,90,0.9)' : col
    g.beginPath()
    if (shirt) {
      g.moveTo(a, b)
      g.lineTo(a + pw, b)
      g.lineTo(a + pw * 1.12, b + ph * 0.3)
      g.lineTo(a + pw * 0.88, b + ph * 0.32)
      g.lineTo(a + pw * 0.88, b + ph)
      g.lineTo(a + pw * 0.12, b + ph)
      g.lineTo(a + pw * 0.12, b + ph * 0.32)
      g.lineTo(a - pw * 0.12, b + ph * 0.3)
    } else {
      g.moveTo(a, b)
      g.lineTo(a + pw, b)
      g.lineTo(a + pw * 0.98, b + ph)
      g.lineTo(a + pw * 0.02, b + ph * 0.97)
    }
    g.closePath()
    g.fill()
    g.fillStyle = 'rgba(0,0,0,0.08)'
    g.fillRect(a, b, pw, 3)
  }
  cloth(0.28, 0.2, 0.26, '#F2F2EE', true)
  cloth(0.56, 0.2, 0.25, '#8DB3D9', true)
  cloth(0.86, 0.42, 0.5, '#E59A8C', false)
  // a portal visit from void: one odd sock on the line (sock.ts, loaded with the arrival)
  extras.sock?.(g, P(0.13, 1.555 + 0.08 * 0.037), (0.075 / (OUT.x1 - OUT.x0)) * W, (0.21 / (OUT.z1 - OUT.z0)) * H, night)
  // the quilt's pattern
  if (!night) {
    const [qa, qb] = P(0.86, 1.585)
    g.fillStyle = 'rgba(255,255,255,0.45)'
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) g.fillRect(qa + 8 + i * 28, qb + 10 + j * 30, 10, 10)
  }
  // casements swung open outward: their edges just inside the opening, in the frame's green
  g.fillStyle = night ? '#55654F' : '#9DB894'
  const [l0x, l0y] = P(WIN.x0 - 0.02, WIN.z1 + 0.02)
  const [l1x, l1y] = P(WIN.x0 + 0.04, WIN.z0 - 0.02)
  g.fillRect(l0x, l0y, l1x - l0x, l1y - l0y)
  const [r0x] = P(WIN.x1 - 0.04, 0)
  const [r1x] = P(WIN.x1 + 0.02, 0)
  g.fillRect(r0x, l0y, r1x - r0x, l1y - l0y)
  return c
}

// ---------- the wall with its window, and the floor ----------

export const WALL = { x0: -1.4, x1: 1.4, z0: 0, z1: 3.1 }
/** the plain wall either side, wide enough for a landscape screen (desktop, the og image), at a lower
 *  resolution so no texture is over 2048 px (old phones) */
export const WALLSIDE = { x0: -4.4, x1: 4.4, z0: 0, z1: 3.1 }

export function paintWall(side = false): HTMLCanvasElement {
  const R = side ? WALLSIDE : WALL
  const ppm = side ? 220 : 480
  const W = Math.round((R.x1 - R.x0) * ppm),
    H = Math.round((R.z1 - R.z0) * ppm)
  const c = canvas(W, H)
  const g = c.getContext('2d')!
  const r = rng(9)
  const P = (x: number, z: number): [number, number] => [(x - R.x0) * ppm, (R.z1 - z) * ppm]
  g.fillStyle = '#F3EADB'
  g.fillRect(0, 0, W, H)
  // lime wash: soft mottling
  for (let i = 0; i < (side ? 1400 : 900); i++) {
    const x = r() * W,
      y = r() * H,
      rad = (20 + r() * 90) * (ppm / 480)
    const gr = g.createRadialGradient(x, y, 0, x, y, rad)
    const d = r() < 0.5
    gr.addColorStop(0, d ? 'rgba(200,180,150,0.05)' : 'rgba(255,252,244,0.07)')
    gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
  }
  if (side) {
    const [k0x, k0y] = P(R.x0, 0.09)
    g.fillStyle = '#E4D6BF'
    g.fillRect(k0x, k0y, W, H - k0y)
    g.fillStyle = 'rgba(255,255,255,0.5)'
    g.fillRect(k0x, k0y, W, 2)
    g.fillStyle = 'rgba(90,70,50,0.12)'
    g.fillRect(k0x, H - 4, W, 4)
    return c
  }
  // a soft stain under the sill
  const [sx, sy] = P(-0.1, 0.62)
  const st = g.createRadialGradient(sx, sy, 10, sx, sy, 200)
  st.addColorStop(0, 'rgba(170,140,95,0.16)')
  st.addColorStop(1, 'rgba(170,140,95,0)')
  g.fillStyle = st
  g.beginPath()
  g.ellipse(sx, sy, 260, 130, 0, 0, Math.PI * 2)
  g.fill()
  // a hairline crack from the window's top right corner
  g.strokeStyle = 'rgba(120,100,80,0.35)'
  g.lineWidth = 1.2
  g.beginPath()
  let [cx, cy] = P(WIN.x1 + 0.06, WIN.z1 + 0.06)
  g.moveTo(cx, cy)
  for (let i = 0; i < 14; i++) {
    cx += 6 + r() * 10
    cy -= 4 + r() * 9
    g.lineTo(cx, cy)
  }
  g.stroke()
  // skirting board
  const [k0x, k0y] = P(WALL.x0, 0.09)
  g.fillStyle = '#E4D6BF'
  g.fillRect(k0x, k0y, W, H - k0y)
  g.fillStyle = 'rgba(255,255,255,0.5)'
  g.fillRect(k0x, k0y, W, 3)
  g.fillStyle = 'rgba(90,70,50,0.12)'
  g.fillRect(k0x, H - 6, W, 6)
  // the window: reveal (the wall's thickness), the frame, the bars, the opening punched out
  const [o0x, o0y] = P(WIN.x0, WIN.z1)
  const [o1x, o1y] = P(WIN.x1, WIN.z0)
  // shadow the wall casts into the reveal
  g.fillStyle = '#D9CDB8'
  g.fillRect(o0x - 0, o0y - 0, o1x - o0x, o1y - o0y)
  const rv = 0.04 * ppm
  // the frame: old wood painted pale green, chipped at the corners
  g.fillStyle = '#A8C3A0'
  g.fillRect(o0x + rv, o0y + rv, o1x - o0x - 2 * rv, o1y - o0y - rv)
  const fr = 0.03 * ppm
  g.clearRect(o0x + rv + fr, o0y + rv + fr, o1x - o0x - 2 * rv - 2 * fr, o1y - o0y - rv - fr)
  // reveal shading: the left reveal catches more room light than the right
  const lg = g.createLinearGradient(o0x, 0, o0x + rv, 0)
  lg.addColorStop(0, '#E6DAC6')
  lg.addColorStop(1, '#CFC1AA')
  g.fillStyle = lg
  g.fillRect(o0x, o0y, rv, o1y - o0y)
  const rg = g.createLinearGradient(o1x - rv, 0, o1x, 0)
  rg.addColorStop(0, '#BFB098')
  rg.addColorStop(1, '#D3C6B0')
  g.fillStyle = rg
  g.fillRect(o1x - rv, o0y, rv, o1y - o0y)
  const tg = g.createLinearGradient(0, o0y, 0, o0y + rv)
  tg.addColorStop(0, '#D8CBB5')
  tg.addColorStop(1, '#C4B59D')
  g.fillStyle = tg
  g.fillRect(o0x, o0y, o1x - o0x, rv)
  // bars (re-cut so the panes stay open)
  g.fillStyle = '#A8C3A0'
  for (const [x0, z0, x1, z1] of barRects()) {
    const [a, b] = P(Math.max(x0, WIN.x0 + 0.06), z1)
    const [d, e] = P(Math.min(x1, WIN.x1 - 0.06), Math.max(z0, WIN.z0))
    g.fillRect(a, b, d - a, e - b)
    // a lit edge on the top and left, a shade on the bottom
    g.fillStyle = 'rgba(255,255,255,0.25)'
    g.fillRect(a, b, d - a, 2)
    g.fillStyle = 'rgba(40,60,40,0.18)'
    g.fillRect(a, e - 2, d - a, 2)
    g.fillStyle = '#A8C3A0'
  }
  // chips to bare wood at the frame's corners and on the bars
  g.fillStyle = '#B98F62'
  const chip = (x: number, z: number, s: number) => {
    const [a, b] = P(x, z)
    g.beginPath()
    g.moveTo(a, b)
    for (let i = 0; i < 6; i++) g.lineTo(a + (r() - 0.3) * s, b + (r() - 0.3) * s)
    g.fill()
  }
  chip(WIN.x0 + 0.045, WIN.z1 - 0.045, 12)
  chip(WIN.x1 - 0.06, WIN.z1 - 0.05, 9)
  chip(WIN.x0 + 0.05, WIN.z0 + 0.01, 10)
  chip(0.012, 1.4, 7)
  chip(-0.2, WIN.z0 + (WIN.z1 - WIN.z0) / 3 + 0.01, 6)
  // the brass stays, one per casement
  g.strokeStyle = '#B08A3E'
  g.lineWidth = 3
  g.beginPath()
  g.moveTo(...P(WIN.x0 + 0.06, WIN.z0 + 0.03))
  g.lineTo(...P(WIN.x0 + 0.06, WIN.z0 + 0.12))
  g.moveTo(...P(WIN.x1 - 0.06, WIN.z0 + 0.03))
  g.lineTo(...P(WIN.x1 - 0.06, WIN.z0 + 0.12))
  g.stroke()
  // the rail's two brackets
  g.fillStyle = '#9C7A35'
  for (const bx of [-0.62, 0.62]) {
    const [a, b] = P(bx - 0.012, 2.3)
    g.fillRect(a, b, 0.024 * ppm, 0.07 * ppm)
  }
  return c
}

export const FLOOR = { x0: -4, x1: 4, y0: 0, y1: 3.0 }

export function paintFloor(): HTMLCanvasElement {
  const ppm = 240
  const W = Math.round((FLOOR.x1 - FLOOR.x0) * ppm),
    H = Math.round((FLOOR.y1 - FLOOR.y0) * ppm)
  const c = canvas(W, H)
  const g = c.getContext('2d')!
  const r = rng(21)
  // boards run toward the viewer: canvas x = world x, canvas y = world y (0 at the wall, top)
  const bw = 0.13 * ppm
  for (let i = 0, x = 0; x < W; i++, x += bw) {
    const tone = 0.92 + r() * 0.14
    const base = [217 * tone, 160 * tone, 92 * tone]
    g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`
    g.fillRect(x, 0, bw, H)
    // grain
    for (let k = 0; k < 26; k++) {
      g.strokeStyle = `rgba(${r() < 0.5 ? '120,75,35' : '245,200,140'},${0.08 + r() * 0.1})`
      g.lineWidth = 0.8 + r() * 1.6
      const gx = x + r() * bw
      g.beginPath()
      g.moveTo(gx, 0)
      for (let y = 0; y <= H; y += 40) g.lineTo(gx + Math.sin(y * 0.01 + k) * 3 + (r() - 0.5) * 2, y)
      g.stroke()
    }
    // butt joints
    let y = r() * 0.8 * ppm
    while (y < H) {
      g.fillStyle = 'rgba(80,45,20,0.35)'
      g.fillRect(x, y, bw, 1.5)
      y += (380 + r() * 400) * (ppm / 300)
    }
    g.fillStyle = 'rgba(70,40,18,0.45)'
    g.fillRect(x, 0, 1.6, H)
  }
  // a worn, waxed sheen down the middle
  const sh = g.createLinearGradient(0, 0, W, 0)
  sh.addColorStop(0.3, 'rgba(255,235,200,0)')
  sh.addColorStop(0.5, 'rgba(255,235,200,0.12)')
  sh.addColorStop(0.7, 'rgba(255,235,200,0)')
  g.fillStyle = sh
  g.fillRect(0, 0, W, H)
  return c
}

// ---------- sprites: the sill, the sill things, brass ----------

/** the sill things as one sprite over the window's lower half, seen from the room against the light */
export const SILLSPRITE = { x0: -0.6, x1: 0.6, z0: 0.45, z1: 1.15 }
export function paintSillThings(pal: Palette, what: 'pot' | 'cat' | 'look' | 'blink'): HTMLCanvasElement {
  const ppm = 420
  const W = Math.round((SILLSPRITE.x1 - SILLSPRITE.x0) * ppm),
    H = Math.round((SILLSPRITE.z1 - SILLSPRITE.z0) * ppm)
  const c = canvas(W, H)
  const g = c.getContext('2d')!
  const P: Pt = (x, z) => [(x - SILLSPRITE.x0) * ppm, (SILLSPRITE.z1 - z) * ppm]
  const night = pal.night
  // the cat, backlit: a dark warm ginger with a bright rim (its own sprite: it shows when the curtain opens)
  if (what === 'pot') paintPot()
  else paintCat()
  return c
  function paintCat() {
  catPath(g, P)
  const [cx0, cy0] = P(CAT.x, CAT.z + 0.34)
  const [, cy1] = P(CAT.x, CAT.z)
  const cg = g.createLinearGradient(0, cy0, 0, cy1)
  cg.addColorStop(0, night ? '#3A2A20' : '#9A5A26')
  cg.addColorStop(1, night ? '#2A1E18' : '#6E3C18')
  g.fillStyle = cg
  g.fill()
  g.save()
  g.clip()
  // tabby stripes across the back
  g.strokeStyle = night ? 'rgba(0,0,0,0.25)' : 'rgba(70,30,8,0.45)'
  g.lineWidth = 5
  for (let i = 0; i < 6; i++) {
    const [a, b] = P(CAT.x - 0.1, CAT.z + 0.04 + i * 0.03)
    g.beginPath()
    g.moveTo(a, b)
    g.quadraticCurveTo(cx0, b - 10, a + 0.2 * ppm, b)
    g.stroke()
  }
  g.restore()
  g.strokeStyle = night ? 'rgba(170,190,255,0.5)' : 'rgba(255,220,150,0.85)'
  g.lineWidth = 2.5
  catPath(g, P)
  g.stroke()
  if (what !== 'cat') {
    // it has turned its head to look over its shoulder: two eyes and a nose (blink: the eyes are lines)
    const [ex, ey] = P(CAT.x, CAT.z + 0.275)
    const s = ppm * 0.001
    g.fillStyle = night ? '#C9D98A' : '#D8E07A'
    g.strokeStyle = '#2A1808'
    g.lineWidth = 2
    for (const dx of [-19, 19]) {
      g.beginPath()
      if (what === 'look') {
        g.ellipse(ex + dx * s, ey, 9 * s, 7 * s, 0, 0, Math.PI * 2)
        g.fill()
        g.stroke()
        g.fillStyle = '#1A1006'
        g.beginPath()
        g.ellipse(ex + dx * s, ey, 2.2 * s, 6 * s, 0, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = night ? '#C9D98A' : '#D8E07A'
      } else {
        g.moveTo(ex + dx * s - 9 * s, ey)
        g.quadraticCurveTo(ex + dx * s, ey + 5 * s, ex + dx * s + 9 * s, ey)
        g.stroke()
      }
    }
    g.fillStyle = '#E8A0A0'
    g.beginPath()
    g.moveTo(ex - 5 * s, ey + 16 * s)
    g.lineTo(ex + 5 * s, ey + 16 * s)
    g.lineTo(ex, ey + 22 * s)
    g.closePath()
    g.fill()
  }
  }
  function paintPot() {
  // the pot
  potPath(g, P)
  g.fillStyle = night ? '#4A2E24' : '#B5643E'
  g.fill()
  const [pa, pb] = P(POT.x - 0.072, POT.z + 0.11)
  g.fillStyle = night ? '#5A382B' : '#C97A52'
  g.fillRect(pa, pb, 0.144 * ppm, 0.022 * ppm)
  // pothos
  g.beginPath()
  for (const l of LEAVES) leafPath(g, P, l)
  g.fillStyle = night ? '#1E3A24' : '#3F7F3A'
  g.fill()
  g.strokeStyle = night ? 'rgba(150,200,150,0.25)' : 'rgba(200,240,120,0.6)'
  g.lineWidth = 1.5
  g.stroke()
  }
}

/** the chime as a sprite over the top right pane */
export const CHIMESPRITE = { x0: 0.3, x1: 0.5, z0: 1.68, z1: 2.06 }
export function paintChime(): HTMLCanvasElement {
  const ppm = 420
  const W = Math.round((CHIMESPRITE.x1 - CHIMESPRITE.x0) * ppm),
    H = Math.round((CHIMESPRITE.z1 - CHIMESPRITE.z0) * ppm)
  const c = canvas(W, H)
  const g = c.getContext('2d')!
  const P: Pt = (x, z) => [(x - CHIMESPRITE.x0) * ppm, (CHIMESPRITE.z1 - z) * ppm]
  g.strokeStyle = 'rgba(60,50,40,0.8)'
  g.lineWidth = 1.2
  g.beginPath()
  g.moveTo(...P(CHIME.x, CHIME.z))
  g.lineTo(...P(CHIME.x, CHIME.z - 0.2))
  g.stroke()
  chimePath(g, P)
  g.fillStyle = 'rgba(200,235,245,0.7)'
  g.fill()
  g.strokeStyle = 'rgba(255,255,255,0.9)'
  g.lineWidth = 1.5
  g.stroke()
  // a painted goldfish on the glass
  const [fx, fy] = P(CHIME.x, CHIME.z - 0.145)
  g.fillStyle = 'rgba(220,60,40,0.8)'
  g.beginPath()
  g.ellipse(fx, fy, 5, 3, 0, 0, Math.PI * 2)
  g.fill()
  chimeStrip(g, P)
  g.fillStyle = '#F2EEE2'
  g.fill()
  g.fillStyle = 'rgba(30,40,90,0.55)'
  const [s0, s1] = P(CHIME.x - 0.004, CHIME.z - 0.21)
  g.fillRect(s0, s1, 3, 30)
  return c
}

/** a brass ring seen face on, and a ball finial: 64 x 64 each */
export function paintBrass(): HTMLCanvasElement {
  const c = canvas(128, 64)
  const g = c.getContext('2d')!
  // ring
  const rg = g.createLinearGradient(8, 8, 56, 56)
  rg.addColorStop(0, '#FFE7A6')
  rg.addColorStop(0.4, '#C99A3E')
  rg.addColorStop(1, '#6E4E1C')
  g.strokeStyle = rg
  g.lineWidth = 9
  g.beginPath()
  g.arc(32, 32, 22, 0, Math.PI * 2)
  g.stroke()
  g.strokeStyle = 'rgba(255,250,220,0.8)'
  g.lineWidth = 2
  g.beginPath()
  g.arc(32, 32, 24, Math.PI * 1.05, Math.PI * 1.45)
  g.stroke()
  // finial
  const fg = g.createRadialGradient(88, 22, 2, 96, 32, 28)
  fg.addColorStop(0, '#FFF3C8')
  fg.addColorStop(0.35, '#D8AA4E')
  fg.addColorStop(1, '#5E4216')
  g.fillStyle = fg
  g.beginPath()
  g.arc(96, 32, 26, 0, Math.PI * 2)
  g.fill()
  return c
}

/** the neighbour's window opposite (row 2, column 3 of the building): their own curtain, 0 shut to 1 open */
export const NEIGH = { x0: 0.33, x1: 0.55, z0: 1.04, z1: 1.28 }
export function paintNeighbour(pal: Palette, k: number): HTMLCanvasElement {
  const W = 88,
    H = 96
  const c = canvas(W, H)
  const g = c.getContext('2d')!
  const night = pal.night
  g.fillStyle = night ? '#F6C977' : pal.id === 'golden' ? '#6E5048' : '#5E6C78'
  g.fillRect(0, 0, W, H)
  if (k > 0.05) {
    // head and shoulders, no features
    g.fillStyle = night ? '#4A3424' : '#2E3238'
    g.beginPath()
    g.ellipse(W * 0.5, H * 0.5, W * 0.13, H * 0.14, 0, 0, Math.PI * 2)
    g.fill()
    g.beginPath()
    g.moveTo(W * 0.2, H)
    g.bezierCurveTo(W * 0.22, H * 0.7, W * 0.36, H * 0.66, W * 0.5, H * 0.66)
    g.bezierCurveTo(W * 0.64, H * 0.66, W * 0.78, H * 0.7, W * 0.8, H)
    g.fill()
  }
  const half = W * 0.5 * (1 - 0.82 * k)
  g.fillStyle = night ? '#C9A97A' : pal.id === 'golden' ? '#F2D2B8' : '#F4D9C8'
  g.fillRect(0, 0, half, H)
  g.fillRect(W - half, 0, half, H)
  g.fillStyle = 'rgba(120,60,40,0.18)'
  for (let i = 1; i < 4; i++) {
    g.fillRect((half * i) / 4, 0, 1, H)
    g.fillRect(W - (half * i) / 4, 0, 1, H)
  }
  return c
}
