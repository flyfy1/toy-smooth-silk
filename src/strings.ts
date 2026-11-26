// Smooth as Silk: this toy's own interface text in five languages (toy-specific, not a shared file).
// The text every toy shares (names for the More menu, Share, About) lives in i18n.ts; this toy's name
// stays here until it is live. Lines for the cat, the neighbour, Mum and the clock arrive in phase 3.

const en = {
  name_silk: "Smooth as Silk",
  desc_silk: "A sheer silk curtain at an open window, lit by whatever time it is where you are. Drag it and it tents toward you and catches the light; let go and it swings back in one long wave. The window's shadow bends over every fold, and there is a cat behind it. A tiny calming toy, no sign-up.",
  hint_silk: "Drag the curtain. Let go.",
  share_silk: "There is a window here with a silk curtain. Give it a pull:",
  silk_nogl: "This toy needs WebGL, and this browser has it switched off.",
}

const zhCN: typeof en = {
  name_silk: "丝滑",
  desc_silk: "一扇开着的窗，一幅真丝薄窗帘，光线跟着你那边现在的时间走。用手指一拉，它朝你鼓起来，光顺着丝线滑过去；一松手，它荡回去，一道长长的波。窗格的影子落在每一道褶子上，窗帘后面还有一只猫。打开即玩的治愈小玩具。",
  hint_silk: "拉一下窗帘，再松手",
  share_silk: "这儿有一扇窗，窗帘是真丝的。拉一下：",
  silk_nogl: "这个玩具需要 WebGL，这个浏览器没开。",
}

const es: typeof en = {
  name_silk: "Pura Seda",
  desc_silk: "Una cortina de seda fina en una ventana abierta, con la luz de la hora que sea donde estés. Arrástrala y se abomba hacia ti y atrapa la luz; suéltala y vuelve en una sola onda larga. La sombra de la ventana se dobla en cada pliegue, y detrás hay un gato. Un pequeño juguete para calmarse, sin registro.",
  hint_silk: "Arrastra la cortina y suéltala",
  share_silk: "Aquí hay una ventana con una cortina de seda. Tira de ella:",
  silk_nogl: "Este juguete necesita WebGL y este navegador lo tiene desactivado.",
}

const fr: typeof en = {
  name_silk: "Tout en Soie",
  desc_silk: "Un voilage de soie devant une fenêtre ouverte, éclairé selon l'heure qu'il est chez vous. Tirez-le : il se tend vers vous et accroche la lumière ; lâchez, il repart en une longue vague. L'ombre de la fenêtre épouse chaque pli, et il y a un chat derrière. Un petit jouet apaisant, sans inscription.",
  hint_silk: "Tirez le rideau, puis lâchez",
  share_silk: "Il y a ici une fenêtre avec un rideau de soie. Tirez-le :",
  silk_nogl: "Ce jouet a besoin de WebGL, et ce navigateur l'a désactivé.",
}

const ja: typeof en = {
  name_silk: "するするシルク",
  desc_silk: "開いた窓に、薄い絹のカーテン。光はあなたの今の時刻に合わせて変わる。指で引くとこちらへふくらんで光をとらえ、はなすと長いひと波で戻っていく。窓の影がひだの一本一本に沿って曲がり、その向こうには猫がいる。登録不要の小さな癒やしのおもちゃ。",
  hint_silk: "カーテンを引いて、はなす",
  share_silk: "ここに窓がある。カーテンは絹。引いてみて：",
  silk_nogl: "このおもちゃには WebGL が必要ですが、このブラウザでは無効になっています。",
}

export default { en, 'zh-CN': zhCN, es, fr, ja }
