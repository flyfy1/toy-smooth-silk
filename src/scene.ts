// World, camera and palettes for Smooth as Silk (spec section 3). Metres. The wall is the plane y = 0,
// the room is y > 0 (toward the viewer), the floor is z = 0, x is to the right.

export type V3 = [number, number, number]

export const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

export const WIN = { x0: -0.55, x1: 0.55, z0: 0.75, z1: 2.05, bar: 0.04 }
export const SILL = { x0: -0.64, x1: 0.64, z: 0.75, depth: 0.1, thick: 0.03 }
export const RAIL = { y: 0.14, z: 2.25, x0: -0.72, x1: 0.72 }
/** the mask texture covers the window plane over this rectangle */
export const MASK = { x0: -0.8, x1: 0.8, z0: 0.6, z1: 2.4 }

export const CAM: V3 = [0, 3.4, 1.25]

/** Camera: straight on. The focal length is solved so the rail is W_r css px wide, and the principal
 *  point is shifted so the rail sits at 0.14 h (a lens shift; a centred frustum would put it at 0.22 h). */
export interface View {
  w: number
  h: number
  f: number
  cx: number
  cy: number
}
export function makeView(w: number, h: number): View {
  const wr = Math.min(0.9 * w, (0.6 * h * 1.44) / 2.15, 600)
  const dRail = CAM[1] - RAIL.y
  const f = (wr / 1.44) * dRail
  const cy = 0.14 * h + (f * (RAIL.z - CAM[2])) / dRail
  return { w, h, f, cx: w / 2, cy }
}

/** world to css px (and depth) */
export function project(v: View, x: number, y: number, z: number): [number, number, number] {
  const d = CAM[1] - y
  return [v.cx + (v.f * (x - CAM[0])) / d, v.cy - (v.f * (z - CAM[2])) / d, d]
}

/** column-major 4x4 for the shaders: world (x, y, z) to clip, with the lens shift */
export function viewProj(v: View, near = 0.3, far = 12): Float32Array {
  // camera space: right = x, up = z, depth d = CAM.y - y
  const sx = (2 * v.f) / v.w
  const sy = (2 * v.f) / v.h
  const ox = (2 * v.cx) / v.w - 1 // ndc of the principal point
  const oy = 1 - (2 * v.cy) / v.h
  const A = (far + near) / (far - near)
  const B = (-2 * far * near) / (far - near)
  // clip.x = sx*(x-cx) + ox*d ; clip.y = sy*(z-cz) + oy*d ; clip.z = A*d + B ; clip.w = d ; d = CAM.y - y
  const m = new Float32Array(16)
  // rows written as columns (column-major): m[col*4+row]
  // x column
  m[0] = sx
  m[1] = 0
  m[2] = 0
  m[3] = 0
  // y column (d = Cy - y, so d/dy = -1)
  m[4] = -ox
  m[5] = -oy
  m[6] = -A
  m[7] = -1
  // z column
  m[8] = 0
  m[9] = sy
  m[10] = 0
  m[11] = 0
  // translation
  m[12] = -sx * CAM[0] + ox * CAM[1]
  m[13] = -sy * CAM[2] + oy * CAM[1]
  m[14] = A * CAM[1] + B
  m[15] = CAM[1]
  return m
}

export type PalId = 'dawn' | 'day' | 'golden' | 'dusk' | 'night'

export interface Palette {
  id: PalId
  sky: [string, string]
  /** sun (or back light): direction surface to light, colour, strength */
  sun: V3
  sunCol: V3
  sunK: number
  /** the floor patch's own sun direction (see floorSun below) */
  floorSun: V3
  fill: V3
  fillCol: V3
  fillK: number
  /** multiplier on the wall and floor bakes */
  room: V3
  night: boolean
  /** the window shadow on the silk: blur distances (sharp to soft, soft to wide) and a cap on the wide blur */
  blur?: [number, number, number, number]
  /** the light through the silk, if not sunK (night: the city's glow behind the window) */
  silkSunK?: number
}

const hex = (h: string): V3 => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]

// The floor patch uses its own, steeper sun direction. With the spec's vectors the patch lands 1.1 to 3 m
// into the room (day) or 1.5 m and more (golden), below the bottom of a phone screen; the spec draws the
// patch as a fixed quad per palette anyway, so it is aimed where it can be seen. The silk keeps the spec's sun.
export const PALETTES: Record<PalId, Palette> = {
  dawn: {
    id: 'dawn',
    sky: ['#F7C9A8', '#BFD3E8'],
    sun: norm([-0.7, -0.65, 0.28]),
    sunCol: hex('#FFE2B0'),
    sunK: 0.7,
    floorSun: norm([-0.55, -0.6, 0.72]),
    fill: norm([-0.4, 0.6, 0.7]),
    fillCol: hex('#DCE6F5'),
    fillK: 0.25,
    room: [0.93, 0.92, 0.95],
    night: false,
  },
  day: {
    id: 'day',
    sky: ['#7FC4F0', '#D7EEFB'],
    sun: norm([-0.45, -0.75, 0.5]),
    sunCol: hex('#FFF3D6'),
    sunK: 1.0,
    floorSun: norm([-0.32, -0.55, 0.92]),
    fill: norm([-0.4, 0.6, 0.7]),
    fillCol: hex('#FFF8EE'),
    fillK: 0.35,
    room: [1, 1, 1],
    night: false,
    // the cat's shadow stays crisp a little further out (a bat bumps the silk 8 cm toward the room)
    blur: [0.28, 0.45, 0.75, 0.6],
  },
  golden: {
    id: 'golden',
    sky: ['#FFB56B', '#F7D9B0'],
    sun: norm([-0.72, -0.62, 0.3]),
    sunCol: hex('#FFB060'),
    sunK: 1.0,
    floorSun: norm([-0.5, -0.55, 0.85]),
    fill: norm([-0.4, 0.6, 0.7]),
    fillCol: hex('#FFE6CC'),
    fillK: 0.3,
    room: [1.02, 0.9, 0.78],
    night: false,
    // a low sun travels further to the silk: crisper edges, so the bars and the cat still read in a billow
    blur: [0.35, 0.6, 1.0, 0.3],
  },
  dusk: {
    id: 'dusk',
    sky: ['#5B5F97', '#F2A98A'],
    sun: norm([-0.6, -0.7, 0.35]),
    sunCol: hex('#E7A8D8'),
    sunK: 0.35,
    floorSun: norm([-0.45, -0.55, 0.8]),
    fill: norm([-0.4, 0.6, 0.7]),
    fillCol: hex('#FFD9A0'),
    fillK: 0.6,
    room: [0.78, 0.7, 0.72],
    night: false,
  },
  night: {
    id: 'night',
    sky: ['#0E1630', '#1F2A4D'],
    sun: norm([0.35, -0.8, 0.45]),
    sunCol: hex('#9FB4FF'),
    sunK: 0.12,
    floorSun: norm([0.3, -0.55, 0.85]),
    fill: norm([-0.4, 0.6, 0.7]),
    fillCol: hex('#FFD9A0'),
    fillK: 1.0,
    room: [0.62, 0.52, 0.5],
    night: true,
    silkSunK: 0.24,
    blur: [0.25, 0.4, 0.7, 0.4],
  },
}

export function paletteForHour(h: number): PalId {
  if (h >= 5 && h < 7) return 'dawn'
  if (h >= 7 && h < 16) return 'day'
  if (h >= 16 && h < 19) return 'golden'
  if (h >= 19 && h < 20) return 'dusk'
  return 'night'
}
