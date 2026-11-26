// Mesh, normals and fold measures on the CPU, once per frame (README section 3.4).
// Per vertex: normal n (room side for a flat curtain), thread tangents Tu (across) and Tv (down),
// crease k (positive = valley) and bunching b (rest area over area projected on the window plane).


export function gridIndices(cols: number, rows: number): Uint16Array {
  const out = new Uint16Array((cols - 1) * (rows - 1) * 6)
  let o = 0
  for (let r = 0; r + 1 < rows; r++)
    for (let c = 0; c + 1 < cols; c++) {
      const a = r * cols + c,
        b = a + 1,
        d = a + cols,
        e = d + 1
      // counter-clockwise on screen when the room side faces the camera; diagonals alternate
      if ((c + r) & 1) {
        out[o++] = a
        out[o++] = d
        out[o++] = b
        out[o++] = b
        out[o++] = d
        out[o++] = e
      } else {
        out[o++] = a
        out[o++] = d
        out[o++] = e
        out[o++] = a
        out[o++] = e
        out[o++] = b
      }
    }
  return out
}

/** UVs: u across 0..1, v down 0..1 */
export function gridUV(cols: number, rows: number): Float32Array {
  const uv = new Float32Array(cols * rows * 2)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      uv[(r * cols + c) * 2] = c / (cols - 1)
      uv[(r * cols + c) * 2 + 1] = r / (rows - 1)
    }
  return uv
}

export class MeshAttribs {
  /** interleaved per vertex: n(3) Tu(3) Tv(3) k b = 11 floats */
  data: Float32Array
  private fn: Float32Array
  private area: Float32Array
  constructor(readonly cols: number, readonly rows: number) {
    this.data = new Float32Array(cols * rows * 11)
    this.fn = new Float32Array((cols - 1) * (rows - 1) * 3)
    this.area = new Float32Array((cols - 1) * (rows - 1))
  }

  update(x: Float32Array, du: number, dv: number) {
    const { cols, rows, data, fn, area } = this
    const restA = du * dv
    // per cell: normal (cross of the two diagonals: area-weighted) and the area projected on the window plane (xz)
    for (let r = 0; r + 1 < rows; r++)
      for (let c = 0; c + 1 < cols; c++) {
        const a = (r * cols + c) * 3,
          b = a + 3,
          d = a + cols * 3,
          e = d + 3
        // diag1 = x[e] - x[a], diag2 = x[b] - x[d]
        const ax = x[e] - x[a],
          ay = x[e + 1] - x[a + 1],
          az = x[e + 2] - x[a + 2]
        const bx = x[b] - x[d],
          by = x[b + 1] - x[d + 1],
          bz = x[b + 2] - x[d + 2]
        // u across (+x), v down (-z): n = (x_u) x (x_v) points to +y for a flat curtain.
        // diag a->e = u+v, diag d->b = u-v; (u+v) x (u-v) = -2 u x v, so negate
        const nx = -(ay * bz - az * by),
          ny = -(az * bx - ax * bz),
          nz = -(ax * by - ay * bx)
        const k = (r * (cols - 1) + c) * 3
        fn[k] = nx
        fn[k + 1] = ny
        fn[k + 2] = nz
        area[r * (cols - 1) + c] = Math.abs(ny) * 0.5
      }
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const v = r * cols + c
        let nx = 0,
          ny = 0,
          nz = 0,
          A = 0,
          cells = 0
        for (let dr = -1; dr <= 0; dr++)
          for (let dc = -1; dc <= 0; dc++) {
            const rr = r + dr,
              cc = c + dc
            if (rr < 0 || cc < 0 || rr >= rows - 1 || cc >= cols - 1) continue
            const k = rr * (cols - 1) + cc
            nx += fn[k * 3]
            ny += fn[k * 3 + 1]
            nz += fn[k * 3 + 2]
            A += area[k]
            cells++
          }
        const nl = Math.hypot(nx, ny, nz) || 1
        nx /= nl
        ny /= nl
        nz /= nl
        const o = v * 11
        data[o] = nx
        data[o + 1] = ny
        data[o + 2] = nz
        // tangents by central differences, two columns apart (the folds are wider than that; a one-column
        // stencil would pick up grid-scale wobble as zigzag shading)
        const cl0 = v - Math.min(2, c),
          cr0 = v + Math.min(2, cols - 1 - c)
        let tx = x[cr0 * 3] - x[cl0 * 3],
          ty = x[cr0 * 3 + 1] - x[cl0 * 3 + 1],
          tz = x[cr0 * 3 + 2] - x[cl0 * 3 + 2]
        let tl = Math.hypot(tx, ty, tz) || 1
        data[o + 3] = tx / tl
        data[o + 4] = ty / tl
        data[o + 5] = tz / tl
        const ru = r > 0 ? v - cols : v,
          rd = r < rows - 1 ? v + cols : v
        tx = x[rd * 3] - x[ru * 3]
        ty = x[rd * 3 + 1] - x[ru * 3 + 1]
        tz = x[rd * 3 + 2] - x[ru * 3 + 2]
        tl = Math.hypot(tx, ty, tz) || 1
        data[o + 6] = tx / tl
        data[o + 7] = ty / tl
        data[o + 8] = tz / tl
        // crease: mean of the neighbours across (folds run down the curtain) minus x, along n
        const i3 = v * 3
        const mx = (x[cl0 * 3] + x[cr0 * 3]) * 0.5 - x[i3],
          my = (x[cl0 * 3 + 1] + x[cr0 * 3 + 1]) * 0.5 - x[i3 + 1],
          mz = (x[cl0 * 3 + 2] + x[cr0 * 3 + 2]) * 0.5 - x[i3 + 2]
        const span = ((cr0 - cl0) / 2) * du
        const kk = cl0 === v || cr0 === v ? 0 : ((mx * nx + my * ny + mz * nz) / span) * 1.6
        data[o + 9] = Math.max(-1, Math.min(1, kk))
        const bb = cells ? (restA * cells) / Math.max(A, 1e-6) : 1
        data[o + 10] = Math.max(1, Math.min(4, bb))
      }
  }
}

