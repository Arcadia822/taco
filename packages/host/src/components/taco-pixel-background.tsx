'use client'

import { useEffect, useRef } from 'react'

const TAU = Math.PI * 2
const HEADER_HEIGHT = 84
const TERRAIN_COLORS = ['#1d6f46', '#3ecf8e', '#79eeb4', '#d8ffeb']
const SPHERE_COLORS = ['#b4f7d8', '#c1dcff', '#ffd8b7']
const SPHERE_PHASES = [-1.05, 2.7, 0.8]

function noise(index: number, seed: number) {
  const n = Math.sin(index * 127.1 + seed * 311.7) * 43758.5453
  return n - Math.floor(n)
}

// Position, wave phase, square size. Geometry is rebuilt only on resize.
type TerrainLayer = { points: Float32Array; color: string }
type Sphere = { points: Float32Array; color: string; phase: number; radius: number; x: number; y: number; z: number }

function composeTerrain(width: number, height: number): TerrainLayer[] {
  const mobile = width < 700
  const rows = mobile ? 20 : 30
  const cols = mobile ? 46 : 86
  const xStart = width * (mobile ? 0.20 : 0.35)
  const xEnd = width * 1.02
  const groups: number[][] = TERRAIN_COLORS.map(() => [])
  for (let r = 0; r < rows; r++) {
    const v = r / (rows - 1)
    for (let c = 0; c < cols; c++) {
      const index = r * cols + c
      if (noise(index, 1) < 0.14) continue
      const u = c / (cols - 1)
      const uj = Math.max(0, Math.min(1, u + (noise(index, 2) - 0.5) * (1 / cols) * 0.7))
      const vj = Math.max(0, Math.min(1, v + (noise(index, 3) - 0.5) * (1 / rows) * 0.7))
      const x0 = xStart + uj * (xEnd - xStart)
      // Natural gentle curve matching user boundary:
      // tapers into bottom edge at xStart, rises smoothly to ~0.74 height on right
      const crest = height * (1.01 - 0.27 * Math.pow(uj, 1.25))
      const thickness = (height + 16) - crest
      if (thickness <= 0) continue
      const y0 = crest + vj * thickness
      const tone = Math.max(0, Math.min(3, Math.floor((1 - vj) * 3.1 + noise(index, 4) * 0.6)))
      const sizeBase = 1.2 + noise(index, 5) * 0.8
      groups[tone].push(x0, y0, noise(index, 6) * TAU, sizeBase)
    }
  }
  return groups.map((points, index) => ({ points: new Float32Array(points), color: TERRAIN_COLORS[index] }))
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
    let terrainLayers: TerrainLayer[] = []
    let spheres: Sphere[] = []
    let frame = 0
    let lastTime = 0
    let elapsed = 0

    function draw() {
      if (!context || !header) return
      context.fillStyle = '#000'
      context.fillRect(0, 0, width, height)
      const time = elapsed / 1000
      const mobile = width < 700
      // 1. Gentle sea-wave swaying strictly below the red-line crest in the bottom-right
      const drift = Math.sin(time * TAU / 40) * 3
      for (const { points, color } of terrainLayers) {
        context.fillStyle = color
        context.beginPath()
        for (let i = 0; i < points.length; i += 4) {
          const x0 = points[i]
          const y0 = points[i + 1]
          const phase = points[i + 2]
          const sizeBase = points[i + 3]
          const x = x0 + drift + Math.sin(time * TAU / 32 + phase) * 2
          const y = y0 + Math.sin(time * TAU / 26 + (x0 / width) * 3.5 + phase * 0.25) * 4 + Math.cos(time * TAU / 38 - (y0 / height) * 2.5) * 2
          if (x >= -10 && x <= width + 10 && y >= -10 && y <= height + 10) {
            context.rect(x - sizeBase / 2, y - sizeBase / 2, sizeBase, sizeBase)
          }
        }
        context.fill()
      }
      // 2. Three 3D spherical particle clouds orbiting with true depth and mutual occlusion
      const revolution = time * TAU / 120
      const orbit = width * (mobile ? 0.11 : 0.075)
      const camera = orbit * 5
      for (const sphere of spheres) {
        const angle = sphere.phase + revolution
        sphere.x = Math.cos(angle) * orbit
        sphere.y = Math.sin(angle) * orbit * 0.28
        sphere.z = Math.sin(angle) * orbit * 0.85
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
      const targetWidth = Math.min(Math.round(width * ratio), 3840)
      const targetHeight = Math.min(Math.round(height * ratio), 2160)
      canvas.width = cover.width = targetWidth
      canvas.height = targetHeight
      cover.height = Math.round(HEADER_HEIGHT * (targetHeight / height))
      canvas.style.width = cover.style.width = `${width}px`
      canvas.style.height = `${height}px`
      const scaleX = targetWidth / width
      const scaleY = targetHeight / height
      context!.setTransform(scaleX, 0, 0, scaleY, 0, 0)
      header!.setTransform(scaleX, 0, 0, scaleY, 0, 0)
      terrainLayers = composeTerrain(width, height)
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
