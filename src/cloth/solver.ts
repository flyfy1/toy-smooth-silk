// XPBD cloth with small steps (README section 3.1). State lives in typed arrays so it survives a lost
// GL context. Distance constraints only (structural, shear, bend), one pass per substep, alternating
// direction; softness is a multiple of (wi + wj) so the numbers do not depend on mass or step.

export interface ClothSpec {
  cols: number
  rows: number
  /** spacing across (u) and down (v), m */
  du: number
  dv: number
  shear: number
  bendU: number
  bendV: number
}

export class Cloth {
  readonly n: number
  readonly cols: number
  readonly rows: number
  readonly du: number
  readonly dv: number
  x: Float32Array
  p: Float32Array
  /** start-of-substep positions (for collision friction and the rings' rail friction) */
  s: Float32Array
  w: Float32Array
  /** rest inverse mass (driven particles get w = 0 while held) */
  w0: Float32Array
  // constraints: pairs, rest length, softness
  ci: Uint16Array
  cj: Uint16Array
  cl: Float32Array
  cr: Float32Array
  nc = 0

  constructor(spec: ClothSpec) {
    const { cols, rows, du, dv } = spec
    this.cols = cols
    this.rows = rows
    this.du = du
    this.dv = dv
    this.n = cols * rows
    this.x = new Float32Array(this.n * 3)
    this.p = new Float32Array(this.n * 3)
    this.s = new Float32Array(this.n * 3)
    this.w = new Float32Array(this.n).fill(1)
    this.w0 = new Float32Array(this.n).fill(1)
    const pairs: [number, number, number, number][] = []
    const id = (c: number, r: number) => r * cols + c
    const diag = Math.hypot(du, dv)
    // order: structural first (rows then columns), then shear, then bend
    for (let r = 0; r < rows; r++) for (let c = 0; c + 1 < cols; c++) pairs.push([id(c, r), id(c + 1, r), du, 0])
    for (let r = 0; r + 1 < rows; r++) for (let c = 0; c < cols; c++) pairs.push([id(c, r), id(c, r + 1), dv, 0])
    for (let r = 0; r + 1 < rows; r++)
      for (let c = 0; c + 1 < cols; c++) {
        pairs.push([id(c, r), id(c + 1, r + 1), diag, spec.shear])
        pairs.push([id(c + 1, r), id(c, r + 1), diag, spec.shear])
      }
    for (let r = 0; r < rows; r++) for (let c = 0; c + 2 < cols; c++) pairs.push([id(c, r), id(c + 2, r), 2 * du, spec.bendU])
    for (let r = 0; r + 2 < rows; r++) for (let c = 0; c < cols; c++) pairs.push([id(c, r), id(c, r + 2), 2 * dv, spec.bendV])
    this.nc = pairs.length
    this.ci = new Uint16Array(this.nc)
    this.cj = new Uint16Array(this.nc)
    this.cl = new Float32Array(this.nc)
    this.cr = new Float32Array(this.nc)
    pairs.forEach(([i, j, l, r], k) => {
      this.ci[k] = i
      this.cj[k] = j
      this.cl[k] = l
      this.cr[k] = r
    })
  }

  /** rest lengths of the bend constraints follow the current shape (so a seeded pleat is its rest shape) */
  relaxBend(amount: number) {
    const { x } = this
    for (let k = 0; k < this.nc; k++) {
      if (this.cr[k] < 1) continue
      const i = this.ci[k] * 3,
        j = this.cj[k] * 3
      const d = Math.hypot(x[i] - x[j], x[i + 1] - x[j + 1], x[i + 2] - x[j + 2])
      const full = this.cl[k]
      this.cl[k] = full + (d - full) * amount
    }
  }

  /** one pass over all constraints; `back` runs the list in reverse */
  solve(back: boolean) {
    const { x, w, ci, cj, cl, cr, nc } = this
    for (let q = 0; q < nc; q++) {
      const k = back ? nc - 1 - q : q
      const i = ci[k],
        j = cj[k]
      const wi = w[i],
        wj = w[j]
      const ws = wi + wj
      if (ws === 0) continue
      const a = i * 3,
        b = j * 3
      const dx = x[a] - x[b],
        dy = x[a + 1] - x[b + 1],
        dz = x[a + 2] - x[b + 2]
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (len < 1e-9) continue
      const C = len - cl[k]
      const s = -C / (ws * (1 + cr[k]) * len)
      const ox = dx * s,
        oy = dy * s,
        oz = dz * s
      x[a] += ox * wi
      x[a + 1] += oy * wi
      x[a + 2] += oz * wi
      x[b] -= ox * wj
      x[b + 1] -= oy * wj
      x[b + 2] -= oz * wj
    }
  }
}
