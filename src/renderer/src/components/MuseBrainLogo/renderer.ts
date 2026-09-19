// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

/**
 * Muse Brain Logo — WebGPU 3D neural particle renderer
 *
 * Compact version designed for logo-sized canvas and homepage-scale Muse core.
 * Emotion-driven: color, pulse speed, discharge intensity all respond to MuseState.
 */

/// <reference types="@webgpu/types" />

import { PARTICLE_SHADER, LINE_SHADER } from './shaders'

// --- Types ---

export type MuseState = 'idle' | 'working' | 'outputting' | 'error' | 'waiting'
export type MuseGlyphVariant = 'conch' | 'brain'

interface EmotionParams {
  baseColor: [number, number, number]
  pulseColor: [number, number, number]
  breathSpeed: number
  breathStrength: number
  pulseSpeed: number
  pulseStrength: number
  connectionStrength: number
  dischargeFrequency: number
  dischargeIntensity: number
  dischargeDuration: number
  autoRotateSpeed: number
}

interface Particle {
  basePos: [number, number, number]
  phase: number
  speed: number
  brightness: number
}

// --- Constants ---

const PARTICLE_COUNT = 800
const CONNECTION_COUNT = 1200
const SPHERE_RADIUS = 0.65

// --- Emotion Presets ---

const EMOTION_MAP: Record<MuseState, EmotionParams> = {
  idle: {
    baseColor: [0.15, 0.75, 1.0],
    pulseColor: [0.45, 0.95, 1.0],
    breathSpeed: 0.45,
    breathStrength: 0.04,
    pulseSpeed: 1.2,
    pulseStrength: 0.35,
    connectionStrength: 0.05,
    dischargeFrequency: 6.0,
    dischargeIntensity: 0.6,
    dischargeDuration: 0.6,
    autoRotateSpeed: 0.0015,
  },
  working: {
    baseColor: [0.35, 0.35, 1.0],
    pulseColor: [0.75, 0.35, 1.0],
    breathSpeed: 0.8,
    breathStrength: 0.08,
    pulseSpeed: 2.5,
    pulseStrength: 0.7,
    connectionStrength: 0.16,
    dischargeFrequency: 3.5,
    dischargeIntensity: 1.2,
    dischargeDuration: 0.4,
    autoRotateSpeed: 0.003,
  },
  outputting: {
    baseColor: [1.0, 0.45, 0.18],
    pulseColor: [1.0, 0.95, 0.35],
    breathSpeed: 1.4,
    breathStrength: 0.14,
    pulseSpeed: 5.0,
    pulseStrength: 1.0,
    connectionStrength: 0.28,
    dischargeFrequency: 1.8,
    dischargeIntensity: 2.0,
    dischargeDuration: 0.25,
    autoRotateSpeed: 0.006,
  },
  error: {
    baseColor: [0.9, 0.15, 0.15],
    pulseColor: [1.0, 0.3, 0.2],
    breathSpeed: 2.0,
    breathStrength: 0.06,
    pulseSpeed: 6.0,
    pulseStrength: 0.8,
    connectionStrength: 0.1,
    dischargeFrequency: 1.2,
    dischargeIntensity: 2.5,
    dischargeDuration: 0.15,
    autoRotateSpeed: 0.008,
  },
  waiting: {
    baseColor: [0.2, 0.6, 0.9],
    pulseColor: [0.5, 0.8, 1.0],
    breathSpeed: 0.35,
    breathStrength: 0.03,
    pulseSpeed: 0.8,
    pulseStrength: 0.2,
    connectionStrength: 0.04,
    dischargeFrequency: 8.0,
    dischargeIntensity: 0.4,
    dischargeDuration: 0.7,
    autoRotateSpeed: 0.001,
  },
}

