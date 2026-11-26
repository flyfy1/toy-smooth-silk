// Smooth as Silk: the window, the curtain (cloth kit), the breeze, the rings, the hand, the sounds, the
// cat and the other things outside (spec 7), the share peak, and the `?shot=` states for the stills.
// Harness: window.__toy (ready, degrade, simMs, ...).

import { Cloth } from './cloth/solver'
import { MeshAttribs, Refiner, gridIndices, gridUV } from './cloth/mesh'
import { Renderer } from './gl'
import { rng } from './paint'
import { CAM, PALETTES, RAIL, SILL, WIN, makeView, paletteForHour, project, type PalId, type Palette, type View } from './scene'
import { CAT } from './paint'
import { audio } from './AudioEngine'
import { act, track } from './analytics'

const COLS = 56
const ROWS = 26
const DU = 0.032
const DV = 0.086
const ZTOP = RAIL.z - 0.025
const RING_EVERY = 5
const NRING = 12
const RING0 = -0.7
const RING_GAP_MIN = 0.014
/** how far a held point may get sideways from its ring before the ring slides after it */
const RING_LAG_D = 0.25
const S_SUB = 6
const C_DAMP = 0.25
const C_AIR = 16
const G = 9.81
const MU = 0.2
/** wind coupling k(|W|) = W_A + W_B |W| (see step) */
const W_A = 0.012
const W_B = 0.14

type Shot = 'closed' | 'billow' | 'drag' | 'open' | 'night' | 'floor' | 'release' | 'bat' | 'og' | 'seen' | 'neighbour' | 'rain' | 'sunset' | 'moon'

/** the events outside, in the card's order (SILK_VIEWS in cards.ts: 0 is none) */
const VIEWS = ['none', 'cat', 'neighbour', 'rain', 'sunset', 'moon'] as const
type View0 = (typeof VIEWS)[number]

export interface Callbacks {
  onFirst: () => void
  onNoGL: () => void
  /** a deadpan line near the bottom, or Mum's chat bubble */
  onLine: (key: string, mode: 'line' | 'mum', vars?: Record<string, string | number>) => void
  /** the share peak: once per visit (first), then on opens (every) */
  onPeak: (kind: 'first' | 'every', n: number, data: Record<string, number>, snap: HTMLCanvasElement | null) => void
  /** numbers and a snapshot for a card drawn without a peak (the snapshot renders and copies in one go:
   *  a later copy of a WebGL canvas is blank) */
  onData: (data: () => Record<string, number>, snap: () => HTMLCanvasElement | null) => void
}

export interface GameApi {
  dispose: () => void
  /** seconds by the window since the first touch */
  sec: () => number
}

interface ToyHarness {
  ready: boolean
  degrade: number
  simMs: number
  inputToDrawMs: number
  shot: string
  pal: PalId
  advance: (ms: number) => Promise<void>
  release: () => void
  /** tap the cat's shadow (as a finger would) */
  poke: () => void
  /** play an event now (as on an open) */
  event: (v: View0) => void
  /** take the share peak now */
  peak: () => void
  rings: () => number[]
  probe: () => Record<string, number>
  view: () => View
}
declare global {
  interface Window {
    __toy?: ToyHarness
  }
}

// ---------- smooth noise (value noise, seeded) ----------
function makeNoise(seed: number) {
  const r = rng(seed)
  const T = new Float32Array(256).map(() => r())
  const h = (x: number, y: number) => T[(x * 37 + y * 101 + ((x * y) & 255)) & 255]
  return (x: number, y: number) => {
    const xi = Math.floor(x),
      yi = Math.floor(y)
    const fx = x - xi,
      fy = y - yi
    const u = fx * fx * (3 - 2 * fx),
      v = fy * fy * (3 - 2 * fy)
    const a = h(xi, yi),
      b = h(xi + 1, yi),
      c = h(xi, yi + 1),
      d = h(xi + 1, yi + 1)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  }
}