/** The render mesh: the simulated grid refined ru x rv times with Catmull-Rom splines, so folds are smooth
 *  curves and a fold that runs across the rows has no staircase. */
export class Refiner {
  readonly cols: number
  readonly rows: number
  readonly pos: Float32Array
  private tmp: Float32Array
  constructor(readonly sc: number, readonly sr: number, readonly ru: number, readonly rv: number) {
    this.cols = (sc - 1) * ru + 1
    this.rows = (sr - 1) * rv + 1
    this.pos = new Float32Array(this.cols * this.rows * 3)
    this.tmp = new Float32Array(sc * this.rows * 3)
  }
  /** index of a simulated particle in the render mesh */
  at(c: number, r: number) {
    return r * this.rv * this.cols + c * this.ru
  }
  update(x: Float32Array) {
    const { sc, sr, ru, rv, cols, tmp, pos } = this
    // down each simulated column
    for (let c = 0; c < sc; c++)
      for (let r = 0; r < sr - 1; r++) {
        const i0 = (Math.max(0, r - 1) * sc + c) * 3,
          i1 = (r * sc + c) * 3,
          i2 = ((r + 1) * sc + c) * 3,
          i3 = (Math.min(sr - 1, r + 2) * sc + c) * 3
        for (let k = 0; k < rv; k++) {
          const t = k / rv,
            o = ((r * rv + k) * sc + c) * 3
          cr(x, i0, i1, i2, i3, t, tmp, o)
        }
      }
    for (let c = 0; c < sc; c++) {
      const o = (((sr - 1) * rv) * sc + c) * 3,
        i = ((sr - 1) * sc + c) * 3
      tmp[o] = x[i]
      tmp[o + 1] = x[i + 1]
      tmp[o + 2] = x[i + 2]
    }
    // across each refined row
    const R = this.rows
    for (let r = 0; r < R; r++)
      for (let c = 0; c < sc - 1; c++) {
        const b = r * sc
        const i0 = (b + Math.max(0, c - 1)) * 3,
          i1 = (b + c) * 3,
          i2 = (b + c + 1) * 3,
          i3 = (b + Math.min(sc - 1, c + 2)) * 3
        for (let k = 0; k < ru; k++) cr(tmp, i0, i1, i2, i3, k / ru, pos, (r * cols + c * ru + k) * 3)
        if (c === sc - 2) {
          const o = (r * cols + cols - 1) * 3
          pos[o] = tmp[i2]
          pos[o + 1] = tmp[i2 + 1]
          pos[o + 2] = tmp[i2 + 2]
        }
      }
  }
}

function cr(a: Float32Array, i0: number, i1: number, i2: number, i3: number, t: number, out: Float32Array, o: number) {
  const t2 = t * t,
    t3 = t2 * t
  const w0 = -0.5 * t3 + t2 - 0.5 * t,
    w1 = 1.5 * t3 - 2.5 * t2 + 1,
    w2 = -1.5 * t3 + 2 * t2 + 0.5 * t,
    w3 = 0.5 * t3 - 0.5 * t2
  out[o] = a[i0] * w0 + a[i1] * w1 + a[i2] * w2 + a[i3] * w3
  out[o + 1] = a[i0 + 1] * w0 + a[i1 + 1] * w1 + a[i2 + 1] * w2 + a[i3 + 1] * w3
  out[o + 2] = a[i0 + 2] * w0 + a[i1 + 2] * w1 + a[i2 + 2] * w2 + a[i3 + 2] * w3
}
