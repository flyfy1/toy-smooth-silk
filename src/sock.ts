// Smooth as Silk: the odd sock on the bamboo line outside, for a portal visit from void (its pair was burped back
// there): void's sock, cream with two pink cuff stripes and a dark outline. Loaded with that arrival only, so the first
// load stays as it was.
export function drawSock(g: CanvasRenderingContext2D, [a, b]: [number, number], u: number, v: number, night: boolean) {
  g.save()
  g.translate(a, b)
  g.rotate(-0.05)
  g.fillStyle = night ? 'rgba(150,150,170,0.95)' : '#F6F1E7'
  g.beginPath()
  // the leg down to the ankle, the top of the foot, the toe, the sole back to a round heel
  g.moveTo(0, 0)
  g.lineTo(u, 0)
  g.lineTo(u, v * 0.62)
  g.quadraticCurveTo(u * 1.1, v * 0.7, u * 1.55, v * 0.71)
  g.quadraticCurveTo(u * 2, v * 0.72, u * 2, v * 0.86)
  g.quadraticCurveTo(u * 2, v, u * 1.55, v)
  g.lineTo(u * 0.45, v)
  g.quadraticCurveTo(0, v, 0, v * 0.76)
  g.closePath()
  g.fill()
  g.strokeStyle = night ? 'rgba(20,20,30,0.7)' : 'rgba(40,30,30,0.75)'
  g.lineWidth = Math.max(1, u * 0.09)
  g.lineJoin = 'round'
  g.stroke()
  if (!night) {
    // the cuff: two stripes, as void's
    g.fillStyle = '#E0457B'
    g.fillRect(0, v * 0.08, u, v * 0.06)
    g.fillRect(0, v * 0.2, u, v * 0.05)
  }
  // a clothes peg
  g.fillStyle = night ? '#6A6A50' : '#D8C9A3'
  g.fillRect(u * 0.4, -v * 0.07, u * 0.2, v * 0.12)
  g.restore()
}
