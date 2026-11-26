// Smooth as Silk sounds (spec section 4). All synthesised with Web Audio; no files. A quiet toy: the
// loudest thing in it is a ring. Haptics (Android) ride along here so the game calls one place.

type Bed = 'day' | 'night' | 'rain' | 'off'

const vib = (ms: number) => {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* not allowed */
  }
}

class Audio {
  ctx: AudioContext | null = null
  private out!: GainNode
  private noise!: AudioBuffer
  private rusG!: GainNode
  private rusAm!: GainNode
  private gustG!: GainNode
  private bedG!: GainNode
  private bedNodes: AudioNode[] = []
  private bed: Bed = 'off'
  private bedLevel = 1
  private ticks: number[] = []
  private lastVib = 0
  private wob = 0

  /** on the first touch (browsers only start audio from a gesture) */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    this.ctx = ctx
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.ratio.value = 4
    this.out = ctx.createGain()
    this.out.gain.value = 1
    this.out.connect(comp).connect(ctx.destination)
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    this.noise = buf
    // rustle: 4.5 kHz band, Q 0.7, with a slow amplitude wobble
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 4500
    bp.Q.value = 0.7
    this.rusAm = ctx.createGain()
    this.rusAm.gain.value = 1
    this.rusG = ctx.createGain()
    this.rusG.gain.value = 0
    this.loop().connect(bp).connect(this.rusAm).connect(this.rusG).connect(this.out)
    // gust: lowpassed noise at 380 Hz
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 380
    this.gustG = ctx.createGain()
    this.gustG.gain.value = 0
    this.loop().connect(lp).connect(this.gustG).connect(this.out)
    this.bedG = ctx.createGain()
    this.bedG.gain.value = 1
    this.bedG.connect(this.out)
  }

  private loop() {
    const s = this.ctx!.createBufferSource()
    s.buffer = this.noise
    s.loop = true
    s.loopStart = Math.random()
    s.start()
    return s
  }

  /** a short burst of noise through a filter, with an envelope */
  private burst(type: BiquadFilterType, f: number, q: number, gain: number, dur: number, f2?: number, when = 0) {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    const t = ctx.currentTime + when
    const s = ctx.createBufferSource()
    s.buffer = this.noise
    const fl = ctx.createBiquadFilter()
    fl.type = type
    fl.frequency.setValueAtTime(f, t)
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur)
    fl.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gain, t + Math.min(0.008, dur / 4))
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    s.connect(fl).connect(g).connect(this.out)
    s.start(t, Math.random() * 1.5)
    s.stop(t + dur + 0.02)
  }

  private tone(f: number, gain: number, dur: number, when = 0, attack = 0.002, dest?: AudioNode) {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    const t = ctx.currentTime + when
    const o = ctx.createOscillator()
    o.frequency.value = f
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gain, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur)
    o.connect(g).connect(dest ?? this.out)
    o.start(t)
    o.stop(t + attack + dur + 0.02)
  }

  /** every frame: the cloth's mean speed (m/s) and the wind speed (m/s) */
  frame(clothSpeed: number, wind: number, dt: number) {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    const t = ctx.currentTime
    this.wob += dt * (3 + 4 * Math.random()) * Math.PI * 2
    this.rusAm.gain.setTargetAtTime(1 + 0.3 * Math.sin(this.wob), t, 0.02)
    this.rusG.gain.setTargetAtTime(0.05 * Math.min(1, Math.max(0, clothSpeed / 1.2)), t, 0.04)
    this.gustG.gain.setTargetAtTime(0.05 * Math.min(1, Math.max(0, (wind - 0.4) / 2.4)), t, 0.1)
  }

  pinch() {
    this.burst('bandpass', 4500, 0.7, 0.05, 0.02)
    vib(6)
  }

  /** a ring slid 0.03 m along the rail */
  ring(speed: number) {
    const ctx = this.ctx
    if (!ctx) return
    const now = performance.now()
    this.ticks = this.ticks.filter((x) => now - x < 1000)
    if (this.ticks.length >= 90) return
    this.ticks.push(now)
    const g = 0.03 + 0.04 * Math.min(1, speed / 0.5)
    const j = () => 1 + (Math.random() - 0.5) * 0.12
    this.tone(3200 * j(), g, 0.022)
    this.tone(5100 * j(), g * 0.7, 0.022)
    if (now - this.lastVib >= 30) {
      this.lastVib = now
      vib(3)
    }
  }

  clack(stack = false) {
    this.tone(1400, 0.08, 0.045)
    this.burst('highpass', 3000, 0.7, 0.06, 0.006)
    if (stack) vib(14)
  }

  swish(speed: number) {
    this.burst('bandpass', 2000, 1.2, Math.min(0.15, 0.05 * speed), 0.18, 5000)
  }

  release(pulled: number) {
    if (pulled > 0.2) vib(5)
  }

  chime(strikes = 1) {
    for (let i = 0; i < strikes; i++) {
      const w = i * 0.18
      this.tone(2640, 0.05, 1.4, w)
      this.tone(3960, 0.035, 0.9, w)
      this.tone(5280, 0.025, 0.5, w)
    }
  }

  flood() {
    this.tone(523, 0.025, 0.9, 0, 0.2)
    this.tone(784, 0.02, 0.9, 0, 0.2)
  }

  puff() {
    this.burst('lowpass', 700, 0.7, 0.05, 0.06)
  }

  bat() {
    this.tone(150, 0.08, 0.04)
    this.burst('bandpass', 2000, 2, 0.04, 0.02)
    vib(10)
  }

  /** the ambient bed from the first touch: cicadas by day, crickets at night, rain. Closed curtain: -30%. */
  setBed(kind: Bed, closed: boolean) {
    const ctx = this.ctx
    if (!ctx) return
    const lvl = closed ? 0.7 : 1
    if (lvl !== this.bedLevel) {
      this.bedLevel = lvl
      this.bedG.gain.setTargetAtTime(lvl, ctx.currentTime, 0.4)
    }
    if (kind === this.bed) return
    this.bed = kind
    for (const n of this.bedNodes) {
      try {
        ;(n as AudioScheduledSourceNode).stop?.()
      } catch {
        /* already stopped */
      }
      n.disconnect()
    }
    this.bedNodes = []
    if (kind === 'day') {
      // cicadas: a 5 kHz band, Q 6, pulsed at 11 Hz, swelling and fading over 9 s
      const s = this.loop()
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 5000
      bp.Q.value = 6
      const pulse = ctx.createGain()
      pulse.gain.value = 0.5
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 11
      const lg = ctx.createGain()
      lg.gain.value = 0.5
      lfo.connect(lg).connect(pulse.gain)
      const swell = ctx.createGain()
      swell.gain.value = 0.006
      const slow = ctx.createOscillator()
      slow.frequency.value = 1 / 9
      const sg = ctx.createGain()
      sg.gain.value = 0.004
      slow.connect(sg).connect(swell.gain)
      s.connect(bp).connect(pulse).connect(swell).connect(this.bedG)
      lfo.start()
      slow.start()
      this.bedNodes.push(s, lfo, slow, bp, pulse, swell, lg, sg)
    } else if (kind === 'rain') {
      const s = this.loop()
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 1200
      const g = ctx.createGain()
      g.gain.value = 0.04
      s.connect(lp).connect(g).connect(this.bedG)
      this.bedNodes.push(s, lp, g)
    }
  }

  private nextCricket = 0
  private nextDrop = 0
  /** per frame: crickets in threes every 0.7 s at night; sparse 3 kHz ticks in the rain */
  tickBed() {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    const t = ctx.currentTime
    if (this.bed === 'night' && t >= this.nextCricket) {
      this.nextCricket = t + 0.7
      for (let i = 0; i < 3; i++) this.tone(4200, 0.008 * this.bedLevel, 0.03, i * 0.06, 0.004, this.bedG)
    }
    if (this.bed === 'rain' && t >= this.nextDrop) {
      this.nextDrop = t + 0.05 + Math.random() * 0.25
      this.tone(3000 * (0.9 + Math.random() * 0.2), 0.01, 0.012, 0, 0.001, this.bedG)
    }
  }

  /** hidden: the bed (and everything) stops */
  suspend(hidden: boolean) {
    const ctx = this.ctx
    if (!ctx) return
    if (hidden) void ctx.suspend()
    else void ctx.resume()
  }
}

export const audio = new Audio()
