import { useEffect, useRef, useState } from 'react'
import { MoreMenu, pillClass } from './components/MoreMenu'
import { Hint } from './components/Hint'
import { Tag } from './components/Tag'
import { applyMeta, t, tx } from './i18n'
import { startAnalytics, track } from './analytics'
import { arrive, landing, live, peakEvery, sharePeak, trackLanding } from './share'
import { startGame, type GameApi } from './game'

const Q = new URLSearchParams(location.search)
const SHOT = Q.has('shot')
const OG = Q.get('shot') === 'og'
const V = Number(Q.get('v'))

type Line = { text: string; mode: 'line' | 'mum'; id: number }

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export default function App() {
  const ref = useRef<HTMLCanvasElement>(null)
  const api = useRef<GameApi | null>(null)
  const [touched, setTouched] = useState(false)
  const [noGL, setNoGL] = useState(false)
  const [line, setLine] = useState<Line | null>(null)
  const [mum, setMum] = useState<Line | null>(null)
  const [sec, setSec] = useState(0)
  const lineTimer = useRef<number | undefined>(undefined)
  const mumTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    applyMeta('silk')
    startAnalytics('silk')
    trackLanding()
    const g = startGame(ref.current!, {
      onFirst() {
        setTouched(true)
        track('play_start')
      },
      onNoGL() {
        setNoGL(true)
        track('no_webgl')
      },
      onLine(key, mode, vars) {
        const l = { text: tx(key, vars), mode, id: Date.now() + Math.random() }
        if (mode === 'mum') {
          setMum(l)
          window.clearTimeout(mumTimer.current)
          mumTimer.current = window.setTimeout(() => setMum(null), 3600)
        } else {
          setLine(l)
          window.clearTimeout(lineTimer.current)
          lineTimer.current = window.setTimeout(() => setLine(null), 3200)
        }
      },
      onPeak(kind, n, data, snap) {
        if (kind === 'first') sharePeak('silk', { snap, data })
        else peakEvery('silk', n, { snap, data })
      },
      onData(fn, snap) {
        live.data = fn
        live.snap = snap
      },
    })
    api.current = g
    // a portal visit (void's sock, knock's incense smoke): the tag, and the rain view with the sock, or one puff
    arrive('silk', ['top-14', 'bg-[#FFFDF8] text-[#3B3A32]']).then((a) => a && g.arrive?.(a.from === 'void' ? 'rain' : 'puff'))
    // the time by the window, shown after 30 s
    const iv = window.setInterval(() => setSec(g.sec()), 1000)
    return () => {
      window.clearInterval(iv)
      g.dispose()
    }
  }, [])

  const tag = landing.recipient && Number.isInteger(V) && V >= 1 && V <= 5 ? t('silk_tag') : ''

  return (
    <>
      <canvas ref={ref} />
      {noGL && (
        <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-[#F3EADB] px-6 text-center text-[#3B3A32]">
          <img src="/og.png" alt="" className="max-h-[50vh] max-w-full rounded-2xl shadow-lg" onError={(e) => (e.currentTarget.style.display = 'none')} />
          <p className="max-w-[30ch] text-[15px] leading-snug">{t('silk_nogl')}</p>
        </div>
      )}
      {OG && (
        <div className="pointer-events-none fixed inset-y-0 left-0 flex w-[40%] flex-col justify-center gap-3 pl-[5%] text-[#3B3A32]">
          <div className="text-[64px] font-extrabold leading-none tracking-tight">{t('name_silk')}</div>
          <div className="max-w-[18ch] text-[24px] leading-snug text-[#3B3A32]/75">{t('hint_silk')}</div>
          <div className="mt-2 font-mono text-[18px] text-[#7A9A6E]">silk.integ.life</div>
        </div>
      )}
      {!SHOT && sec >= 30 && (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-10 flex justify-center select-none">
          <span className={`${pillClass('silk')} tabular-nums`}>{t('silk_time', { t: mmss(sec) })}</span>
        </div>
      )}
      {!SHOT && mum && (
        <div key={mum.id} className="silk-mum pointer-events-none fixed inset-x-0 top-16 z-10 flex justify-center px-4 select-none">
          <div className="max-w-[340px] rounded-2xl rounded-tl-md bg-white/95 px-3.5 py-2 text-[15px] leading-snug text-[#2B2620] shadow-[0_6px_20px_rgba(60,45,30,.18)]">
            <div className="text-[12px] font-semibold text-[#3A8DDE]">{t('silk_mum')}</div>
            {mum.text}
          </div>
        </div>
      )}
      {!SHOT && line && (
        <div key={line.id} className="silk-line pointer-events-none fixed inset-x-0 bottom-[5.5rem] z-10 flex justify-center px-6 select-none">
          <span className="max-w-[340px] rounded-2xl bg-[#FFFDF8]/85 px-3.5 py-1.5 text-center text-[16px] font-medium tracking-wide text-[#3B3A32]/90 shadow-[0_4px_14px_rgba(74,58,44,.12)]">{line.text}</span>
        </div>
      )}
      {!SHOT && <Hint text={t('hint_silk')} hidden={touched || noGL} toy="silk" />}
      {tag && <Tag text={tag} className="top-14" paper="bg-[#FFFDF8] text-[#3B3A32]" />}
      {!SHOT && <MoreMenu current="silk" />}
    </>
  )
}
