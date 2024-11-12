'use strict'

const { describe, test } = require('node:test')
const { deepStrictEqual, notEqual, equal } = require('node:assert')
const { once } = require('node:events')
const MemoryCacheStore = require('../../lib/cache/memory-cache-store')

cacheStoreTests(MemoryCacheStore)

/**
 * @param {import('../../types/cache-interceptor.d.ts').default.CacheStore} CacheStore
 */
function cacheStoreTests (CacheStore) {
  describe(CacheStore.prototype.constructor.name, () => {
    test('matches interface', async () => {
      const store = new CacheStore()
      equal(typeof store.isFull, 'boolean')
      equal(typeof store.get, 'function')
      equal(typeof store.createWriteStream, 'function')
      equal(typeof store.deleteByKey, 'function')
    })

    // Checks that it can store & fetch different responses
    test('basic functionality', async () => {
      const request = {
        origin: 'localhost',
        path: '/',
        method: 'GET',
        headers: {}
      }
      const requestValue = {
        statusCode: 200,
        statusMessage: '',
        rawHeaders: [Buffer.from('1'), Buffer.from('2'), Buffer.from('3')],
        cachedAt: Date.now(),
        staleAt: Date.now() + 10000,
        deleteAt: Date.now() + 20000
      }
      const requestBody = ['asd', '123']

      /**
       * @type {import('../../types/cache-interceptor.d.ts').default.CacheStore}
       */
      const store = new CacheStore()

      // Sanity check
      equal(store.get(request), undefined)

      // Write the response to the store
      let writeStream = store.createWriteStream(request, requestValue)
      notEqual(writeStream, undefined)
      writeResponse(writeStream, requestBody)

      // Now try fetching it with a deep copy of the original request
      let readResult = store.get(structuredClone(request))
      notEqual(readResult, undefined)

      deepStrictEqual(await readResponse(readResult), {
        ...requestValue,
        body: requestBody
      })

      // Now let's write another request to the store
      const anotherRequest = {
        origin: 'localhost',
        path: '/asd',
        method: 'GET',
        headers: {}
      }
      const anotherValue = {
        statusCode: 200,
        statusMessage: '',
        rawHeaders: [Buffer.from('1'), Buffer.from('2'), Buffer.from('3')],
        cachedAt: Date.now(),
        staleAt: Date.now() + 10000,
        deleteAt: Date.now() + 20000
      }
      const anotherBody = ['asd2', '1234']

      // We haven't cached this one yet, make sure it doesn't confuse it with
      //  another request
      equal(store.get(anotherRequest), undefined)

      // Now let's cache it
      writeStream = store.createWriteStream(anotherRequest, {
        ...anotherValue,
        body: []
      })
      notEqual(writeStream, undefined)
      writeResponse(writeStream, anotherBody)

      readResult = store.get(anotherRequest)
      notEqual(readResult, undefined)
      deepStrictEqual(await readResponse(readResult), {
        ...anotherValue,
        body: anotherBody
      })
    })

    test('returns stale response if possible', async () => {
      const request = {
        origin: 'localhost',
        path: '/',
        method: 'GET',
        headers: {}
      }
      const requestValue = {
        statusCode: 200,
        statusMessage: '',
        rawHeaders: [Buffer.from('1'), Buffer.from('2'), Buffer.from('3')],
        cachedAt: Date.now() - 10000,
        staleAt: Date.now() - 1,
        deleteAt: Date.now() + 20000
      }
      const requestBody = ['part1', 'part2']

      /**
       * @type {import('../../types/cache-interceptor.d.ts').default.CacheStore}
       */
      const store = new CacheStore()

      const writeStream = store.createWriteStream(request, requestValue)
      notEqual(writeStream, undefined)
      writeResponse(writeStream, requestBody)

      const readResult = store.get(request)
      deepStrictEqual(await readResponse(readResult), {
        ...requestValue,
        body: requestBody
      })
    })

    test('doesn\'t return response past deletedAt', async () => {
      const request = {
        origin: 'localhost',
        path: '/',
        method: 'GET',
        headers: {}
      }
      const requestValue = {
        statusCode: 200,
        statusMessage: '',
        cachedAt: Date.now() - 20000,
        staleAt: Date.now() - 10000,
        deleteAt: Date.now() - 5
      }
      const requestBody = ['part1', 'part2']

      /**
       * @type {import('../../types/cache-interceptor.d.ts').default.CacheStore}
       */
      const store = new CacheStore()

      const writeStream = store.createWriteStream(request, requestValue)
      notEqual(writeStream, undefined)
      writeResponse(writeStream, requestBody)

      equal(store.get(request), undefined)
    })

    test('respects vary directives', async () => {
      const request = {
        origin: 'localhost',
        path: '/',
        method: 'GET',
        headers: {
          'some-header': 'hello world'
        }
      }
      const requestValue = {
        statusCode: 200,
        statusMessage: '',
        rawHeaders: [Buffer.from('1'), Buffer.from('2'), Buffer.from('3')],
        vary: {
          'some-header': 'hello world'
        },
        cachedAt: Date.now(),
        staleAt: Date.now() + 10000,
        deleteAt: Date.now() + 20000
      }
      const requestBody = ['part1', 'part2']

      /**
       * @type {import('../../types/cache-interceptor.d.ts').default.CacheStore}
       */
      const store = new CacheStore()

      // Sanity check
      equal(store.get(request), undefined)

      const writeStream = store.createWriteStream(request, requestValue)
      notEqual(writeStream, undefined)
      writeResponse(writeStream, requestBody)

      const readStream = store.get(structuredClone(request))
      notEqual(readStream, undefined)
      deepStrictEqual(await readResponse(readStream), {
        ...requestValue,
        body: requestBody
      })

      const nonMatchingRequest = {
        origin: 'localhost',
        path: '/',
        method: 'GET',
        headers: {
          'some-header': 'another-value'
        }
      }
      equal(store.get(nonMatchingRequest), undefined)
    })
  })
}