// --- Helpers ---

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpColor(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

function smoothParams(current: EmotionParams, target: EmotionParams, factor: number): EmotionParams {
  return {
    baseColor: lerpColor(current.baseColor, target.baseColor, factor),
    pulseColor: lerpColor(current.pulseColor, target.pulseColor, factor),
    breathSpeed: lerp(current.breathSpeed, target.breathSpeed, factor),
    breathStrength: lerp(current.breathStrength, target.breathStrength, factor),
    pulseSpeed: lerp(current.pulseSpeed, target.pulseSpeed, factor),
    pulseStrength: lerp(current.pulseStrength, target.pulseStrength, factor),
    connectionStrength: lerp(current.connectionStrength, target.connectionStrength, factor),
    dischargeFrequency: lerp(current.dischargeFrequency, target.dischargeFrequency, factor),
    dischargeIntensity: lerp(current.dischargeIntensity, target.dischargeIntensity, factor),
    dischargeDuration: lerp(current.dischargeDuration, target.dischargeDuration, factor),
    autoRotateSpeed: lerp(current.autoRotateSpeed, target.autoRotateSpeed, factor),
  }
}

function hashU32(value: number): number {
  return ((value >>> 0) * 2654435761) >>> 0
}

// --- Particle Generation ---

function generateBrainParticles(): Particle[] {
  const particles: Particle[] = []
  const goldenRatio = (1 + Math.sqrt(5)) / 2
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const theta = Math.PI * 2 * i / goldenRatio
    const phi = Math.acos(1 - 2 * (i + 0.5) / PARTICLE_COUNT)
    const hash = (hashU32(i) >> 16) / 65536
    const r = SPHERE_RADIUS * (0.85 + hash * 0.3)
    const x = r * Math.sin(phi) * Math.cos(theta)
    const y = r * Math.sin(phi) * Math.sin(theta)
    const z = r * Math.cos(phi)
    particles.push({
      basePos: [x, y, z],
      phase: hash * Math.PI * 2,
      speed: 0.5 + hash * 1.5,
      brightness: 0.4 + hash * 0.6,
    })
  }
  return particles
}

function generateConchParticles(): Particle[] {
  const particles: Particle[] = []
  const whorls = 7.4

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const hash = (hashU32(i) >> 16) / 65536
    const hash2 = (hashU32(i + 97) >> 16) / 65536
    const hash3 = (hashU32(i + 211) >> 16) / 65536
    const t = i / (PARTICLE_COUNT - 1)
    const theta = t * Math.PI * 2 * whorls

    const growth = t ** 0.74
    const shellRadius = 0.08 + growth * 0.76
    const tubeRadius = (0.18 * (1 - t) ** 0.58 + 0.026) * (0.58 + hash * 0.82)
    const rib = Math.sin(theta * 0.92 + hash * Math.PI * 2) * 0.035 * (1 - t)
    const cross = hash2 * Math.PI * 2

    const x = (shellRadius + Math.cos(cross) * tubeRadius + rib) * Math.cos(theta) * 0.86
    const y = (shellRadius * 0.68 + Math.sin(cross) * tubeRadius * 0.78) * Math.sin(theta) - 0.04
    const z = (t - 0.5) * 0.72 + Math.sin(cross) * tubeRadius * 0.9 + Math.cos(theta * 0.38) * 0.06

    // Pull the opening slightly outward so the silhouette reads as a shell, not a sphere.
    const mouth = Math.max(0, (0.18 - t) / 0.18)
    const mouthLift = mouth ** 2

    particles.push({
      basePos: [
        x * (1 + mouthLift * 0.42) - 0.08,
        y * (1 + mouthLift * 0.22) + mouthLift * 0.08,
        z - mouthLift * 0.2,
      ],
      phase: hash * Math.PI * 2,
      speed: 0.35 + hash2 * 1.35,
      brightness: 0.34 + hash3 * 0.7 + mouthLift * 0.28,
    })
  }

  return particles
}

function generateParticles(variant: MuseGlyphVariant): Particle[] {
  return variant === 'brain' ? generateBrainParticles() : generateConchParticles()
}

function generateConnections(particles: Particle[]): [number, number][] {
  const connections: [number, number][] = []
  const maxDist = SPHERE_RADIUS * 0.45
  const maxDistSq = maxDist * maxDist

  // Build connections by proximity (limited scan for performance)
  for (let i = 0; i < PARTICLE_COUNT && connections.length < CONNECTION_COUNT; i++) {
    const stride = 1 + hashU32(i) % 5
    for (let j = i + 1; j < Math.min(i + 30, PARTICLE_COUNT) && connections.length < CONNECTION_COUNT; j += stride) {
      const dx = particles[i].basePos[0] - particles[j].basePos[0]
      const dy = particles[i].basePos[1] - particles[j].basePos[1]
      const dz = particles[i].basePos[2] - particles[j].basePos[2]
      if (dx * dx + dy * dy + dz * dz < maxDistSq) {
        connections.push([i, j])
      }
    }
  }
  return connections
}

// --- Main Renderer Class ---

export class MuseBrainRenderer {
  private device!: GPUDevice
  private context!: GPUCanvasContext
  private particlePipeline!: GPURenderPipeline
  private linePipeline!: GPURenderPipeline
  private globalsBuffer!: GPUBuffer
  private globalsBindGroup!: GPUBindGroup
  private instanceBuffer!: GPUBuffer
  private lineBuffer!: GPUBuffer