export function startGame(canvas: HTMLCanvasElement, cb: Callbacks): GameApi {
  const q = new URLSearchParams(location.search)
  const shot = (q.get('shot') || '') as Shot | ''
  const seed = Number(q.get('seed')) || 7
  const hourQ = q.get('hour')
  const hour = hourQ !== null && hourQ !== '' ? Number(hourQ) : new Date().getHours()
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  let palId: PalId = paletteForHour(hour)
  // a link's view (?v=1..5): its event plays on the first open; 4 brings the sunset, 5 the night
  const vq = Number(q.get('v'))
  const linkView: View0 | null = Number.isInteger(vq) && vq >= 1 && vq <= 5 ? VIEWS[vq] : null
  if (linkView === 'sunset') palId = 'golden'
  if (linkView === 'moon') palId = 'night'
  if (shot === 'billow' || shot === 'floor' || shot === 'og' || shot === 'sunset') palId = 'golden'
  else if (shot === 'night' || shot === 'moon') palId = 'night'
  else if (shot) palId = 'day'
  if (q.get('pal') && q.get('pal')! in PALETTES) palId = q.get('pal') as PalId
  const pal = (): Palette => PALETTES[palId]

  const gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: false, premultipliedAlpha: true }) as WebGLRenderingContext | null
  if (!gl) {
    cb.onNoGL()
    return { dispose: () => {}, sec: () => 0 }
  }

  // ---------- the cloth ----------
  const num = (k: string, d: number) => (q.get(k) !== null ? Number(q.get(k)) : d)
  const SUB = num('S', S_SUB)
  const RING_LAG = num('lag', RING_LAG_D)
  const LRA_SLACK = num('lra', 1.04)
  const CAIR = num('air', C_AIR)
  const NOWIND = num('nw', 0) > 0
  /** right after a release the air and damping ease off, so the silk swings back in one long wave */
  const REL_K = num('rd', 0.15)
  const REL_T = num('rt', 3)
  const WB = num('wb', W_B)
  let relAt = -1e9
  const cloth = new Cloth({ cols: COLS, rows: ROWS, du: DU, dv: DV, shear: num('sh', 0.3), bendU: num('bu', 4), bendV: num('bv', 4) })
  const RU = 2,
    RV = 3
  const fine = new Refiner(COLS, ROWS, RU, RV)
  const mesh = new MeshAttribs(fine.cols, fine.rows)
  const geo = { pos: fine.pos, attr: mesh.data, uv: gridUV(fine.cols, fine.rows), idx: gridIndices(fine.cols, fine.rows) }
  /** per simulated particle: its vertex in the render mesh (for the normals the air needs) */
  const fineAt = new Uint16Array(COLS * ROWS)
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) fineAt[r * COLS + c] = fine.at(c, r)
  const remesh = () => {
    fine.update(cloth.x)
    mesh.update(fine.pos, DU / RU, DV / RV)
  }
  const ringCol = Array.from({ length: NRING }, (_, k) => k * RING_EVERY)
  const ringV = new Float32Array(NRING)
  let dragged = -1
  let handSpeed = 0
  // long-range attachments: no particle gets further from its nearest ring than the cloth between them
  // allows (one cheap pass per substep; it is what keeps a hard pull from stretching the silk like rubber).
  const lraRing = new Uint8Array(COLS * ROWS)
  const lraLen = new Float32Array(COLS * ROWS)
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const k = Math.min(NRING - 1, Math.round(c / RING_EVERY))
      lraRing[r * COLS + c] = k
      lraLen[r * COLS + c] = Math.hypot((c - k * RING_EVERY) * DU, r * DV) * LRA_SLACK
    }
  for (const c of ringCol) {
    cloth.w0[c] = 0
    cloth.w[c] = 0
  }

  /** lay the curtain out from ring positions: one smooth pleat per ring gap, alternating in and out */
  function seed2(rings: number[]) {
    const x = cloth.x
    for (let c = 0; c < COLS; c++) {
      const k = Math.min(NRING - 2, Math.floor(c / RING_EVERY))
      const s = (c - k * RING_EVERY) / RING_EVERY
      const d = rings[k + 1] - rings[k]
      const L = RING_EVERY * DU
      const A = 0.5 * Math.sqrt(Math.max(0, L * L - d * d))
      const px = rings[k] + d * s
      const py = RAIL.y + (k % 2 ? -1 : 1) * A * Math.sin(Math.PI * s)
      for (let r = 0; r < ROWS; r++) {
        const i = (r * COLS + c) * 3
        x[i] = px
        x[i + 1] = py
        x[i + 2] = ZTOP - r * DV
      }
    }
    cloth.p.set(cloth.x)
  }
  const closedRings = Array.from({ length: NRING }, (_, k) => RING0 + (k * 1.4) / (NRING - 1))
  const openRings = Array.from({ length: NRING }, (_, k) => RING0 + k * 0.026)
  const openShot = shot === 'open' || shot === 'seen' || shot === 'neighbour' || shot === 'rain' || shot === 'sunset' || shot === 'moon'
  seed2(openShot ? openRings : closedRings)
  remesh()

  // ---------- wind ----------
  const noise = makeNoise(seed)
  const rnd = rng(seed * 7 + 3)
  let t = 0
  const gust = { next: 6 + rnd() * 8, t0: -1, amp: 0, force: 0 }
  const baseWind = () => (rainK > 0.5 ? 0.6 : pal().night ? 0.2 : 0.35)
  /** a tap beside the curtain: a puff of 3 m/s within 0.25 m of (x, z) for 150 ms */
  const puff = { x: 0, z: 0, until: -1 }
  let rainK = 0
  let chimeArmed = true
  function gustW(): number {
    if (gust.t0 < 0 && t >= gust.next && !reduced) {
      chimeArmed = true
      gust.t0 = t
      gust.amp = gust.force || 1.6 + rnd() * 1.2
      gust.force = 0
    }
    const b = baseWind()
    if (gust.t0 < 0) return b
    const e = t - gust.t0
    let k = 0
    if (e < 0.8) k = 0.5 - 0.5 * Math.cos((Math.PI * e) / 0.8)
    else if (e < 2) k = 1
    else if (e < 4) k = 0.5 + 0.5 * Math.cos((Math.PI * (e - 2)) / 2)
    else {
      gust.t0 = -1
      gust.next = t + (rainK > 0.5 ? 4 + rnd() * 4 : 6 + rnd() * 8)
      return b
    }
    return b + (gust.amp - b) * k
  }
  let lastWb = 0
  function forceGust(at: number, amp: number) {
    gust.next = at
    gust.t0 = -1
    gust.force = amp
  }

  // ---------- the hand ----------
  const hand = {
    on: false,
    i: -1,
    driven: [] as { i: number; ox: number; oy: number; oz: number }[],
    tx: 0,
    ty: 0,
    tz: 0,
    rx: 0,
    ry: 0,
    rz: 0,
    /** the grabbed point's ring, where it was at the grab */
    ring0: 0,
  }
  function grab(i: number) {
    hand.on = true
    hand.i = i
    const x = cloth.x
    hand.rx = x[i * 3]
    hand.ry = x[i * 3 + 1]
    hand.rz = x[i * 3 + 2]
    hand.tx = hand.rx
    hand.ty = hand.ry + 0.02 // the patch comes 2 cm toward the viewer in the same frame
    hand.tz = hand.rz
    hand.ring0 = x[ringCol[lraRing[i]] * 3]
    hand.driven = []
    const c0 = i % COLS,
      r0 = Math.floor(i / COLS)
    for (let r = Math.max(0, r0 - 2); r <= Math.min(ROWS - 1, r0 + 2); r++)
      for (let c = Math.max(0, c0 - 3); c <= Math.min(COLS - 1, c0 + 3); c++) {
        const d = Math.hypot((c - c0) * DU, (r - r0) * DV)
        if (d > 0.09) continue
        const f = 1 - (d / 0.09) ** 2
        if (f < 0.5) continue
        const j = r * COLS + c
        if (r === 0) continue
        hand.driven.push({ i: j, ox: (x[j * 3] - hand.rx) * 0.6, oy: x[j * 3 + 1] - hand.ry, oz: (x[j * 3 + 2] - hand.rz) * 0.6 })
        cloth.w[j] = 0
      }
  }
  function moveHand(dx: number, dz: number) {
    // in the plane of the screen at the cloth's depth; out toward the viewer by 0.30 * |drag|, capped
    // the 0.9 m limit is from the rest point carried along by the ring: a sideways pull that slides the
    // rings can go all the way across (that is how the curtain opens)
    const slid = cloth.x[ringCol[lraRing[hand.i]] * 3] - hand.ring0
    let mx = dx - slid,
      mz = dz
    const L = Math.hypot(mx, mz)
    if (L > 0.9) {
      mx *= 0.9 / L
      mz *= 0.9 / L
    }
    const tent = Math.min(0.35, 0.3 * Math.hypot(mx, mz))
    hand.tx = hand.rx + slid + mx
    hand.tz = hand.rz + mz
    hand.ty = Math.max(0.03, hand.ry + 0.02 + tent)
  }
  /** let go; `swing`: it was a pull, so the silk swings back (a tap, a poke, does not ease the air) */
  function release(swing = true) {
    for (const d of hand.driven) cloth.w[d.i] = cloth.w0[d.i]
    if (hand.on && swing) relAt = t
    hand.on = false
    hand.driven = []
  }

  // ---------- the solver step ----------
  const n = cloth.n
  /** predict: gravity, the air on the normal component, damping (its own function, so the JIT keeps it
   *  optimised whatever the rest of step() does) */
  function predict(h: number, tt: number, cAir: number, dm: number, wb: number) {
    const x = cloth.x,
      p = cloth.p,
      w = cloth.w
    const nrm = mesh.data
    // predict: gravity, air on the normal component, damping
    for (let i = 0; i < n; i++) {
      const k = i * 3
      if (w[i] === 0) {
        p[k] = x[k]
        p[k + 1] = x[k + 1]
        p[k + 2] = x[k + 2]
        continue
      }
      let vx = (x[k] - p[k]) / h,
        vy = (x[k + 1] - p[k + 1]) / h,
        vz = (x[k + 2] - p[k + 2]) / h
      vz -= G * h
      // wind: only in front of the open window or within 0.3 m of it
      const px = x[k],
        pz = x[k + 2]
      const ox = Math.max(0, WIN.x0 - px, px - WIN.x1),
        oz = Math.max(0, WIN.z0 - pz, pz - WIN.z1)
      const near = Math.max(0, 1 - Math.hypot(ox, oz) / 0.3)
      let Wx = 0,
        Wy = 0
      if (tt < puff.until) {
        const pd = Math.hypot(px - puff.x, pz - puff.z)
        if (pd < 0.25) Wy -= 3 * (1 - pd / 0.25) * (W_A + WB * 3)
      }
      if (near > 0 && !NOWIND) {
        const n1 = noise(px * 1.3 - tt * 0.7, pz * 0.8 + tt * 0.3) * 2 - 1
        const n2 = noise(px * 1.3 - tt * 0.7 + 17.3, pz * 0.8 + tt * 0.3 + 5.1)
        // the breeze's push grows faster than linearly with its speed (drag goes as v^2): a 0.35 m/s
        // breeze only stirs the silk, a 2.8 m/s gust stands it 0.25 to 0.5 m into the room
        const ws = wb * (0.6 + 0.4 * n2)
        const kw = W_A + WB * ws
        Wx = 0.15 * n1 * near * kw
        Wy += ws * near * kw
      }
      const fi = fineAt[i] * 11
      const nx = nrm[fi],
        ny = nrm[fi + 1],
        nz = nrm[fi + 2]
      // the wind's push at full strength; the air's drag on the silk's own motion eased after a release
      const a = (CAIR * (Wx * nx + Wy * ny) - cAir * (vx * nx + vy * ny + vz * nz)) * h
      vx += a * nx
      vy += a * ny
      vz += a * nz
      vx *= dm
      vy *= dm
      vz *= dm
      p[k] = x[k]
      p[k + 1] = x[k + 1]
      p[k + 2] = x[k + 2]
      x[k] += vx * h
      x[k + 1] += vy * h
      x[k + 2] += vz * h
    }
  }

  let flip = false
  let prevHand = { x: 0, y: 0, z: 0 }
  function step(dt: number) {
    const S = SUB
    const h = dt / S
    const x = cloth.x,
      p = cloth.p,
      w = cloth.w
    const wb = gustW()
    lastWb = wb
    // air and damping, eased off for a moment after a release
    const re = Math.min(1, Math.max(0, (t - relAt) / REL_T))
    const relK = REL_K + (1 - REL_K) * re * re * (3 - 2 * re)
    const cAir = CAIR * relK
    const dm = 1 - C_DAMP * relK * (dt / S)
    const ph = prevHand
    handSpeed = hand.on ? Math.abs(hand.tx - ph.x) / dt : 0
    for (let sub = 0; sub < S; sub++) {
      t += h
      const tt = t
      // driven particles to their targets, interpolated across the frame
      if (hand.on) {
        const a = (sub + 1) / S
        let hx = ph.x + (hand.tx - ph.x) * a,
          hy = ph.y + (hand.ty - ph.y) * a,
          hz = ph.z + (hand.tz - ph.z) * a
        // The cloth between the finger and its ring is only so long. Pulled far sideways, the ring slides
        // (it never lags the finger by more than RING_LAG); otherwise the finger cannot take the cloth
        // further from the ring than its length, and the pinch rises instead of the silk stretching.
        {
          const rk = lraRing[hand.i]
          const kr = ringCol[rk] * 3
          if (rk > 0) {
            // a quick sideways pull (0.15 m/s or more) gathers the rings sooner
            const lagMax = handSpeed >= 0.15 ? RING_LAG * 0.7 : RING_LAG
            const lag = hx - x[kr]
            if (Math.abs(lag) > lagMax) {
              const nx = hx - Math.sign(lag) * lagMax
              ringV[rk] = Math.max(-0.5, Math.min(0.5, (nx - x[kr]) / h))
              x[kr] = nx
              dragged = rk
            }
          }
          const L = lraLen[hand.i]
          const dx = hx - x[kr],
            dy = hy - RAIL.y,
            dz = hz - ZTOP
          const d = Math.hypot(dx, dy, dz)
          if (d > L) {
            const f = L / d
            hx = x[kr] + dx * f
            hy = RAIL.y + dy * f
            hz = ZTOP + dz * f
          }
        }
        for (const d of hand.driven) {
          const k = d.i * 3
          x[k] = hx + d.ox
          x[k + 1] = hy + d.oy
          x[k + 2] = hz + d.oz
        }
      }
      predict(h, tt, cAir, dm, wb)
      // rings: kinematic on the rail. Only the hand moves them (the breeze never does); let go, a ring
      // coasts and stops under 2.5 m/s^2 of friction (at most 0.05 m from 0.5 m/s)
      for (let r = 1; r < NRING; r++) {
        const k = ringCol[r] * 3
        if (r !== dragged && ringV[r] !== 0) {
          const dec = 2.5 * h
          ringV[r] = Math.abs(ringV[r]) <= dec ? 0 : ringV[r] - Math.sign(ringV[r]) * dec
          x[k] += ringV[r] * h
        }
        p[k] = x[k]
        x[k + 1] = RAIL.y
        x[k + 2] = ZTOP
      }
      const dr = dragged
      dragged = -1
      const s0 = cloth.s
      s0.set(x)
      cloth.solve(flip)
      flip = !flip
      // long-range attachments
      for (let i = COLS; i < n; i++) {
        const rk = lraRing[i]
        const k = i * 3,
          kr = ringCol[rk] * 3
        const dx = x[k] - x[kr],
          dy = x[k + 1] - x[kr + 1],
          dz = x[k + 2] - x[kr + 2]
        const L = lraLen[i]
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 <= L * L) continue
        if (w[i] === 0) continue
        const f = L / Math.sqrt(d2)
        x[k] = x[kr] + dx * f
        x[k + 1] = x[kr + 1] + dy * f
        x[k + 2] = x[kr + 2] + dz * f
      }
      // the heading: two rings are never further apart than the cloth between them. A pulled ring drags its
      // neighbours on both sides (outward from it); otherwise ring 0, fixed at the left, holds the chain.
      const GMAX = RING_EVERY * DU
      if (dr > 0)
        for (let r = dr - 1; r >= 1; r--) {
          const k = ringCol[r] * 3,
            kn = ringCol[r + 1] * 3
          if (x[kn] - x[k] > GMAX) x[k] = x[kn] - GMAX
        }
      for (let r = 1; r < NRING; r++) {
        const k = ringCol[r] * 3,
          kp = ringCol[r - 1] * 3
        if (x[k] - x[kp] > GMAX) x[k] = x[kp] + GMAX
      }
      // order and spacing; nothing past the finials. A ring pulled left pushes the rings ahead of it along
      // (they stack against ring 0 and then hold it).
      if (dr > 0)
        for (let r = dr - 1; r >= 1; r--) {
          const k = ringCol[r] * 3,
            kn = ringCol[r + 1] * 3
          if (x[k] > x[kn] - RING_GAP_MIN) x[k] = x[kn] - RING_GAP_MIN
        }
      for (let r = 1; r < NRING; r++) {
        const k = ringCol[r] * 3,
          kp = ringCol[r - 1] * 3
        if (x[k] < x[kp] + RING_GAP_MIN) x[k] = x[kp] + RING_GAP_MIN
      }
      for (let r = NRING - 1; r >= 1; r--) {
        const k = ringCol[r] * 3
        const lim = r === NRING - 1 ? RAIL.x1 - 0.03 : x[ringCol[r + 1] * 3] - RING_GAP_MIN
        if (x[k] > lim) x[k] = lim
      }
      // collisions: the wall, the sill, the floor
      for (let i = 0; i < n; i++) {
        if (w[i] === 0) continue
        const k = i * 3
        let hit = false
        if (x[k + 1] < 0.02) {
          x[k + 1] = 0.02
          hit = true
        }
        if (x[k + 2] < 0.004) {
          x[k + 2] = 0.004
          hit = true
        }
        if (x[k] > SILL.x0 && x[k] < SILL.x1 && x[k + 1] < SILL.depth + 0.004 && x[k + 2] < SILL.z + 0.004 && x[k + 2] > SILL.z - SILL.thick - 0.004) {
          // out through the front: the curtain hangs in front of the sill and never tucks under it
          x[k + 1] = SILL.depth + 0.006
          hit = true
        }
        if (hit) {
          // friction on this substep's tangential movement (simplified: a share of it is cancelled)
          x[k] -= (x[k] - s0[k]) * MU
          x[k + 2] -= (x[k + 2] - s0[k + 2]) * MU * 0.5
        }
      }
    }
    prevHand = { x: hand.tx, y: hand.ty, z: hand.tz }
  }

  // ---------- render state ----------
  const r = new Renderer(canvas, gl, geo)
  let view = makeView(innerWidth, innerHeight)
  let dpr = Math.min(devicePixelRatio || 1, 2)
  const resize = () => {
    view = makeView(innerWidth, innerHeight)
    // the og image: the window at the right, the title at the left
    if (shot === 'og') {
      view.f *= 1.3
      view.cx = innerWidth * 0.68
      view.cy = innerHeight * 0.1 + (view.f * (RAIL.z - CAM[2])) / (CAM[1] - RAIL.y)
    }
    dpr = Math.min(devicePixelRatio || 1, 2)
    canvas.style.width = innerWidth + 'px'
    canvas.style.height = innerHeight + 'px'
    r.resize(innerWidth, innerHeight, dpr, view)
  }
  resize()
  addEventListener('resize', resize)
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault())
  canvas.addEventListener('webglcontextrestored', () => {
    r.build()
    resize()
  })

  const motes = new Float32Array(40 * 4)
  const mr = rng(seed + 99)
  const moteBase = Array.from({ length: 40 }, () => [WIN.x0 + 0.05 + mr() * 1.0, WIN.z0 + 0.1 + mr() * 1.1, 0.25 + mr() * 1.3, mr()])
  function updateMotes() {
    const fs = pal().floorSun
    for (let i = 0; i < 40; i++) {
      const [wx, wz, s, a] = moteBase[i]
      const ss = s + 0.03 * Math.sin(t * 0.3 + i)
      motes[i * 4] = wx - fs[0] * ss + 0.02 * Math.sin(t * 0.21 + i * 1.7)
      motes[i * 4 + 1] = -fs[1] * ss
      motes[i * 4 + 2] = wz - fs[2] * ss + 0.02 * Math.cos(t * 0.17 + i)
      motes[i * 4 + 3] = a
    }
  }

  function openness(): number {
    const last = cloth.x[ringCol[NRING - 1] * 3]
    return Math.max(0, Math.min(1, (0.55 - last) / 0.75))
  }

  function render() {
    remesh()
    updateMotes()
    const rings = ringCol.map((c) => cloth.x[c * 3])
    r.setMask(L.paw > t ? 1 : 0, L.flick > t ? 1 : 0, L.catHere)
    const pose = L.catPose
    // the sunset deepens the sky for 20 s; rain greys it
    const sd = L.sunsetK
    // rain: the sun goes in
    const P0 = pal()
    const P1 = rainK > 0 ? { ...P0, sunK: P0.sunK * (1 - 0.8 * rainK), silkSunK: (P0.silkSunK ?? P0.sunK) * (1 - 0.6 * rainK) } : P0
    r.draw({
      pal: P1,
      open: openness(),
      rings,
      motes,
      debug: num('dbg', 0),
      transK: q.get('tk') ? Number(q.get('tk')) : undefined,
      cat: { pose, alpha: L.catAlpha, dx: L.catDx, dz: L.catDz },
      neigh: L.neighK,
      rain: rainK,
      time: t,
      outTint: [1 - 0.04 * sd, 1 - 0.2 * sd, 1 - 0.34 * sd],
      expo: 1 + 0.06 * L.floodK,
      moteK: Math.min(1, L.moteK),
    })
    if (L.snapWanted) {
      // the card's snapshot: copied right after the draw call (a later copy of a WebGL canvas is blank)
      L.snapWanted = false
      L.snap = snapshot()
    }
  }

  /** the curtain and the window around it, for the card */
  function snapshot(): HTMLCanvasElement | null {
    try {
      const [x0] = project(view, RAIL.x0 - 0.08, 0.3, 0)
      const [x1] = project(view, RAIL.x1 + 0.08, 0.3, 0)
      const [, y0] = project(view, 0, 0.2, RAIL.z + 0.12)
      const [, y1] = project(view, 0, 0.6, -0.05)
      const sx = Math.max(0, x0 * dpr),
        sy = Math.max(0, y0 * dpr)
      const sw = Math.min(canvas.width - sx, (x1 - x0) * dpr),
        sh = Math.min(canvas.height - sy, (y1 - y0) * dpr)
      const k = Math.min(1, 900 / sw)
      const c = document.createElement('canvas')
      c.width = Math.round(sw * k)
      c.height = Math.round(sh * k)
      c.getContext('2d')!.drawImage(canvas, sx, sy, sw, sh, 0, 0, c.width, c.height)
      return c
    } catch {
      return null
    }
  }

  // ---------- life: opening, the cat, the things outside, Mum, the share peak (spec 6, 7, 8) ----------
  const L = {
    playT: -1, // t at the first touch
    state: 'closed' as 'open' | 'closed',
    opens: 0,
    openAt: -1e9,
    closeAt: -1e9,
    drags: 0,
    puffs: 0,
    pokes: 0,
    peakV: 0,
    view: 0,
    recent: [] as View0[],
    firstEventDone: false,
    shared: false,
    pointerUpAt: 0,
    snapWanted: false,
    snap: null as HTMLCanvasElement | null,
    // the cat
    catHere: true,
    catPose: 'cat' as 'cat' | 'look' | 'blink',
    catAlpha: 1,
    catDx: 0,
    catDz: 0,
    catBack: -1,
    paw: -1,
    flick: -1,
    nextFlick: 3 + rnd() * 3,
    batQueue: -1,
    // events
    ev: null as null | { v: View0; t0: number; snapAt: number; done: number },
    neighK: 0,
    neighShutAt: -1e9,
    sunsetK: 0,
    sunsetSeen: false,
    moonSeen: false,
    rainUntil: -1,
    rainMum: false,
    sunMumAt: -1,
    sunMumSaid: false,
    // feedback
    floodK: 0,
    floodT: -1e9,
    moteK: 0,
    lastLine: -1e9,
    pendingLine: null as null | { key: string; mode: 'line' | 'mum'; vars?: Record<string, string | number>; at: number },
    ringPrev: ringCol.map((c) => cloth.x[c * 3]),
    ringAcc: new Float32Array(NRING),
    stacked: false,
    lastFull: -1e9,
  }
  if (shot) L.catPose = 'cat'

  function line(key: string, mode: 'line' | 'mum' = 'line', vars?: Record<string, string | number>) {
    if (shot) return
    // at most one line per 4 s; Mum talks in her own bubble whenever she likes
    if (mode === 'mum' || t - L.lastLine >= 4) {
      if (mode === 'line') L.lastLine = t
      cb.onLine(key, mode, vars)
    } else L.pendingLine = { key, mode, vars, at: L.lastLine + 4 }
  }
  const secNow = () => (L.playT < 0 ? 0 : Math.round(t - L.playT))
  const peakData = () => ({ sec: secNow(), opens: L.opens, view: L.view, hour: Math.floor(hour) })

  function startEvent(v: View0) {
    if (v === 'none') return
    L.view = VIEWS.indexOf(v)
    L.recent.push(v)
    if (L.recent.length > 4) L.recent.shift()
    L.ev = { v, t0: t, snapAt: t + (v === 'cat' ? 1.0 : v === 'neighbour' ? 1.5 : v === 'rain' ? 3 : v === 'sunset' ? 5 : 1.2), done: t + (v === 'rain' ? 6 : v === 'sunset' ? 8 : 4) }
    if (v === 'cat') {
      line('silk_cat_seen')
      track('cat', { act: 'seen' })
    } else if (v === 'neighbour') line('silk_neighbour')
    else if (v === 'rain') {
      L.rainUntil = t + 40
      L.rainMum = true
      line('silk_mum_rain', 'mum')
      track('mum', { stage: 'rain' })
    } else if (v === 'sunset') {
      L.sunsetSeen = true
      line('silk_sunset')
    } else if (v === 'moon') {
      L.moonSeen = true
      const h = Math.floor(hour)
      if (h >= 0 && h <= 4) line('silk_moon_late', 'line', { h })
      else line('silk_moon')
    }
  }

  function pickEvent(): View0 {
    if (L.opens === 1) {
      if (linkView) return linkView
      if (L.catHere) return 'cat'
    }
    if (rnd() < 0.4) return 'none'
    const fits: View0[] = ['neighbour']
    if (!pal().night && rainK === 0) fits.push('rain')
    if (palId === 'golden' && !L.sunsetSeen) fits.push('sunset')
    if (pal().night && !L.moonSeen) fits.push('moon')
    const ok = fits.filter((v) => !L.recent.includes(v))
    return ok.length ? ok[Math.floor(rnd() * ok.length)] : 'none'
  }

  function onOpen() {
    L.opens++
    L.openAt = t
    L.floodT = t
    audio.flood()
    act('open')
    const v = L.ev ? 'none' : pickEvent()
    track('open', { n: L.opens, sec: secNow(), view: v === 'none' ? VIEWS[L.view] : v, v: Math.round(L.peakV * 100), pal: palId })
    L.peakV = 0
    // third open: the cat has had enough, it steps off the sill (back in 60 to 90 s)
    if (L.opens === 3 && L.catHere && v !== 'cat') {
      L.catHere = false
      L.catBack = t + 60 + rnd() * 30
      track('cat', { act: 'left' })
    }
    startEvent(v)
    if (L.shared && !shot) cb.onPeak('every', L.opens, peakData(), L.snap)
  }
  function onClose() {
    L.closeAt = t
    track('close', { n: L.opens, quick: t - L.openAt < 2 ? 1 : 0 })
    if (t - L.neighShutAt < 2) line('silk_neighbour_both')
    if (rainK > 0.5) line('silk_rain_closed')
    if (L.sunMumSaid && t - L.openAt > 20) {
      line('silk_mum_ok', 'mum')
      track('mum', { stage: 'ok' })
      L.sunMumSaid = false
    }
  }

  function poke() {
    L.pokes++
    act('cat')
    track('cat', { act: 'poke', n: L.pokes })
    if (L.pokes === 1) line('silk_cat_poke')
    bat()
    if (L.pokes % 3 === 0) L.batQueue = t + 0.35
  }
  let batI = -1,
    batY0 = 0
  const BATV = num('batv', 4)
  const BATD = num('batd', 0.03)
  const BATR = num('batr', 0.22)
  /** the cat bats the curtain from behind: a paw-sized bump 0.12 m out where its shadow is */
  function bat() {
    audio.bat()
    L.paw = t + 0.3
    const Q = { x: CAT.x + 0.1, z: CAT.z + 0.24 }
    const x = cloth.x,
      p = cloth.p
    const Ls = pal().sun
    const h = 1 / 60 / SUB
    let batBest = 0
    for (let i = COLS; i < cloth.n; i++) {
      const k = i * 3
      if (cloth.w[i] === 0) continue
      // where this point's shadow falls on the window plane
      const tr = x[k + 1] / Math.max(-Ls[1], 0.05)
      const qx = x[k] + Ls[0] * tr,
        qz = x[k + 2] + Ls[2] * tr
      // a paw is small, but a bump in silk that hangs taut under its own weight spreads: 0.22 m across, 0.4 m
      // down; the air takes most of it, so it stands about 8 cm out (spec: 0.12 m within 0.07 m)
      const d = Math.hypot((qx - Q.x) / BATR, (qz - Q.z) / (BATR * 1.8))
      if (d > 1) continue
      const f = 1 - d * d
      if (f > batBest) {
        batBest = f
        batI = i
        batY0 = x[k + 1]
      }
      x[k + 1] += BATD * f
      p[k + 1] = x[k + 1] - BATV * f * h
    }
  }
  /** is this cloth point in front of the cat's shadow? */
  function onCat(i: number) {
    if (!L.catHere || openness() > 0.6) return false
    const x = cloth.x,
      k = i * 3
    const Ls = pal().sun
    const tr = x[k + 1] / Math.max(-Ls[1], 0.05)
    const qx = x[k] + Ls[0] * tr,
      qz = x[k + 2] + Ls[2] * tr
    return Math.abs(qx - CAT.x) < 0.13 && qz > CAT.z - 0.02 && qz < CAT.z + 0.4
  }

  let clothSpeed = 0
  function measure(dt: number) {
    const x = cloth.x,
      p = cloth.p
    const h = dt / SUB
    let sum = 0,
      m = 0
    for (let i = COLS; i < cloth.n; i += 7) {
      const k = i * 3
      sum += Math.hypot(x[k] - p[k], x[k + 1] - p[k + 1], x[k + 2] - p[k + 2]) / h
      m++
    }
    clothSpeed = sum / m
  }

  /** once per frame, after the step */
  function life(dt: number) {
    measure(dt)
    const x = cloth.x
    // the rings: a tick per 0.03 m of travel, a clack where they meet or hit the finial
    let allStacked = true
    for (let k = 1; k < NRING; k++) {
      const rx = x[ringCol[k] * 3]
      const d = rx - L.ringPrev[k]
      const sp = Math.abs(d) / Math.max(dt, 1e-3)
      if (hand.on && Math.abs(d) > 0) L.peakV = Math.max(L.peakV, sp)
      L.ringAcc[k] += Math.abs(d)
      if (L.ringAcc[k] >= 0.03) {
        L.ringAcc[k] = 0
        audio.ring(sp)
      }
      const gap = rx - x[ringCol[k - 1] * 3]
      const prevGap = L.ringPrev[k] - L.ringPrev[k - 1]
      if (gap <= RING_GAP_MIN + 0.001 && prevGap > RING_GAP_MIN + 0.004 && sp > 0.08) audio.clack()
      if (gap > RING_GAP_MIN + 0.002) allStacked = false
      // the curtain's edge passes the chime
      if (k === NRING - 1 && (L.ringPrev[k] - 0.4) * (rx - 0.4) < 0) audio.chime(1)
      L.ringPrev[k] = rx
    }
    if (allStacked && !L.stacked) audio.clack(true)
    L.stacked = allStacked
    // open and closed (spec 5.4)
    const last = x[ringCol[NRING - 1] * 3]
    if (L.state === 'closed' && last < -0.2) {
      L.state = 'open'
      onOpen()
    } else if (L.state === 'open' && last > 0.55) {
      L.state = 'closed'
      onClose()
    }
    // the ceremony: exposure +12% over 0.5 s, easing back to +6% (the open term), motes over 1 s
    const fe = t - L.floodT
    L.floodK = fe < 0.5 ? fe / 0.5 : Math.max(0, 1 - (fe - 0.5) / 1.5)
    L.moteK = L.state === 'open' ? Math.min(1, L.moteK + dt) : Math.max(0, L.moteK - dt)
    // the chime in a gust over 2 m/s
    if (chimeArmed && lastWb > 2) {
      chimeArmed = false
      audio.chime(rnd() < 0.5 ? 1 : 2)
    }
    // the cat: a tail flick every few seconds, the second bat, leaving and coming back
    if (t >= L.nextFlick) {
      L.flick = t + 0.45
      L.nextFlick = t + 3 + rnd() * 4
    }
    if (L.batQueue > 0 && t >= L.batQueue) {
      L.batQueue = -1
      bat()
    }
    if (!L.catHere) {
      L.catDx = Math.min(0.7, L.catDx + dt * 0.45)
      L.catDz = -0.04 * Math.sin(Math.min(1, L.catDx / 0.25) * Math.PI)
      L.catAlpha = Math.max(0, 1 - L.catDx / 0.6)
      if (t >= L.catBack && L.catBack > 0) {
        L.catHere = true
        L.catBack = -1
        L.catDx = 0
        L.catDz = 0
        L.catAlpha = 1
        track('cat', { act: 'back' })
      }
    }
    // the event under way
    const ev = L.ev
    L.catPose = 'cat'
    if (ev) {
      const e = t - ev.t0
      if (ev.v === 'cat') {
        // it turns its head, looks, and blinks slowly
        if (e > 0.4 && e < 4) L.catPose = e > 1.6 && e < 1.95 ? 'blink' : 'look'
      } else if (ev.v === 'neighbour') {
        L.neighK = e < 1.2 ? e / 1.2 : e < 2.0 ? 1 : Math.max(0, 1 - (e - 2.0) / 1.0)
        if (e >= 3.0 && L.neighShutAt < ev.t0) L.neighShutAt = t
      } else if (ev.v === 'sunset') {
        L.sunsetK = e < 3 ? e / 3 : e < 17 ? 1 : Math.max(0, 1 - (e - 17) / 3)
      }
      if (t >= ev.snapAt && ev.snapAt > 0) {
        ev.snapAt = -1
        L.snapWanted = true
      }
      const end = ev.v === 'sunset' ? 20 : ev.v === 'rain' ? 6 : 4
      if (e >= end) {
        L.ev = null
        L.neighK = 0
        L.sunsetK = 0
        L.firstEventDone = true
      }
    }
    if (L.rainUntil > 0) {
      rainK = t < L.rainUntil ? Math.min(1, rainK + dt / 2) : Math.max(0, rainK - dt / 2)
      if (rainK === 0 && t >= L.rainUntil) L.rainUntil = -1
    }
    // Mum and the sun: day, between 11 and 14, open for 20 s
    if (palId === 'day' && hour >= 11 && hour < 14 && L.state === 'open' && !L.sunMumSaid && L.sunMumAt < 0 && t - L.openAt > 20) {
      L.sunMumAt = t
      L.sunMumSaid = true
      line('silk_mum_sun', 'mum')
      track('mum', { stage: 'sun' })
    }
    if (L.pendingLine && t >= L.pendingLine.at) {
      const pl = L.pendingLine
      L.pendingLine = null
      line(pl.key, pl.mode, pl.vars)
    }
    // with no event yet: the snapshot is the peak of a gust
    if (!L.snap && !L.ev && lastWb > 2.3) L.snapWanted = true
    // the share slip, once: after the first event, 40 s here, and the finger up for 1.5 s
    if (!L.shared && L.playT >= 0 && L.firstEventDone && t - L.playT >= 40 && !hand.on && t - L.pointerUpAt >= 1.5 && !shot) {
      L.shared = true
      cb.onPeak('first', L.opens, peakData(), L.snap)
    }
    audio.frame(clothSpeed, lastWb, dt)
    audio.setBed(rainK > 0.3 ? 'rain' : pal().night ? 'night' : 'day', openness() < 0.1)
    audio.tickBed()
  }
  cb.onData(peakData, () => {
    render()
    return snapshot()
  })

  // ---------- harness ----------
  const harness: ToyHarness = {
    ready: false,
    degrade: 0,
    simMs: 0,
    inputToDrawMs: 0,
    shot,
    pal: palId,
    advance: async () => {},
    release: () => release(),
    poke: () => poke(),
    event: (v: View0) => startEvent(v),
    peak: () => {
      L.snapWanted = true
      requestAnimationFrame(() => requestAnimationFrame(() => cb.onPeak('first', Math.max(1, L.opens), peakData(), L.snap)))
    },
    rings: () => ringCol.map((c) => +cloth.x[c * 3].toFixed(4)),
    probe: () => {
      const x = cloth.x
      const mid = (12 * COLS + 28) * 3
      const hem = ((ROWS - 1) * COLS + 28) * 3
      let maxY = 0,
        nan = 0,
        stretch = 0
      for (let i = 0; i < cloth.n; i++) {
        if (!Number.isFinite(x[i * 3])) nan++
        maxY = Math.max(maxY, x[i * 3 + 1])
      }
      for (let c = 0; c < COLS; c++) {
        let L = 0
        for (let rr = 0; rr + 1 < ROWS; rr++) {
          const a = (rr * COLS + c) * 3,
            b = a + COLS * 3
          L += Math.hypot(x[a] - x[b], x[a + 1] - x[b + 1], x[a + 2] - x[b + 2])
        }
        stretch = Math.max(stretch, L / ((ROWS - 1) * DV) - 1)
      }
      return { opens: L.opens, view: L.view, isOpen: L.state === 'open' ? 1 : 0, pokes: L.pokes, puffs: L.puffs, drags: L.drags, batY: batI >= 0 ? x[batI * 3 + 1] - batY0 : 0, wb: lastWb, midX: x[mid], midY: x[mid + 1], midZ: x[mid + 2], hemX: x[hem], hemY: x[hem + 1], hemZ: x[hem + 2], maxY, nan, stretch, t }
    },
    view: () => view,
  }
  window.__toy = harness

  let raf = 0
  let disposed = false
  if (shot) {
    // deterministic: fixed steps, then hold the frame
    const DT = 1 / 60
    const run = (sec: number) => {
      const N = Math.round(sec / DT)
      for (let i = 0; i < N; i++) {
        step(DT)
        life(DT)
      }
    }
    if (openShot) {
      L.state = 'open'
      L.moteK = 1
    }
    L.nextFlick = 1e9
    run(2)
    if (shot === 'closed' || shot === 'night' || shot === 'open') {
      gust.next = 1e9
      run(4)
    } else if (shot === 'bat') {
      gust.next = 1e9
      run(4)
      poke()
      run(0.05)
    } else if (openShot) {
      gust.next = 1e9
      run(2)
      const v = shot === 'seen' ? 'cat' : (shot as View0)
      startEvent(v)
      run(v === 'cat' ? 1.0 : v === 'neighbour' ? 1.6 : v === 'rain' ? 4 : v === 'sunset' ? 6 : 1.2)
    } else if (shot === 'billow' || shot === 'floor' || shot === 'og') {
      gust.next = 1e9
      run(1)
      forceGust(t, 2.8)
      run(0.8 + 1.0)
    } else if (shot === 'drag' || shot === 'release') {
      gust.next = 1e9
      run(1)
      grab(12 * COLS + 28)
      const steps = 36
      for (let i = 1; i <= steps; i++) {
        const e = i / steps
        const k = e * e * (3 - 2 * e)
        moveHand(0.35 * k, -0.2 * k)
        step(DT)
      }
      run(1.2)
      if (shot === 'release') release()
    }
    harness.advance = (ms: number) =>
      new Promise((res) => {
        run(ms / 1000)
        requestAnimationFrame(() => {
          render()
          requestAnimationFrame(() => res())
        })
      })
    // a finger marker for the stills (the scripted hand has no finger of its own)
    const marker = shot === 'drag' ? document.createElement('div') : null
    if (marker) {
      marker.style.cssText =
        'position:fixed;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:radial-gradient(circle at 40% 35%,rgba(255,236,222,.75),rgba(230,190,170,.55) 60%,rgba(200,150,130,.35));box-shadow:0 6px 14px rgba(60,40,20,.25);pointer-events:none;z-index:5'
      document.body.append(marker)
    }
    const frame = () => {
      if (disposed) return
      render()
      if (marker && hand.on) {
        const k = hand.i * 3
        const [sx, sy] = project(view, cloth.x[k], cloth.x[k + 1], cloth.x[k + 2])
        marker.style.left = sx + 'px'
        marker.style.top = sy + 'px'
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(() => {
      frame()
      harness.ready = true
    })
  } else {
    // live: real time, the render loop drops to 30 fps with no pointer down
    run3s()
    let last = performance.now()
    let odd = false
    let frames = 0,
      acc = 0,
      slow = 0
    const frame = (now: number) => {
      if (disposed) return
      raf = requestAnimationFrame(frame)
      odd = !odd
      if (!hand.on && odd) return
      const dt = Math.min(1 / 30, (now - last) / 1000)
      last = now
      const t0 = performance.now()
      step(dt)
      harness.simMs = performance.now() - t0
      life(dt)
      render()
      if (pendingInput) {
        harness.inputToDrawMs = performance.now() - pendingInput
        pendingInput = 0
      }
      acc += dt * 1000
      if (++frames === 30) {
        if (acc / 30 > 20 && hand.on) slow++
        else slow = 0
        if (slow >= 2 && harness.degrade < 2) {
          harness.degrade++
          if (harness.degrade === 1) {
            dpr = Math.min(dpr, 1.5)
            r.resize(innerWidth, innerHeight, dpr, view)
          } else r.shadowDiv = 8
          slow = 0
        }
        frames = 0
        acc = 0
      }
    }
    raf = requestAnimationFrame(frame)
    harness.ready = true
  }
  function run3s() {
    gust.next = t + 6 + rnd() * 8
    for (let i = 0; i < 180; i++) step(1 / 60)
    L.ringPrev = ringCol.map((c) => cloth.x[c * 3])
  }

  // ---------- input: grab and drag; a tap beside the curtain is a puff; a tap on the cat's shadow, a poke ----------
  let pendingInput = 0
  let handVel = 0,
    lastMove = 0
  let first = true
  let down: { id: number; sx: number; sy: number; d: number; t: number; i: number; moved: boolean } | null = null
  const onDown = (e: PointerEvent) => {
    if (!q.has('mute')) audio.unlock()
    if (first) {
      first = false
      L.playT = t
      cb.onFirst()
    }
    if (down) return
    const x = cloth.x
    let best = -1,
      bd = 40 * 40
    for (let i = COLS; i < cloth.n; i++) {
      const [sx, sy] = project(view, x[i * 3], x[i * 3 + 1], x[i * 3 + 2])
      const d = (sx - e.clientX) ** 2 + (sy - e.clientY) ** 2
      if (d < bd) {
        bd = d
        best = i
      }
    }
    pendingInput = performance.now()
    if (best < 0) {
      // a puff of air where the tap meets the curtain's plane
      const d = CAM[1] - 0.15
      puff.x = CAM[0] + ((e.clientX - view.cx) * d) / view.f
      puff.z = CAM[2] - ((e.clientY - view.cy) * d) / view.f
      puff.until = t + 0.15
      L.puffs++
      act('puff')
      audio.puff()
      return
    }
    // in a gathered bunch the finger takes the bunch's leading edge (the last ring of the stack), so a pull
    // to the right draws the curtain closed rather than squeezing the rings ahead of it
    {
      let rk = lraRing[best]
      while (rk < NRING - 1 && x[ringCol[rk + 1] * 3] - x[ringCol[rk] * 3] < 0.03) rk++
      if (rk !== lraRing[best]) best = Math.floor(best / COLS) * COLS + ringCol[rk]
    }
    canvas.setPointerCapture?.(e.pointerId)
    const [, , dep] = project(view, x[best * 3], x[best * 3 + 1], x[best * 3 + 2])
    down = { id: e.pointerId, sx: e.clientX, sy: e.clientY, d: dep, t: performance.now(), i: best, moved: false }
    grab(best)
    prevHand = { x: hand.tx, y: hand.ty, z: hand.tz }
    audio.pinch()
  }
  const onMove = (e: PointerEvent) => {
    if (!down || e.pointerId !== down.id) return
    const k = down.d / view.f
    if (Math.hypot(e.clientX - down.sx, e.clientY - down.sy) > 8) down.moved = true
    const ox = hand.tx,
      oz = hand.tz,
      now = performance.now()
    moveHand((e.clientX - down.sx) * k, -(e.clientY - down.sy) * k)
    const dtm = Math.max(8, now - lastMove) / 1000
    handVel = 0.6 * handVel + 0.4 * (Math.hypot(hand.tx - ox, hand.tz - oz) / dtm)
    lastMove = now
  }
  const onUp = (e: PointerEvent) => {
    if (!down || e.pointerId !== down.id) return
    const dn = down
    down = null
    L.pointerUpAt = t
    const pulled = Math.hypot(hand.tx - hand.rx, hand.tz - hand.rz)
    const speed = performance.now() - lastMove < 80 ? handVel : 0
    release(dn.moved && pulled > 0.03)
    if (!dn.moved && performance.now() - dn.t < 350) {
      if (onCat(dn.i)) poke()
      return
    }
    L.drags++
    act('drag')
    audio.release(pulled)
    if (speed > 0.6) audio.swish(speed)
  }
  const onVis = () => {
    audio.suspend(document.hidden)
    if (document.hidden && L.drags + L.puffs > 0) track('session_silk', { sec: secNow(), opens: L.opens, drags: L.drags, puffs: L.puffs, pokes: L.pokes })
  }
  document.addEventListener('visibilitychange', onVis)
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)

  return {
    sec: secNow,
    dispose: () => {
      document.removeEventListener('visibilitychange', onVis)
      disposed = true
      cancelAnimationFrame(raf)
      removeEventListener('resize', resize)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
    },
  }
}
