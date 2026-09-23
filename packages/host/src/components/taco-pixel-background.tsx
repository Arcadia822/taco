'use client'

import { useEffect, useRef } from 'react'

const TAU = Math.PI * 2
const HEADER_HEIGHT = 84
const COLORS = ['#3ecf8e', '#75e9ad', '#bbfbd8', '#effff5']
const SPHERE_COLORS = ['#b4f7d8', '#c1dcff', '#ffd8b7']
const SPHERE_PHASES = [-1.05, 2.7, 0.8]

function noise(index: number, seed: number) {
  const n = Math.sin(index * 127.1 + seed * 311.7) * 43758.5453
  return n - Math.floor(n)
}

// Position, wave phase, square size. Geometry is rebuilt only on resize.
type ParticleLayer = { points: Float32Array; color: string }
type Sphere = { points: Float32Array; color: string; phase: number; radius: number; x: number; y: number; z: number }

function compose(width: number, height: number): ParticleLayer[] {
  const groups: number[][] = COLORS.map(() => [])
  const mobile = width < 700
  const add = (x: number, y: number, index: number, strength = 1) => {
    const tone = Math.min(3, Math.floor(noise(index, 8) * 4))
    groups[tone].push(x, y, noise(index, 9) * TAU, (0.9 + noise(index, 10) * 0.9) * strength)
  }

  // Three separated streams sweep upward from the lower left. Black gaps,
  // rather than dark shading, describe the folds and preserve their silhouette.
  const columns = mobile ? 110 : 235
  for (let band = 0; band < 3; band++) {
    for (let column = 0; column < columns; column++) {
      const u = column / (columns - 1)
      const crest = height * (1.08 - 0.48 * u * u) + Math.sin(u * 7 + band * 0.9) * height * 0.035 + band * height * 0.095
      const rows = 6 + Math.floor(u * 10)
      for (let row = 0; row < rows; row++) {
        const index = band * 10000 + column * 30 + row
        if (noise(index, 2) < 0.22) continue
        const x = u * (width + 40) - 20 + (noise(index, 3) - 0.5) * 4
        const depth = row / rows
        const y = crest + depth * depth * height * 0.105 + (noise(index, 4) - 0.5) * 5
        add(x, y, index, mobile ? 0.8 : 1)
      }
    }
  }

  return groups.map((points, index) => ({ points: new Float32Array(points), color: COLORS[index] }))
}

function composeSpheres(width: number, height: number): Sphere[] {
  const mobile = width < 700
  const scale = mobile ? 1 : Math.max(0.7, Math.min(width / 1440, height / 900))
  return (mobile ? [50, 32, 20] : [89, 59, 37]).map((radius, index) => {
    const count = Math.round(radius * 4)
    const points = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      // Equal-area Fibonacci sampling: one clean layer on the unit sphere.
      const y = 1 - 2 * (i + 0.5) / count
      const r = Math.sqrt(1 - y * y)
      const angle = i * Math.PI * (3 - Math.sqrt(5))
      points[i * 3] = Math.cos(angle) * r
      points[i * 3 + 1] = y
      points[i * 3 + 2] = Math.sin(angle) * r
    }
    return { points, color: SPHERE_COLORS[index], phase: SPHERE_PHASES[index], radius: radius * scale, x: 0, y: 0, z: 0 }
  })
}

