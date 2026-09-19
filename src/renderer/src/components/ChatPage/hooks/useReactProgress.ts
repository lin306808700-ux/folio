import { useState, useEffect, useRef } from 'react'

export interface ReactStep {
  step: number
  thought: string
  action: string
  input: string
  status: 'running' | 'done' | 'error'
  observation?: string
}

export interface ReactArtifact {
  id: string
  filePath: string
  type: string
  description: string
}

export interface ReactProgress {
  active: boolean
  command: string
  steps: ReactStep[]
  done: boolean
  aborted?: boolean
  error?: string
  answer?: string
  artifacts: ReactArtifact[]
}

export function useReactProgress() {
  const [progress, setProgress] = useState<ReactProgress>({
    active: false,
    command: '',
    steps: [],
    done: false,
    artifacts: [],
  })
  const stepsRef = useRef<ReactStep[]>([])

  useEffect(() => {
    const api = (window as any).electronAPI?.react
    if (!api) return

    const cleanupStart = api.onStart((data: { command: string }) => {
      stepsRef.current = []
      setProgress({
        active: true,
        command: data.command,
        steps: [],
        done: false,
        artifacts: [],
      })
    })

    const cleanupStep = api.onStep((data: { step: number; thought: string; action: string; input: string }) => {
      const newStep: ReactStep = {
        step: data.step,
        thought: data.thought,
        action: data.action,
        input: data.input || '',
        status: 'running',
      }
      stepsRef.current = [...stepsRef.current.map(s => ({ ...s, status: 'done' as const })), newStep]
      setProgress(prev => ({ ...prev, steps: stepsRef.current }))
    })

    const cleanupObs = api.onObservation((data: { step: number; observation: string; success: boolean }) => {
      stepsRef.current = stepsRef.current.map(s =>
        s.step === data.step
          ? { ...s, observation: data.observation, status: data.success ? 'done' : 'error' }
          : s
      )
      setProgress(prev => ({ ...prev, steps: stepsRef.current }))
    })

    const cleanupDone = api.onDone((data: { answer?: string; error?: string; aborted?: boolean; totalSteps?: number; artifacts?: ReactArtifact[]; command?: string }) => {
      stepsRef.current = stepsRef.current.map(s => ({ ...s, status: 'done' as const }))
      setProgress(prev => ({
        ...prev,
        steps: stepsRef.current,
        done: true,
        aborted: data.aborted || false,
        answer: data.answer,
        error: data.error,
        command: data.command || prev.command,
        artifacts: data.artifacts || [],
      }))
    })

    return () => {
      cleanupStart?.()
      cleanupStep?.()
      cleanupObs?.()
      cleanupDone?.()
    }
  }, [])

  const reset = () => {
    stepsRef.current = []
    setProgress({ active: false, command: '', steps: [], done: false, artifacts: [] })
  }

  return { progress, reset }
}
