// WebGL 1 renderer for the window, the room and the silk. Hand-written, no dependencies.
// Programs: textured world quads (outside, wall, sill things, brass), the floor (sun patch through the
// window mask, the curtain's soft shadow), the silk (README 3.5 with the projected window mask, spec 3.5),
// the curtain's planar shadow into a quarter-resolution buffer, a 5-tap blur, and dust motes.

import { CAM, MASK, RAIL, SILL, viewProj, type Palette, type View } from './scene'
import { CHIMESPRITE, FLOOR, NEIGH, OUT, SILLSPRITE, WALL, WALLSIDE, maskPixels, paintNeighbour, paintBrass, paintChime, paintFloor, paintOutside, paintSillThings, paintWall, patternPixels } from './paint'
import type { PalId } from './scene'

const HEAD = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`

const QUAD_VS = `
attribute vec3 aP; attribute vec2 aT;
uniform mat4 uVP; uniform vec3 uOff; varying vec2 vT; varying vec3 vP;
void main(){ vT=aT; vP=aP+uOff; gl_Position=uVP*vec4(vP,1.); }`

const QUAD_FS = HEAD + `
uniform sampler2D uTex; uniform vec3 uTint; uniform float uAlpha; uniform float uMode; uniform vec4 uLamp; uniform vec2 uRain;
varying vec2 vT; varying vec3 vP;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
void main(){
  vec4 c;
  if(uMode>0.5){
    // the brass rod: a cylinder's shading across its width
    float v=vT.y*2.-1.;
    float nz=sqrt(max(1.-v*v,0.));
    vec3 b=mix(vec3(.36,.24,.08),vec3(.86,.66,.3),nz);
    b+=vec3(1.,.93,.7)*pow(max(0.,1.-abs(v+.45)*3.2),3.)*.8;
    c=vec4(b,1.);
  } else c=texture2D(uTex,vT);
  if(c.a<.02) discard;
  vec3 col=c.rgb*uTint;
  if(uRain.x>0.){
    // rain outside: grey it down, then thin slanted streaks falling (about 60 in view)
    col=mix(col,vec3(dot(col,vec3(.3,.5,.2)))*vec3(.82,.86,.92),.55*uRain.x)*(1.-.28*uRain.x);
    vec2 q=vec2(vT.x*60.+vT.y*6.,vT.y*3.+uRain.y*2.6);
    float lane=floor(q.x);
    float r1=hash(vec2(lane,3.1));
    float y=fract(q.y+r1*7.);
    float streak=smoothstep(.5,.0,abs(fract(q.x)-.5)*6.)*smoothstep(.0,.12,y)*smoothstep(.34,.12,y)*step(.35,r1);
    col=mix(col,vec3(.9,.93,.97),streak*.55*uRain.x);
  }
  float ld=distance(vP,uLamp.xyz);
  col*=mix(1.,.5+1.5/(1.+ld*ld*.9),uLamp.w);
  col+=(hash(gl_FragCoord.xy)-.5)/255.;
  gl_FragColor=vec4(col,c.a*uAlpha);
}`

const FLOOR_FS = HEAD + `
uniform sampler2D uTex; uniform sampler2D uMask; uniform sampler2D uShadow;
uniform vec3 uRoom; uniform vec4 uLamp; uniform vec3 uFS; uniform vec3 uSunCol; uniform float uSunK; uniform float uPatch;
uniform vec2 uRes; uniform vec4 uMaskR;
varying vec2 vT; varying vec3 vP;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
void main(){
  vec3 base=texture2D(uTex,vT).rgb;
  // room light: darker right against the wall and at the far sides
  float ao=.72+.28*smoothstep(0.,.5,vP.y);
  ao*=1.-.18*smoothstep(.6,1.6,abs(vP.x));
  float ld=distance(vP,uLamp.xyz);
  vec3 col=base*uRoom*ao*mix(1.,.5+1.5/(1.+ld*ld*.9),uLamp.w);
  // the sun patch: trace back along the sun to the window plane
  float s=vP.y/max(-uFS.y,.05);
  vec3 Q=vP+uFS*s;
  vec2 mu=vec2((Q.x-uMaskR.x)*uMaskR.z,1.-(Q.z-uMaskR.y)*uMaskR.w);
  vec3 m=texture2D(uMask,mu).rgb;
  float inR=step(0.,mu.x)*step(mu.x,1.)*step(0.,mu.y)*step(mu.y,1.);
  // the sun's own size: a penumbra of about 1 cm per metre travelled
  float mk=mix(m.r,m.g,smoothstep(.3,1.3,s))*inR;
  float o=texture2D(uShadow,gl_FragCoord.xy/uRes).r;
  vec3 through=mix(vec3(1.),vec3(.913,.788,.627),o)*(1.-.3*o);
  col+=base*uSunCol*uSunK*uPatch*mk*through*1.15;
  col+=(hash(gl_FragCoord.xy)-.5)/255.;
  gl_FragColor=vec4(col,1.);
}`

const CLOTH_VS = `
attribute vec3 aP; attribute vec2 aT; attribute vec3 aN; attribute vec3 aU; attribute vec3 aV; attribute vec2 aKB;
uniform mat4 uVP;
varying vec3 vP; varying vec2 vT; varying vec3 vN; varying vec3 vU; varying vec3 vV; varying vec2 vKB;
void main(){ vP=aP; vT=aT; vN=aN; vU=aU; vV=aV; vKB=aKB; gl_Position=uVP*vec4(aP,1.); }`

const CLOTH_FS = HEAD + `
uniform sampler2D uPat; uniform sampler2D uMask;
uniform vec3 uCam; uniform vec3 uLs; uniform vec3 uLf; uniform vec3 uSunCol; uniform vec3 uFillCol;
uniform float uSunK; uniform float uFillK; uniform float uTransK; uniform vec4 uMaskR; uniform vec4 uBlurD; uniform float uDebug;
varying vec3 vP; varying vec2 vT; varying vec3 vN; varying vec3 vU; varying vec3 vV; varying vec2 vKB;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float shoulder(float x){ return x<.82?x:.82+.18*(1.-exp(-(x-.82)/.18)); }
void main(){
  vec4 pat=texture2D(uPat,vT);
  vec3 base=pat.rgb;
  float sm=pat.a*2.2;
  float stripe=clamp((sm-1.)/1.2,0.,1.);
  float hem=step(1.-.06/2.15,vT.y)+step(vT.y,.04/2.15);
  float side=step(vT.x,.006)+step(.994,vT.x);
  float layers=vKB.y+hem+side*.6;
  vec3 V=normalize(uCam-vP);
  vec3 n=normalize(vN);
  // which side faces us, from the smooth normal rather than each triangle's winding: where the silk turns
  // edge-on, neighbouring triangles flip back and forth and would shade as a sawtooth
  float facing=dot(n,V)>=0.?1.:-1.;
  vec3 N=n*facing;
  // wrapped diffuse from the room fill
  float d=clamp((dot(N,uLf)+.4)/1.4,0.,1.);
  vec3 shade=base*base*.55;
  vec3 col=mix(shade,base,d)*uFillCol*(.72+.6*min(uFillK,.5));
  // thread sheen (plain weave, stronger on the satin stripes), lining side a quarter
  vec3 H=normalize(uLf+V);
  float tu=dot(normalize(vU),H), tv=dot(normalize(vV),H);
  float su=pow(sqrt(max(1.-tu*tu,0.)),14.);
  float sv=pow(sqrt(max(1.-tv*tv,0.)),22.);
  float sheen=(.16*su+.22*sv)*sm*d*(facing>0.?1.:.7);
  col+=sheen*mix(uFillCol,vec3(1.,.98,.94),.5)*(.55+.9*uFillK);
  // soft edge sheen where the cloth turns away
  float rim=pow(1.-clamp(dot(N,V),0.,1.),4.)*.30;
  col+=rim*mix(base,vec3(1.),.5)*(.45+.55*uFillK);
  // light through: the sun behind, the window's shadow projected along it onto the silk
  float travel=vP.y/max(-uLs.y,.05);
  vec3 Q=vP+uLs*travel;
  vec2 mu=vec2((Q.x-uMaskR.x)*uMaskR.z,1.-(Q.z-uMaskR.y)*uMaskR.w);
  vec3 m=texture2D(uMask,mu).rgb;
  float inR=step(0.,mu.x)*step(mu.x,1.)*step(0.,mu.y)*step(mu.y,1.);
  // sharp near the glass, softer further out; the wide blur is capped (uBlurD.w) so a billow keeps its shadows
  float mk=mix(mix(m.r,m.g,smoothstep(uBlurD.x,uBlurD.y,travel)),m.b,min(uBlurD.w,smoothstep(uBlurD.y,uBlurD.z,travel)))*inR;
  float t=.85*clamp(dot(-N,uLs),0.,1.)*exp(-.9*(layers-1.));
  vec3 trans=vec3(1.,.945,.84)*uSunCol*uSunK*t*mk*mix(vec3(1.),base,.6)*(1.-.15*stripe);
  col+=trans*uTransK;
  // folds: dark valleys, light ridges
  col*=1.-.35*max(vKB.x,0.);
  col+=.06*max(-vKB.x,0.);
  col=vec3(shoulder(col.r),shoulder(col.g),shoulder(col.b))*vec3(1.,.985,.95);
  col+=(hash(gl_FragCoord.xy)-.5)/255.;
  float a=.78+.22*min(1.,layers-1.);
  a=1.-(1.-a)*(1.-.15*stripe);
  // veiling: where the silk glows, its own scattered light drowns most of what is behind it
  a+=(1.-a)*.6*clamp(dot(trans*uTransK,vec3(.3,.5,.2)),0.,1.);
  // skylight from the whole window glows in the silk even inside a shadow: it veils the view there too
  a+=(1.-a)*.45*m.b*inR*uSunK;
  // seen at a grazing angle, light crosses more silk: a fold's turning edge is nearly opaque
  a=1.-pow(1.-a,1./max(abs(dot(n,V)),.25));
  if(uDebug>.5) { a=1.; col=uDebug<1.5?vec3(mk):uDebug<2.5?vec3(.5+.5*vKB.x):uDebug<3.5?vec3((vKB.y-1.)/1.5):N*.5+.5; }
  gl_FragColor=vec4(col,a);
}`

const SHADOW_VS = `
attribute vec3 aP; uniform mat4 uVP; uniform vec3 uFS;
void main(){ vec3 F=aP-uFS*(aP.z/uFS.z); F.z=0.; gl_Position=uVP*vec4(F,1.); }`
const SHADOW_FS = HEAD + `void main(){ gl_FragColor=vec4(.45); }`

const BLUR_VS = `attribute vec2 aQ; varying vec2 vT; void main(){ vT=aQ*.5+.5; gl_Position=vec4(aQ,0.,1.); }`
const BLUR_FS = HEAD + `
uniform sampler2D uTex; uniform vec2 uDir; varying vec2 vT;
void main(){
  vec4 c=texture2D(uTex,vT)*.375;
  c+=texture2D(uTex,vT+uDir)*.25; c+=texture2D(uTex,vT-uDir)*.25;
  c+=texture2D(uTex,vT+uDir*2.)*.0625; c+=texture2D(uTex,vT-uDir*2.)*.0625;
  gl_FragColor=c;
}`

const MOTE_VS = `
attribute vec4 aM; uniform mat4 uVP; uniform float uPx; varying float vA;
void main(){ gl_Position=uVP*vec4(aM.xyz,1.); gl_PointSize=uPx*(.6+aM.w)/gl_Position.w; vA=aM.w; }`
const MOTE_FS = HEAD + `
uniform vec3 uCol; uniform float uK; varying float vA;
void main(){ vec2 p=gl_PointCoord*2.-1.; float r=dot(p,p); if(r>1.) discard; gl_FragColor=vec4(uCol*(1.-r)*(1.-r)*uK*(.4+vA),1.); }`

type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null>; a: Record<string, number> }

export interface ClothGeo {
  pos: Float32Array
  attr: Float32Array
  uv: Float32Array
  idx: Uint16Array
}

export interface FrameState {
  pal: Palette
  /** 0..1 how open the curtain is (drives the patch and the motes) */
  open: number
  rings: number[]
  motes: Float32Array | null
  debug?: number
  transK?: number
  /** the cat's sprite: pose, fade, and how far it has walked along the sill */
  cat?: { pose: 'cat' | 'look' | 'blink'; alpha: number; dx: number; dz: number }
  /** the neighbour's curtain opposite, 0 shut to 1 open */
  neigh?: number
  /** rain outside 0..1 and the clock for its streaks */
  rain?: number
  time?: number
  /** the view's colour (rain greys it, a sunset deepens it) and the room's exposure */
  outTint?: [number, number, number]
  expo?: number
  moteK?: number
}

export class Renderer {
  gl: WebGLRenderingContext
  private progs!: Record<'quad' | 'floor' | 'cloth' | 'shadow' | 'blur' | 'mote', Prog>
  private tex: Record<string, WebGLTexture> = {}
  private outside: Partial<Record<PalId, WebGLTexture>> = {}
  private sillTex: Partial<Record<PalId, WebGLTexture>> = {}
  private catTex: Partial<Record<string, WebGLTexture>> = {}
  private maskKey = '0,0,1'
  private maskCache: Record<string, Uint8Array> = {}
  private neighK = -1
  private bufs: Record<string, WebGLBuffer> = {}
  private quads: Record<string, { buf: WebGLBuffer; tex: string }> = {}
  private fb: { f: WebGLFramebuffer; t: WebGLTexture }[] = []
  private fbW = 0
  private fbH = 0
  private nIdx = 0
  private sorted = new Uint16Array(0)
  private key = new Uint16Array(0)
  private count = new Uint32Array(257)

  /** bucket sort of the triangles by distance from the camera (y of the centroid), far first */
  private sortTris(): Uint16Array {
    const { idx, pos } = this.geo
    const nt = idx.length / 3
    const B = 256
    const key = this.key,
      count = this.count
    count.fill(0)
    for (let t = 0; t < nt; t++) {
      const a = idx[t * 3] * 3 + 1,
        b = idx[t * 3 + 1] * 3 + 1,
        c = idx[t * 3 + 2] * 3 + 1
      const y = (pos[a] + pos[b] + pos[c]) / 3
      // y from 0 (wall) to about 1 m into the room
      const k = Math.max(0, Math.min(B - 1, Math.floor(y * (B / 1.0))))
      key[t] = k
      count[k + 1]++
    }
    for (let k = 0; k < B; k++) count[k + 1] += count[k]
    const out = this.sorted
    for (let t = 0; t < nt; t++) {
      const o = count[key[t]]++ * 3
      out[o] = idx[t * 3]
      out[o + 1] = idx[t * 3 + 1]
      out[o + 2] = idx[t * 3 + 2]
    }
    return out
  }
  view!: View
  dpr = 1
  shadowDiv = 4

  constructor(
    readonly canvas: HTMLCanvasElement,
    gl: WebGLRenderingContext,
    private geo: ClothGeo,
  ) {
    this.gl = gl
    this.build()
  }

  /** (re)build everything: programs, buffers, textures. Called again after a lost context. */
  build() {
    const gl = this.gl
    this.outside = {}
    this.sillTex = {}
    this.catTex = {}
    const mk = (vs: string, fs: string): Prog => {
      const sh = (type: number, src: string) => {
        const s = gl.createShader(type)!
        gl.shaderSource(s, src)
        gl.compileShader(s)
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s) || 'shader')
        return s
      }
      const p = gl.createProgram()!
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vs))
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs))
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p) || 'link')
      const u: Prog['u'] = {}
      const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number
      for (let i = 0; i < nu; i++) {
        const info = gl.getActiveUniform(p, i)!
        u[info.name] = gl.getUniformLocation(p, info.name)
      }
      const a: Prog['a'] = {}
      const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES) as number
      for (let i = 0; i < na; i++) {
        const info = gl.getActiveAttrib(p, i)!
        a[info.name] = gl.getAttribLocation(p, info.name)
      }
      return { p, u, a }
    }
    this.progs = {
      quad: mk(QUAD_VS, QUAD_FS),
      floor: mk(QUAD_VS, FLOOR_FS),
      cloth: mk(CLOTH_VS, CLOTH_FS),
      shadow: mk(SHADOW_VS, SHADOW_FS),
      blur: mk(BLUR_VS, BLUR_FS),
      mote: mk(MOTE_VS, MOTE_FS),
    }
    const g = this.geo
    this.bufs.pos = this.buffer(g.pos, gl.DYNAMIC_DRAW)
    this.bufs.attr = this.buffer(g.attr, gl.DYNAMIC_DRAW)
    this.bufs.uv = this.buffer(g.uv, gl.STATIC_DRAW)
    const ib = gl.createBuffer()!
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.idx, gl.STATIC_DRAW)
    this.bufs.idx = ib
    this.nIdx = g.idx.length
    const sb = gl.createBuffer()!
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sb)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.idx, gl.DYNAMIC_DRAW)
    this.bufs.sorted = sb
    this.sorted = new Uint16Array(g.idx.length)
    this.key = new Uint16Array(g.idx.length / 3)
    this.bufs.full = this.buffer(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    this.bufs.motes = this.buffer(new Float32Array(40 * 4), gl.DYNAMIC_DRAW)
    this.bufs.quad = gl.createBuffer()!
    // textures
    this.tex.pat = this.texRaw(patternPixels(), 512, 512, true, true)
    this.tex.mask = this.texRaw(this.maskPx(this.maskKey), 256, 256, false, false)
    this.tex.neigh = this.texRaw(new Uint8Array([0, 0, 0, 0]), 1, 1, false, false)
    this.neighK = -1
    this.tex.wall = this.texCanvas(paintWall(), true)
    this.tex.wallSide = this.texCanvas(paintWall(true), true)
    this.tex.floor = this.texCanvas(paintFloor(), true)
    this.tex.chime = this.texCanvas(paintChime(), false)
    this.tex.brass = this.texCanvas(paintBrass(), false)
    this.tex.white = this.texRaw(new Uint8Array([255, 255, 255, 255]), 1, 1, false, false)
    // static world quads (x0, z0, x1, z1 on a plane)
    const wq = (name: string, tex: string, pts: number[]) => {
      this.quads[name] = { buf: this.buffer(new Float32Array(pts), gl.STATIC_DRAW), tex }
    }
    const vquad = (x0: number, x1: number, y: number, z0: number, z1: number) => [x0, y, z0, 0, 1, x1, y, z0, 1, 1, x0, y, z1, 0, 0, x1, y, z1, 1, 0]
    wq('out', 'out', vquad(OUT.x0, OUT.x1, OUT.y, OUT.z0, OUT.z1))
    wq('wallSide', 'wallSide', vquad(WALLSIDE.x0, WALLSIDE.x1, -0.003, WALLSIDE.z0, WALLSIDE.z1))
    wq('wall', 'wall', vquad(WALL.x0, WALL.x1, 0, WALL.z0, WALL.z1))
    wq('floor', 'floor', [FLOOR.x0, FLOOR.y0, 0, 0, 0, FLOOR.x1, FLOOR.y0, 0, 1, 0, FLOOR.x0, FLOOR.y1, 0, 0, 1, FLOOR.x1, FLOOR.y1, 0, 1, 1])
    const sz = SILL.z,
      sd = SILL.depth
    wq('sillTop', 'white', [SILL.x0, sd, sz, 0, 0, SILL.x1, sd, sz, 1, 0, SILL.x0, 0, sz, 0, 1, SILL.x1, 0, sz, 1, 1])
    wq('sillFront', 'white', vquad(SILL.x0, SILL.x1, sd, sz - SILL.thick, sz))
    wq('sillThings', 'sill', vquad(SILLSPRITE.x0, SILLSPRITE.x1, 0.05, SILLSPRITE.z0, SILLSPRITE.z1))
    wq('cat', 'cat', vquad(SILLSPRITE.x0, SILLSPRITE.x1, 0.051, SILLSPRITE.z0, SILLSPRITE.z1))
    wq('neigh', 'neigh', vquad(NEIGH.x0, NEIGH.x1, OUT.y + 0.002, NEIGH.z0, NEIGH.z1))
    wq('chime', 'chime', vquad(CHIMESPRITE.x0, CHIMESPRITE.x1, 0.04, CHIMESPRITE.z0, CHIMESPRITE.z1))
    wq('rail', 'white', vquad(RAIL.x0, RAIL.x1, RAIL.y + 0.012, RAIL.z - 0.011, RAIL.z + 0.011))
    this.fb = []
    this.fbW = 0
  }

  private buffer(data: Float32Array, usage: number) {
    const gl = this.gl
    const b = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, b)
    gl.bufferData(gl.ARRAY_BUFFER, data, usage)
    return b
  }
  private texRaw(px: Uint8Array, w: number, h: number, mip: boolean, repeat: boolean) {
    const gl = this.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, px)
    this.texParams(mip, repeat)
    return t
  }
  private texCanvas(c: HTMLCanvasElement, mip: boolean) {
    const gl = this.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c)
    const pot = (n: number) => (n & (n - 1)) === 0
    this.texParams(mip && pot(c.width) && pot(c.height), false)
    return t
  }
  private texParams(mip: boolean, repeat: boolean) {
    const gl = this.gl
    // WebGL 1: mipmaps only for power-of-two sizes
    if (mip) {
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap)
  }

  private maskPx(key: string) {
    if (!this.maskCache[key]) {
      const [paw, flick, cat] = key.split(',').map(Number)
      this.maskCache[key] = maskPixels(paw, flick, !!cat)
    }
    return this.maskCache[key]
  }
  /** the mask again (the cat raised a paw, flicked its tail, left or came back); variants are cached */
  setMask(paw: number, flick: number, cat: boolean) {
    const key = `${paw},${flick},${cat ? 1 : 0}`
    if (key === this.maskKey) return
    this.maskKey = key
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.tex.mask)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.maskPx(key))
  }
  /** the neighbour's curtain opposite, 0 shut to 1 open (repainted only when it moves) */
  private setNeigh(pal: Palette, k: number) {
    const q = Math.round(k * 40) / 40
    if (q === this.neighK) return
    this.neighK = q
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.tex.neigh)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paintNeighbour(pal, q))
    this.texParams(false, false)
  }

  resize(w: number, h: number, dpr: number, view: View) {
    this.view = view
    this.dpr = dpr
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
  }

  private ensureFb() {
    const gl = this.gl
    const W = Math.max(1, Math.round(this.canvas.width / this.shadowDiv)),
      H = Math.max(1, Math.round(this.canvas.height / this.shadowDiv))
    if (W === this.fbW && H === this.fbH && this.fb.length) return
    this.fbW = W
    this.fbH = H
    this.fb = [0, 1].map(() => {
      const t = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      this.texParams(false, false)
      const f = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, f)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0)
      return { f, t }
    })
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  /** repaint the view outside next frame (the sock arrived) */
  dropOutside() {
    for (const k in this.outside) this.gl.deleteTexture(this.outside[k as PalId]!)
    this.outside = {}
  }
  private palTex(pal: Palette) {
    if (!this.outside[pal.id]) this.outside[pal.id] = this.texCanvas(paintOutside(pal), true)
    if (!this.sillTex[pal.id]) this.sillTex[pal.id] = this.texCanvas(paintSillThings(pal, 'pot'), true)
    return { out: this.outside[pal.id]!, sill: this.sillTex[pal.id]! }
  }
  private catSprite(pal: Palette, pose: 'cat' | 'look' | 'blink') {
    const k = pal.id + pose
    if (!this.catTex[k]) this.catTex[k] = this.texCanvas(paintSillThings(pal, pose), true)
    return this.catTex[k]!
  }

  private bindQuadAttribs(p: Prog, buf: WebGLBuffer) {
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.enableVertexAttribArray(p.a.aP)
    gl.vertexAttribPointer(p.a.aP, 3, gl.FLOAT, false, 20, 0)
    if (p.a.aT !== undefined && p.a.aT >= 0) {
      gl.enableVertexAttribArray(p.a.aT)
      gl.vertexAttribPointer(p.a.aT, 2, gl.FLOAT, false, 20, 12)
    }
  }

  private disableAll() {
    const gl = this.gl
    for (let i = 0; i < 8; i++) gl.disableVertexAttribArray(i)
  }

  draw(s: FrameState) {
    const gl = this.gl
    if (gl.isContextLost()) return
    const pal = s.pal
    const vp = viewProj(this.view)
    const { out, sill } = this.palTex(pal)
    const cat = this.catSprite(pal, s.cat?.pose ?? 'cat')
    const tx = { ...this.tex, out, sill, cat } as Record<string, WebGLTexture>
    if (s.neigh !== undefined && s.neigh > 0) this.setNeigh(pal, s.neigh)
    const room = pal.room
    const lamp = pal.night ? pal.fillCol.map((v) => 0.55 * v + 0.45) : [1, 1, 1]
    const rl = (k: number): [number, number, number] => [room[0] * lamp[0] * k, room[1] * lamp[1] * k, room[2] * lamp[2] * k]
    const g = this.geo
    // upload the cloth
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs.pos)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, g.pos)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs.attr)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, g.attr)

    // 1. the curtain's shadow on the floor, quarter resolution, blurred twice
    this.ensureFb()
    {
      const p = this.progs.shadow
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb[0].f)
      gl.viewport(0, 0, this.fbW, this.fbH)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.CULL_FACE)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.useProgram(p.p)
      gl.uniformMatrix4fv(p.u.uVP, false, vp)
      gl.uniform3fv(p.u.uFS, pal.floorSun)
      this.disableAll()
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs.pos)
      gl.enableVertexAttribArray(p.a.aP)
      gl.vertexAttribPointer(p.a.aP, 3, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.bufs.idx)
      gl.drawElements(gl.TRIANGLES, this.nIdx, gl.UNSIGNED_SHORT, 0)
      gl.disable(gl.BLEND)
      const b = this.progs.blur
      gl.useProgram(b.p)
      this.disableAll()
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs.full)
      gl.enableVertexAttribArray(b.a.aQ)
      gl.vertexAttribPointer(b.a.aQ, 2, gl.FLOAT, false, 0, 0)
      gl.uniform1i(b.u.uTex, 0)
      gl.activeTexture(gl.TEXTURE0)
      const passes = this.shadowDiv > 4 ? 1 : 2
      const spread = 2.2 / this.shadowDiv * 4
      for (let i = 0; i < passes; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb[1].f)
        gl.bindTexture(gl.TEXTURE_2D, this.fb[0].t)
        gl.uniform2f(b.u.uDir, spread / this.fbW, 0)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb[0].f)
        gl.bindTexture(gl.TEXTURE_2D, this.fb[1].t)
        gl.uniform2f(b.u.uDir, 0, spread / this.fbH)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    }

    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(0.1, 0.08, 0.06, 1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.depthMask(true)
    gl.disable(gl.CULL_FACE)

    // 2. the room
    const q = this.progs.quad
    gl.useProgram(q.p)
    gl.uniformMatrix4fv(q.u.uVP, false, vp)
    gl.uniform1i(q.u.uTex, 0)
    gl.uniform4f(q.u.uLamp, -0.95, 1.1, 1.85, pal.night ? 1 : 0)
    gl.activeTexture(gl.TEXTURE0)
    const quad = (name: string, tint: readonly number[], alpha = 1, mode = 0) => {
      const o = this.quads[name]
      this.disableAll()
      this.bindQuadAttribs(q, o.buf)
      gl.bindTexture(gl.TEXTURE_2D, tx[o.tex])
      gl.uniform3f(q.u.uTint, tint[0], tint[1], tint[2])
      gl.uniform1f(q.u.uAlpha, alpha)
      gl.uniform1f(q.u.uMode, mode)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    const expo = (1 + 0.06 * s.open) * (s.expo ?? 1)
    gl.uniform3f(q.u.uOff, 0, 0, 0)
    gl.uniform2f(q.u.uRain, s.rain ?? 0, s.time ?? 0)
    const ot = s.outTint ?? [1, 1, 1]
    quad('out', [expo * ot[0], expo * ot[1], expo * ot[2]])
    gl.uniform2f(q.u.uRain, 0, 0)
    if (s.neigh !== undefined && s.neigh > 0) quad('neigh', [expo * ot[0], expo * ot[1], expo * ot[2]])
    quad('wallSide', rl(0.93 * expo))
    quad('wall', rl(0.93 * expo))
    // the floor
    {
      const f = this.progs.floor
      gl.useProgram(f.p)
      gl.uniformMatrix4fv(f.u.uVP, false, vp)
      this.disableAll()
      this.bindQuadAttribs(f, this.quads.floor.buf)
      gl.uniform1i(f.u.uTex, 0)
      gl.uniform1i(f.u.uMask, 1)
      gl.uniform1i(f.u.uShadow, 2)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, tx.floor)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, tx.mask)
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, this.fb[0].t)
      gl.activeTexture(gl.TEXTURE0)
      gl.uniform3fv(f.u.uRoom, rl(0.86 * expo))
      gl.uniform4f(f.u.uLamp, -0.95, 1.1, 1.85, pal.night ? 1 : 0)
      gl.uniform3fv(f.u.uFS, pal.floorSun)
      gl.uniform3fv(f.u.uSunCol, pal.sunCol)
      gl.uniform1f(f.u.uSunK, pal.sunK)
      gl.uniform1f(f.u.uPatch, 0.5 + 0.5 * s.open)
      gl.uniform2f(f.u.uRes, this.canvas.width, this.canvas.height)
      gl.uniform4f(f.u.uMaskR, MASK.x0, MASK.z0, 1 / (MASK.x1 - MASK.x0), 1 / (MASK.z1 - MASK.z0))
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      gl.useProgram(q.p)
    }
    quad('sillTop', pal.night ? rl(0.62) : [0.86 * room[0], 0.9 * room[1], 0.82 * room[2]])
    quad('sillFront', pal.night ? rl(0.5) : [0.62 * room[0], 0.7 * room[1], 0.6 * room[2]])
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.depthMask(false)
    quad('sillThings', [1, 1, 1])
    const ca = Math.min(1, s.open * 1.5) * (s.cat?.alpha ?? 1)
    if (ca > 0.02) {
      gl.uniform3f(q.u.uOff, s.cat?.dx ?? 0, 0, s.cat?.dz ?? 0)
      quad('cat', [1, 1, 1], ca)
      gl.uniform3f(q.u.uOff, 0, 0, 0)
    }
    quad('chime', [1, 1, 1])

    // 3. the silk: lining side first, then the room side
    {
      const c = this.progs.cloth
      gl.useProgram(c.p)
      gl.uniformMatrix4fv(c.u.uVP, false, vp)
      this.disableAll()
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs.pos)
      gl.enableVertexAttribArray(c.a.aP)
      gl.vertexAttribPointer(c.a.aP, 3, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs.uv)
      gl.enableVertexAttribArray(c.a.aT)
      gl.vertexAttribPointer(c.a.aT, 2, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs.attr)
      const st = 44
      gl.enableVertexAttribArray(c.a.aN)
      gl.vertexAttribPointer(c.a.aN, 3, gl.FLOAT, false, st, 0)
      gl.enableVertexAttribArray(c.a.aU)
      gl.vertexAttribPointer(c.a.aU, 3, gl.FLOAT, false, st, 12)
      gl.enableVertexAttribArray(c.a.aV)
      gl.vertexAttribPointer(c.a.aV, 3, gl.FLOAT, false, st, 24)
      gl.enableVertexAttribArray(c.a.aKB)
      gl.vertexAttribPointer(c.a.aKB, 2, gl.FLOAT, false, st, 36)
      gl.uniform1i(c.u.uPat, 0)
      gl.uniform1i(c.u.uMask, 1)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, tx.pat)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, tx.mask)
      gl.activeTexture(gl.TEXTURE0)
      gl.uniform3fv(c.u.uCam, CAM)
      gl.uniform3fv(c.u.uLs, pal.sun)
      gl.uniform3fv(c.u.uLf, pal.fill)
      gl.uniform3fv(c.u.uSunCol, pal.sunCol)
      gl.uniform3fv(c.u.uFillCol, pal.night ? pal.fillCol.map((v) => 0.62 * v + 0.38) : pal.fillCol.map((v) => v * expo))
      gl.uniform1f(c.u.uSunK, pal.silkSunK ?? pal.sunK)
      gl.uniform1f(c.u.uFillK, pal.fillK)
      gl.uniform1f(c.u.uTransK, s.transK ?? 2.2)
      gl.uniform4f(c.u.uMaskR, MASK.x0, MASK.z0, 1 / (MASK.x1 - MASK.x0), 1 / (MASK.z1 - MASK.z0))
      gl.uniform4fv(c.u.uBlurD, pal.blur ?? [0.2, 0.33, 0.55, 0.6])
      gl.uniform1f(c.u.uDebug, s.debug ?? 0)
      // one pass, triangles sorted back to front (README asks for back faces then front faces; with folds
      // that turn edge-on, a far layer's front faces then overdraw a near layer's back faces in a sawtooth)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.bufs.sorted)
      gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, this.sortTris())
      gl.drawElements(gl.TRIANGLES, this.nIdx, gl.UNSIGNED_SHORT, 0)
    }

    // 4. rail, rings, finials (in front of the heading)
    gl.useProgram(q.p)
    gl.depthMask(true)
    const brass = pal.night ? rl(1.25) : [1.02 * room[0], 1.0 * room[1], 0.98 * room[2]]
    quad('rail', brass, 1, 1)
    {
      const pts: number[] = []
      const sq = (x: number, z: number, r: number, u0: number, u1: number) => {
        const y = RAIL.y + 0.02
        pts.push(x - r, y, z - r, u0, 1, x + r, y, z - r, u1, 1, x - r, y, z + r, u0, 0, x - r, y, z + r, u0, 0, x + r, y, z - r, u1, 1, x + r, y, z + r, u1, 0)
      }
      for (const x of s.rings) sq(x, RAIL.z - 0.004, 0.024, 0, 0.5)
      sq(RAIL.x0 - 0.01, RAIL.z, 0.026, 0.5, 1)
      sq(RAIL.x1 + 0.01, RAIL.z, 0.026, 0.5, 1)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs.quad)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.DYNAMIC_DRAW)
      this.disableAll()
      this.bindQuadAttribs(q, this.bufs.quad)
      gl.bindTexture(gl.TEXTURE_2D, tx.brass)
      gl.uniform3f(q.u.uTint, brass[0], brass[1], brass[2])
      gl.uniform1f(q.u.uAlpha, 1)
      gl.uniform1f(q.u.uMode, 0)
      gl.drawArrays(gl.TRIANGLES, 0, pts.length / 5)
    }

    // 5. dust motes in the sun shaft (open curtain only)
    if (s.motes && s.open > 0.01 && !pal.night) {
      const m = this.progs.mote
      gl.useProgram(m.p)
      gl.uniformMatrix4fv(m.u.uVP, false, vp)
      gl.uniform1f(m.u.uPx, 2.2 * this.dpr * (this.view.f / 830) * 3.4)
      gl.uniform3fv(m.u.uCol, pal.sunCol)
      gl.uniform1f(m.u.uK, 0.5 * s.open * (s.moteK ?? 1))
      this.disableAll()
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs.motes)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.motes)
      gl.enableVertexAttribArray(m.a.aM)
      gl.vertexAttribPointer(m.a.aM, 4, gl.FLOAT, false, 0, 0)
      gl.blendFunc(gl.ONE, gl.ONE)
      gl.depthMask(false)
      gl.drawArrays(gl.POINTS, 0, s.motes.length / 4)
    }
    gl.disable(gl.BLEND)
    gl.depthMask(true)
  }
}