export function TacoPixelBackground() {
  const sceneRef = useRef<HTMLCanvasElement>(null)
  const coverRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = sceneRef.current!
    const cover = coverRef.current!
    const context = canvas.getContext('2d', { alpha: false })
    const header = cover.getContext('2d', { alpha: false })
    if (!context || !header) return
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let width = 0
    let height = 0
    let ratio = 1
    let layers: ParticleLayer[] = []
    let spheres: Sphere[] = []
    let frame = 0
    let lastTime = 0
    let elapsed = 0

    function draw() {
      if (!context || !header) return
      context.fillStyle = '#000'
      context.fillRect(0, 0, width, height)
      const time = elapsed / 1000
      const drift = Math.sin(time * TAU / 36) * 5
      for (const { points, color } of layers) {
        context.fillStyle = color
        context.beginPath()
        for (let i = 0; i < points.length; i += 4) {
          const phase = points[i + 2]
          const x = points[i] + drift + Math.sin(time * TAU / 42 + phase) * 2
          const y = points[i + 1] + Math.sin(time * TAU / 28 + points[i] / width * 5 + phase * 0.2) * 7
          const size = points[i + 3]
          context.rect(x, y, size, size)
        }
        context.fill()
      }
      const mobile = width < 700
      const revolution = time * TAU / 100
      const orbit = width * (mobile ? 0.15 : 0.095)
      const camera = orbit * 5
      for (const sphere of spheres) {
        const angle = sphere.phase + revolution
        sphere.x = Math.cos(angle) * orbit
        // A circular orbit inclined 72 degrees: its shallow screen projection
        // creates crossings while depth separates the passing spheres.
        sphere.y = Math.sin(angle) * orbit * 0.3090169944
        sphere.z = Math.sin(angle) * orbit * 0.9510565163
      }
      spheres.sort((a, b) => a.z - b.z)
      for (const sphere of spheres) {
        const perspective = camera / (camera - sphere.z)
        const x = width * (mobile ? 0.74 : 0.81) + sphere.x * perspective
        const y = height * (mobile ? 0.70 : 0.43) + sphere.y * perspective
        const radius = sphere.radius * perspective
        const spin = time * TAU / 100 + sphere.phase
        const cosine = Math.cos(spin)
        const sine = Math.sin(spin)
        // A sphere's silhouette stays round. The nearer sphere occludes what
        // is behind it; only front-facing surface points are rendered.
        context.fillStyle = '#000'
        context.beginPath()
        context.arc(x, y, radius, 0, TAU)
        context.fill()
        context.fillStyle = sphere.color
        context.beginPath()
        for (let i = 0; i < sphere.points.length; i += 3) {
          const px = sphere.points[i] * cosine + sphere.points[i + 2] * sine
          const pz = sphere.points[i + 2] * cosine - sphere.points[i] * sine
          if (pz <= 0) continue
          const size = (0.9 + pz * 1.4) * perspective * 1.5
          context.rect(x + px * radius - size / 2, y + sphere.points[i + 1] * radius - size / 2, size, size)
        }
        context.fill()
      }
      // Mirror this exact frame under the fixed header, never an independent loop.
      header.drawImage(canvas, 0, 0, canvas.width, cover.height, 0, 0, width, HEADER_HEIGHT)
    }

    function resize() {
      width = window.innerWidth
      height = window.innerHeight
      ratio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = cover.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      cover.height = Math.round(HEADER_HEIGHT * ratio)
      canvas.style.width = cover.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context!.setTransform(ratio, 0, 0, ratio, 0, 0)
      header!.setTransform(ratio, 0, 0, ratio, 0, 0)
      layers = compose(width, height)
      spheres = composeSpheres(width, height)
      draw()
    }

    function tick(time: number) {
      elapsed += Math.min(time - lastTime, 50)
      lastTime = time
      draw()
      frame = requestAnimationFrame(tick)
    }

    function updateMotion() {
      cancelAnimationFrame(frame)
      if (motion.matches) {
        elapsed = 0
        draw()
      } else if (!document.hidden) {
        lastTime = performance.now()
        frame = requestAnimationFrame(tick)
      }
    }

    resize()
    updateMotion()
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', updateMotion)
    motion.addEventListener('change', updateMotion)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', updateMotion)
      motion.removeEventListener('change', updateMotion)
    }
  }, [])

  return (
    <>
      <canvas ref={sceneRef} className="taco-pixel-background" aria-hidden="true" />
      <div className="header-cover" aria-hidden="true">
        <canvas ref={coverRef} className="taco-pixel-background__cover" />
      </div>
    </>
  )
}