test('MemoryCacheStore locks values properly', async () => {
  const store = new MemoryCacheStore()

  const request = {
    origin: 'localhost',
    path: '/',
    method: 'GET',
    headers: {}
  }

  const requestValue = {
    statusCode: 200,
    statusMessage: '',
    rawHeaders: [Buffer.from('1'), Buffer.from('2'), Buffer.from('3')],
    cachedAt: Date.now(),
    staleAt: Date.now() + 10000,
    deleteAt: Date.now() + 20000
  }

  const writable = store.createWriteStream(request, requestValue)
  notEqual(writable, undefined)

  // Value should now be locked, we shouldn't be able to create a readable or
  //  another writable to it until the first one finishes
  equal(store.get(request), undefined)
  equal(store.createWriteStream(request, requestValue), undefined)

  // Close the writable, this should unlock it
  writeResponse(writable, ['asd'])

  // Stream is now closed, let's lock any new write streams
  const result = store.get(request)
  notEqual(result, undefined)

  // Consume & close the result, this should lift the write lock
  await readResponse(result)

  notEqual(store.createWriteStream(request, requestValue), undefined)
})

/**
 * @param {import('node:stream').Writable} stream
 * @param {string[]} body
 */
function writeResponse (stream, body) {
  for (const chunk of body) {
    stream.write(Buffer.from(chunk))
  }

  stream.end()
}

/**
 * @param {import('../../types/cache-interceptor.d.ts').default.GetResult} result
 * @returns {Promise<import('../../types/cache-interceptor.d.ts').default.GetResult | { body: Buffer[] }>}
 */
async function readResponse ({ response, body: stream }) {
  notEqual(response, undefined)
  notEqual(stream, undefined)

  /**
   * @type {Buffer[]}
   */
  const body = []
  stream.on('data', chunk => {
    body.push(chunk.toString())
  })

  await once(stream, 'end')

  return {
    ...response,
    body
  }
}
