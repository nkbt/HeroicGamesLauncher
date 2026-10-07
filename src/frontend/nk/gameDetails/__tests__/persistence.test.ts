import { IndexedDbPersistence, waitForPersistence } from '../persistence'

function setup() {
  let aborted = false
  const transaction = {
    oncomplete: null as (() => void) | null,
    onabort: null as (() => void) | null,
    onerror: null as (() => void) | null,
    objectStore: () => ({
      clear: jest.fn(),
      put: jest.fn(),
      delete: jest.fn()
    }),
    abort: jest.fn(() => {
      aborted = true
      transaction.onabort?.()
    })
  }
  const db = { transaction: jest.fn(() => transaction) }
  const request = { result: db, onsuccess: null as (() => void) | null }
  const factory = { open: jest.fn(() => request) }
  const persistence = new IndexedDbPersistence(factory as unknown as IDBFactory)
  return { persistence, db, request, transaction, aborted: () => aborted }
}

test('cancellation before database open prevents a late destructive clear transaction', async () => {
  const t = setup()
  const controller = new AbortController()
  const clear = t.persistence.clear(controller.signal)
  controller.abort()
  await expect(clear).rejects.toThrow('cancelled')
  t.request.onsuccess?.()
  await Promise.resolve()
  expect(t.db.transaction).not.toHaveBeenCalled()
})

test('cancellation aborts an active clear transaction before ordinary writes can resume', async () => {
  const t = setup()
  const controller = new AbortController()
  const clear = t.persistence.clear(controller.signal)
  t.request.onsuccess?.()
  await Promise.resolve()
  await Promise.resolve()
  expect(t.db.transaction).toHaveBeenCalledTimes(1)
  controller.abort()
  await expect(clear).rejects.toThrow()
  expect(t.aborted()).toBe(true)
  expect(t.transaction.abort).toHaveBeenCalledTimes(1)
})

test('already-cancelled work is still observed when it rejects later', async () => {
  const controller = new AbortController()
  controller.abort()
  let reject!: (error: Error) => void
  const work = new Promise<void>((_resolve, fail) => {
    reject = fail
  })
  await expect(waitForPersistence(work, controller.signal)).rejects.toThrow(
    'cancelled'
  )
  reject(Error('late failure'))
  await Promise.resolve()
})

test('an abandoned write waiting for open cannot create a late transaction', async () => {
  const t = setup()
  const controller = new AbortController()
  const write = t.persistence.putMany(
    [['gog:game-a', { slots: {} }]],
    controller.signal
  )
  controller.abort()
  await expect(write).rejects.toThrow('cancelled')
  t.request.onsuccess?.()
  await Promise.resolve()
  expect(t.db.transaction).not.toHaveBeenCalled()
})

test('an abandoned active write transaction is aborted before recovery', async () => {
  const t = setup()
  const controller = new AbortController()
  const write = t.persistence.putMany(
    [['gog:game-a', { slots: {} }]],
    controller.signal
  )
  t.request.onsuccess?.()
  await Promise.resolve()
  await Promise.resolve()
  controller.abort()
  await expect(write).rejects.toThrow()
  expect(t.transaction.abort).toHaveBeenCalledTimes(1)
})

test('an abandoned delete transaction is aborted before recovery', async () => {
  const t = setup()
  const controller = new AbortController()
  const deleting = t.persistence.deleteMany(['gog:game-a'], controller.signal)
  t.request.onsuccess?.()
  await Promise.resolve()
  await Promise.resolve()
  controller.abort()
  await expect(deleting).rejects.toThrow()
  expect(t.transaction.abort).toHaveBeenCalledTimes(1)
})