  private particles: Particle[] = []
  private connections: [number, number][] = []
  private currentParams: EmotionParams = EMOTION_MAP.idle
  private startTime = performance.now() / 1000
  private camYaw = 0
  private animationId = 0
  private canvas!: HTMLCanvasElement
  private variant: MuseGlyphVariant

  constructor(variant: MuseGlyphVariant = 'conch') {
    this.variant = variant
    this.camYaw = variant === 'conch' ? -0.62 : 0
  }

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    this.canvas = canvas
    const gpu = navigator.gpu
    if (!gpu) return false

    const adapter = await gpu.requestAdapter()
    if (!adapter) return false

    this.device = await adapter.requestDevice()
    this.context = canvas.getContext('webgpu') as GPUCanvasContext
    if (!this.context) return false

    const format = navigator.gpu.getPreferredCanvasFormat()
    this.context.configure({ device: this.device, format, alphaMode: 'premultiplied' })

    this.particles = generateParticles(this.variant)
    this.connections = generateConnections(this.particles)

    this.createPipelines(format)
    this.createBuffers()
    return true
  }

  private createPipelines(format: GPUTextureFormat) {
    const globalsLayout = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    })
    const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [globalsLayout] })

    // Particle pipeline
    const particleModule = this.device.createShaderModule({ code: PARTICLE_SHADER })
    this.particlePipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: particleModule,
        entryPoint: 'vs_particle',
        buffers: [{
          arrayStride: 16,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32' },
          ],
        }],
      },
      fragment: {
        module: particleModule,
        entryPoint: 'fs_particle',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    })

    // Line pipeline
    const lineModule = this.device.createShaderModule({ code: LINE_SHADER })
    this.linePipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: lineModule,
        entryPoint: 'vs_line',
        buffers: [{
          arrayStride: 16,
          stepMode: 'vertex',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32' },
          ],
        }],
      },
      fragment: {
        module: lineModule,
        entryPoint: 'fs_line',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'line-list' },
    })

    // Globals buffer & bind group
    this.globalsBuffer = this.device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.globalsBindGroup = this.device.createBindGroup({
      layout: globalsLayout,
      entries: [{ binding: 0, resource: { buffer: this.globalsBuffer } }],
    })
  }

  private createBuffers() {
    this.instanceBuffer = this.device.createBuffer({
      size: PARTICLE_COUNT * 16,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
    this.lineBuffer = this.device.createBuffer({
      size: this.connections.length * 4 * 16,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
  }

  setState(state: MuseState) {
    // Target is set; smooth interpolation happens in render loop
    this._targetState = state
  }

  private _targetState: MuseState = 'idle'

  start() {
    const loop = () => {
      this.renderFrame()
      this.animationId = requestAnimationFrame(loop)
    }
    this.animationId = requestAnimationFrame(loop)
  }

  stop() {
    cancelAnimationFrame(this.animationId)
  }

  destroy() {
    this.stop()
    this.device?.destroy()
  }

  private renderFrame() {
    const time = performance.now() / 1000 - this.startTime
    const targetParams = EMOTION_MAP[this._targetState]
    this.currentParams = smoothParams(this.currentParams, targetParams, 0.015)
    const params = this.currentParams

    const breath = Math.sin(time * params.breathSpeed) * 0.5 + 0.5
    const pulse = Math.max(0, Math.sin(time * params.pulseSpeed)) ** 3 * params.pulseStrength

    this.camYaw += params.autoRotateSpeed
    const yawSin = Math.sin(this.camYaw)
    const yawCos = Math.cos(this.camYaw)
    const camDist = 2.0
    const focal = this.variant === 'conch' ? 1.34 : 1.5
    const canvasW = this.canvas.width || 1
    const canvasH = this.canvas.height || 1
    const aspect = canvasW / canvasH

    // Discharge logic
    const baseSlot = Math.floor(time / params.dischargeFrequency) >>> 0
    const slotSeed = hashU32(baseSlot)
    const intervalVariation = ((slotSeed % 1000) / 1000 - 0.5) * 0.4
    const intervalForSlot = params.dischargeFrequency * (1 + intervalVariation)
    const slotProgressRaw = time % intervalForSlot
    const flashDuration = params.dischargeDuration
    const flashDecay = slotProgressRaw < flashDuration
      ? ((1 - slotProgressRaw / flashDuration) ** 2) * (1 - (slotProgressRaw / flashDuration) * 0.5)
      : 0

    // Flash particle set
    const flashParticles = new Set<number>()
    if (flashDecay > 0) {
      const count = Math.floor(15 + params.dischargeIntensity * 10)
      let rng = hashU32(baseSlot + 12345)
      for (let k = 0; k < count; k++) {
        rng = hashU32(rng + k)
        flashParticles.add(rng % PARTICLE_COUNT)
      }
    }

    // Project particles
    const instanceData = new Float32Array(PARTICLE_COUNT * 4)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = this.particles[i]
      const oscillation = Math.sin(time * p.speed + p.phase)
      const breathScale = 1 + breath * params.breathStrength + oscillation * 0.03
      const jitter = Math.cos(time * p.speed * 2 + p.phase) * 0.01
      const x = p.basePos[0] * breathScale + jitter
      const y = p.basePos[1] * breathScale
      const z = p.basePos[2] * breathScale + jitter

      const rotatedX = x * yawCos - z * yawSin
      const rotatedZ = x * yawSin + z * yawCos
      const cameraZ = Math.max(0.2, rotatedZ + camDist)

      const ndcX = (rotatedX / cameraZ * focal / aspect) + (this.variant === 'conch' ? 0.03 : 0)
      const ndcY = (y / cameraZ * focal) + (this.variant === 'conch' ? 0.02 : 0)
      const depthBrightness = Math.min(1.2, Math.max(0.4, 1.4 - cameraZ / camDist))

      const particleFlash = flashDecay > 0 && flashParticles.has(i) ? flashDecay * 1.2 : 0
      const brightness = p.brightness * depthBrightness * (0.5 + pulse * 0.5 + Math.abs(oscillation) * 0.3) + particleFlash

      const offset = i * 4
      instanceData[offset] = ndcX
      instanceData[offset + 1] = ndcY
      instanceData[offset + 2] = cameraZ
      instanceData[offset + 3] = brightness
    }
    this.device.queue.writeBuffer(this.instanceBuffer, 0, instanceData)

    // Project connections
    const lineData = new Float32Array(this.connections.length * 2 * 4)
    let lineVertexCount = 0
    const flashConns = new Set<number>()
    if (flashDecay > 0) {
      const count = Math.floor(5 + params.dischargeIntensity * 3)
      let rng = hashU32(baseSlot + 99999)
      for (let k = 0; k < count; k++) {
        rng = hashU32(rng + k)
        flashConns.add(rng % this.connections.length)
      }
    }

    for (let ci = 0; ci < this.connections.length; ci++) {
      const [ai, bi] = this.connections[ci]
      const aOff = ai * 4
      const bOff = bi * 4
      const connPhase = Math.max(0, Math.sin(ai * 0.1 + time * 3.0))
      let alpha = 0.03 + connPhase * params.connectionStrength * (0.25 + pulse)

      if (flashDecay > 0 && flashConns.has(ci)) {
        alpha += flashDecay * (0.6 + pulse * 0.8) * params.connectionStrength * 3.0
      }

      const off = lineVertexCount * 4
      lineData[off] = instanceData[aOff]
      lineData[off + 1] = instanceData[aOff + 1]
      lineData[off + 2] = 0
      lineData[off + 3] = alpha
      lineData[off + 4] = instanceData[bOff]
      lineData[off + 5] = instanceData[bOff + 1]
      lineData[off + 6] = 0
      lineData[off + 7] = alpha * 0.5
      lineVertexCount += 2
    }
    this.device.queue.writeBuffer(this.lineBuffer, 0, lineData.subarray(0, lineVertexCount * 4))

    // Update globals uniform
    const globals = new Float32Array(12) // 48 bytes = 12 floats
    globals[0] = params.baseColor[0]
    globals[1] = params.baseColor[1]
    globals[2] = params.baseColor[2]
    globals[3] = 1.0
    globals[4] = params.pulseColor[0]
    globals[5] = params.pulseColor[1]
    globals[6] = params.pulseColor[2]
    globals[7] = 1.0
    globals[8] = time
    globals[9] = breath
    globals[10] = pulse
    globals[11] = params.dischargeIntensity
    this.device.queue.writeBuffer(this.globalsBuffer, 0, globals)

    // Render
    const textureView = this.context.getCurrentTexture().createView()
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    })

    // Draw connection lines
    pass.setPipeline(this.linePipeline)
    pass.setBindGroup(0, this.globalsBindGroup)
    pass.setVertexBuffer(0, this.lineBuffer)
    pass.draw(lineVertexCount)

    // Draw particles
    pass.setPipeline(this.particlePipeline)
    pass.setBindGroup(0, this.globalsBindGroup)
    pass.setVertexBuffer(0, this.instanceBuffer)
    pass.draw(6, PARTICLE_COUNT)

    pass.end()
    this.device.queue.submit([encoder.finish()])
  }
}
