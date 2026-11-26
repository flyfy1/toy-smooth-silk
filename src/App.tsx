import { useEffect, useRef, useState } from 'react'
import { MoreMenu } from './components/MoreMenu'
import { Hint } from './components/Hint'
import { applyMeta, t } from './i18n'
import { startAnalytics, track } from './analytics'
import { trackLanding } from './share'
import { startGame } from './game'

const SHOT = new URLSearchParams(location.search).has('shot')

export default function App() {
  const ref = useRef<HTMLCanvasElement>(null)
  const [touched, setTouched] = useState(false)
  const [noGL, setNoGL] = useState(false)
  useEffect(() => {
    applyMeta('silk')
    startAnalytics('silk')
    trackLanding()
    const g = startGame(
      ref.current!,
      () => {
        setTouched(true)
        track('play_start')
      },
      () => {
        setNoGL(true)
        track('no_webgl')
      },
    )
    return () => g.dispose()
  }, [])
  return (
    <>
      <canvas ref={ref} />
      {noGL && (
        <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-[#F3EADB] px-6 text-center text-[#3B3A32]">
          <img src="/og.png" alt="" className="max-h-[50vh] max-w-full rounded-2xl shadow-lg" onError={(e) => (e.currentTarget.style.display = 'none')} />
          <p className="max-w-[30ch] text-[15px] leading-snug">{t('silk_nogl')}</p>
        </div>
      )}
      {!SHOT && <Hint text={t('hint_silk')} hidden={touched || noGL} toy="silk" />}
      {!SHOT && <MoreMenu current="silk" />}
    </>
  )
}
