// Smooth as Silk, phase 1: the window, the curtain (cloth kit), the breeze, the rings, a scripted hand
// and the `?shot=` states for the stills gate. Harness: window.__toy (ready, degrade, simMs, ...).

import { Cloth } from './cloth/solver'
import { MeshAttribs, Refiner, gridIndices, gridUV } from './cloth/mesh'
import { Renderer } from './gl'
import { rng } from './paint'
import { PALETTES, RAIL, SILL, WIN, makeView, paletteForHour, project, type PalId, type Palette, type View } from './scene'

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
const W_B = 0.11

type Shot = 'closed' | 'billow' | 'drag' | 'open' | 'night' | 'floor' | 'release'

export interface GameApi {
  dispose: () => void
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

export function startGame(canvas: HTMLCanvasElement, onFirst: () => void, onNoGL: () => void): GameApi {
  const q = new URLSearchParams(location.search)
  const shot = (q.get('shot') || '') as Shot | ''
  const seed = Number(q.get('seed')) || 7
  const hourQ = q.get('hour')
  const hour = hourQ !== null && hourQ !== '' ? Number(hourQ) : new Date().getHours()
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  let palId: PalId = paletteForHour(hour)
  if (shot === 'billow' || shot === 'floor') palId = 'golden'
  else if (shot === 'night') palId = 'night'
  else if (shot) palId = 'day'
  if (q.get('pal') && q.get('pal')! in PALETTES) palId = q.get('pal') as PalId
  const pal = (): Palette => PALETTES[palId]

  const gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: false, premultipliedAlpha: true }) as WebGLRenderingContext | null
  if (!gl) {
    onNoGL()
    return { dispose: () => {} }
  }

  // ---------- the cloth ----------
  const num = (k: string, d: number) => (q.get(k) !== null ? Number(q.get(k)) : d)
  const SUB = num('S', S_SUB)
  const RING_LAG = num('lag', RING_LAG_D)
  const LRA_SLACK = num('lra', 1.04)
  const CAIR = num('air', C_AIR)
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
  seed2(shot === 'open' ? openRings : closedRings)
  remesh()

  // ---------- wind ----------
  const noise = makeNoise(seed)
  const rnd = rng(seed * 7 + 3)
  let t = 0
  const gust = { next: 6 + rnd() * 8, t0: -1, amp: 0, force: 0 }
  const baseWind = () => (pal().night ? 0.2 : 0.35)
  function gustW(): number {
    if (gust.t0 < 0 && t >= gust.next && !reduced) {
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
      gust.next = t + 6 + rnd() * 8
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
    let mx = dx,
      mz = dz
    const L = Math.hypot(mx, mz)
    if (L > 0.9) {
      mx *= 0.9 / L
      mz *= 0.9 / L
    }
    const tent = Math.min(0.35, 0.3 * Math.hypot(mx, mz))
    hand.tx = hand.rx + mx
    hand.tz = hand.rz + mz
    hand.ty = Math.max(0.03, hand.ry + 0.02 + tent)
  }
  function release() {
    for (const d of hand.driven) cloth.w[d.i] = cloth.w0[d.i]
    hand.on = false
    hand.driven = []
  }

  // ---------- the solver step ----------
  const n = cloth.n
  let flip = false
  let prevHand = { x: 0, y: 0, z: 0 }
  function step(dt: number) {
    const S = SUB
    const h = dt / S
    const x = cloth.x,
      p = cloth.p,
      w = cloth.w
    const nrm = mesh.data
    const wb = gustW()
    lastWb = wb
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
        if (near > 0) {
          const n1 = noise(px * 1.3 - tt * 0.7, pz * 0.8 + tt * 0.3) * 2 - 1
          const n2 = noise(px * 1.3 - tt * 0.7 + 17.3, pz * 0.8 + tt * 0.3 + 5.1)
          // the breeze's push grows faster than linearly with its speed (drag goes as v^2): a 0.35 m/s
          // breeze only stirs the silk, a 2.8 m/s gust stands it 0.25 to 0.5 m into the room
          const ws = wb * (0.6 + 0.4 * n2)
          const kw = W_A + W_B * ws
          Wx = 0.15 * n1 * near * kw
          Wy = ws * near * kw
        }
        const fi = fineAt[i] * 11
        const nx = nrm[fi],
          ny = nrm[fi + 1],
          nz = nrm[fi + 2]
        const rel = (Wx - vx) * nx + (Wy - vy) * ny + (0 - vz) * nz
        const a = CAIR * rel * h
        vx += a * nx
        vy += a * ny
        vz += a * nz
        const dm = 1 - C_DAMP * h
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
      // the heading: two rings are never further apart than the cloth between them (a pulled ring drags its neighbours)
      const GMAX = RING_EVERY * DU
      for (let r = NRING - 2; r >= 1; r--) {
        const k = ringCol[r] * 3,
          kn = ringCol[r + 1] * 3
        if (x[kn] - x[k] > GMAX) x[k] = x[kn] - GMAX
      }
      for (let r = 1; r < NRING; r++) {
        const k = ringCol[r] * 3,
          kp = ringCol[r - 1] * 3
        if (x[k] - x[kp] > GMAX) x[k] = x[kp] + GMAX
      }
      // order and spacing; nothing past the finials
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
    r.draw({ pal: pal(), open: openness(), rings, motes, debug: num('dbg', 0), transK: q.get('tk') ? Number(q.get('tk')) : undefined })
  }

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
      return { wb: lastWb, midX: x[mid], midY: x[mid + 1], midZ: x[mid + 2], hemX: x[hem], hemY: x[hem + 1], hemZ: x[hem + 2], maxY, nan, stretch, t }
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
      for (let i = 0; i < N; i++) step(DT)
    }
    run(2)
    if (shot === 'closed' || shot === 'night' || shot === 'open') {
      gust.next = 1e9
      run(4)
    } else if (shot === 'billow' || shot === 'floor') {
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
  }

  // ---------- input (phase 1: grab and drag; the puff and the cat come later) ----------
  let pendingInput = 0
  let first = true
  let down: { id: number; sx: number; sy: number; d: number } | null = null
  const onDown = (e: PointerEvent) => {
    if (first) {
      first = false
      onFirst()
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
    if (best < 0) return
    canvas.setPointerCapture?.(e.pointerId)
    const [, , dep] = project(view, x[best * 3], x[best * 3 + 1], x[best * 3 + 2])
    down = { id: e.pointerId, sx: e.clientX, sy: e.clientY, d: dep }
    grab(best)
    prevHand = { x: hand.tx, y: hand.ty, z: hand.tz }
    pendingInput = performance.now()
    navigator.vibrate?.(6)
  }
  const onMove = (e: PointerEvent) => {
    if (!down || e.pointerId !== down.id) return
    const k = down.d / view.f
    moveHand((e.clientX - down.sx) * k, -(e.clientY - down.sy) * k)
  }
  const onUp = (e: PointerEvent) => {
    if (!down || e.pointerId !== down.id) return
    down = null
    release()
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)

  return {
    dispose: () => {
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
