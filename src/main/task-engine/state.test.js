'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { TaskStateManager } = require('./state')
const { TaskExecutor } = require('./executor')

async function createFixture(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'task-state-'))
  t.after(() => fsp.rm(dir, { recursive: true, force: true }))
  return { dir, persistPath: path.join(dir, 'task-history.json') }
}

function makeTask(id, status = 'running') {
  return {
    id,
    plan: { id, originalInput: 'test', steps: [{ id: 'step-1', tool: 'command' }] },
    status,
    currentStepIndex: 0,
    pausedAtStep: 0,
    context: { 'step-1': { value: 42 } },
    results: [{ step: { id: 'step-1' }, result: { success: true, data: { value: 42 } } }],
    pendingConfirmation: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

test('persists full resumable state using an atomic replacement', async t => {
  const { dir, persistPath } = await createFixture(t)
  const manager = new TaskStateManager({ persistPath })
  t.after(() => manager.dispose())
  const task = makeTask('atomic-task')
  task.context.self = task.context
  manager.trackTask(task)
  manager._persistToDisk()

  const data = JSON.parse(fs.readFileSync(persistPath, 'utf8'))
  assert.equal(data.unfinishedTasks[0].context['step-1'].value, 42)
  assert.equal(data.unfinishedTasks[0].context.self, '[Circular]')
  assert.deepEqual(fs.readdirSync(dir).filter(name => name.includes('.tmp-')), [])
})

test('restores running tasks as paused with execution context intact', async t => {
  const { persistPath } = await createFixture(t)
  const writer = new TaskStateManager({ persistPath })
  t.after(() => writer.dispose())
  writer.trackTask(makeTask('resume-task'))
  writer._persistToDisk()

  const reader = new TaskStateManager({ persistPath })
  t.after(() => reader.dispose())
  const restored = reader.loadPersistedData()

  assert.equal(restored.length, 1)
  assert.equal(restored[0].status, 'paused')
  assert.equal(restored[0].pauseReason, 'restart')
  assert.equal(restored[0].context['step-1'].value, 42)
})

test('executor accepts restored paused tasks', () => {
  const executor = new TaskExecutor()
  const task = makeTask('executor-task', 'paused')

  assert.deepEqual(executor.restoreTasks([task]), { restored: 1 })
  assert.equal(executor.getTaskStatus(task.id).exists, true)
  assert.equal(executor.getTaskStatus(task.id).status, 'paused')
})

test('pause requests are isolated per concurrent task', () => {
  const executor = new TaskExecutor()
  const taskA = makeTask('task-a')
  const taskB = makeTask('task-b')
  executor.activeTasks.set(taskA.id, taskA)
  executor.activeTasks.set(taskB.id, taskB)

  assert.equal(executor.pause(taskA.id).success, true)
  assert.equal(executor._consumePauseRequest(taskB.id), false)
  assert.equal(executor._consumePauseRequest(taskA.id), true)
  assert.equal(executor._consumePauseRequest(taskA.id), false)
})

test('resume preserves a paused step index of zero', async () => {
  const executor = new TaskExecutor()
  const task = makeTask('step-zero', 'paused')
  task.pausedAtStep = 0
  task.currentStepIndex = 1
  executor.activeTasks.set(task.id, task)

  let resumedFrom = null
  executor._executeStepLoop = async (state, startIndex) => {
    resumedFrom = startIndex
    return { status: 'paused' }
  }

  await executor._retryFromPause(task.id)
  assert.equal(resumedFrom, 0)
})

test('cancelling an in-flight step prevents result commit and completion', async () => {
  const executor = new TaskExecutor()
  const task = makeTask('cancel-in-flight')
  task.results = []
  task.context = {}
  executor.activeTasks.set(task.id, task)

  let finishStep
  executor._executeStep = () => new Promise(resolve => { finishStep = resolve })
  const execution = executor._executeSingleStep(
    { id: 'step-1', type: 'execute', tool: 'command', method: 'execute', description: 'long step' },
    0,
    task,
    {}
  )

  assert.equal(executor.cancel(task.id).success, true)
  finishStep({ success: true, data: { shouldNotPersist: true } })
  const result = await execution

  assert.equal(result.status, 'cancelled')
  assert.deepEqual(task.results, [])
  assert.deepEqual(task.context, {})
})

test('rejecting a pending confirmation returns cancelled without throwing', async () => {
  const executor = new TaskExecutor()
  const task = makeTask('reject-confirmation', 'paused')
  task.pendingConfirmation = {
    step: { id: 'step-1', tool: 'command', method: 'execute' },
    result: { needConfirm: true }
  }
  executor.activeTasks.set(task.id, task)

  const result = await executor.confirmAndContinue(task.id, false)
  assert.equal(result.status, 'cancelled')
  assert.equal(executor.getTaskStatus(task.id).exists, false)
})

test('clearing one unfinished task records it as cancelled', async t => {
  const { persistPath } = await createFixture(t)
  const manager = new TaskStateManager({ persistPath })
  t.after(() => manager.dispose())
  manager.trackTask(makeTask('cancel-task', 'paused'))

  assert.equal(manager.clearUnfinishedTask('cancel-task').success, true)
  assert.equal(manager.getTaskHistory(1)[0].status, 'cancelled')
})
