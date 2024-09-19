import Dispatcher from './dispatcher'

export default CacheHandler

declare namespace CacheHandler {
  export interface CacheOptions {
    store?: CacheStore

    /**
     * The methods to cache
     * Note we can only cache safe methods. Unsafe methods (i.e. PUT, POST)
     *  invalidate the cache for a origin.
     * @see https://www.rfc-editor.org/rfc/rfc9111.html#name-invalidating-stored-respons
     * @see https://www.rfc-editor.org/rfc/rfc9110#section-9.2.1
     */
    methods?: ('GET' | 'HEAD' | 'OPTIONS' | 'TRACE')[]
  }

  /**
   * Underlying storage provider for cached responses
   */
  export interface CacheStore {
    /**
     * The amount of responses that are being cached
     */
    get entryCount(): number

    /**
     * The max amount of entries this cache can hold. If the size is greater
     *  than or equal to this, new responses will not be cached.
     * @default Infinity
     */
    get maxEntries(): number

    /**
     * The max size of each value. If the content-length header is greater than
     *  this or the response ends up over this, new responses will not be cached
     * @default Infinity
     */
    get maxEntrySize(): number

    /**
     * Get a request's cached response if it exists.
     * Note: it is the cache store's responsibility to enforce the vary header checks
     */
    get(key: Dispatcher.RequestOptions): CacheStoreValue | Promise<CacheStoreValue | undefined> | undefined;

    /**
     * Add a new request to the cache
     * @param key
     * @param opts
     */
    put(key: Dispatcher.RequestOptions, value: CacheStoreValue): void | Promise<void>;

    /**
     * Delete all of the cached responses from a certain origin (host)
     */
    deleteByOrigin(origin: string): void | Promise<void>
  }

  export interface CacheStoreValue {
    /**
     * True if the response is complete, otherwise the request is still in-flight
     */
    complete: boolean;
    statusCode: number;
    statusMessage: string;
    rawHeaders: Buffer[];
    rawTrailers?: Buffer[];
    body: Buffer[]
    /**
     * Headers defined by the Vary header and their respective values for
     *  later comparison
     */
    vary?: Record<string, string>;
    /**
     * Actual size of the response (i.e. size of headers + body + trailers)
     */
    size: number;
    /**
     * Time in millis that this value was cached
     */
    cachedAt: number;
    /**
     * Time in millis that this value is considered stale
     */
    staleAt: number;
    /**
     * Time in millis that this value is to be deleted from the cache. This is
     *  either the same as staleAt or the `max-stale` caching directive.
     */
    deleteAt: number;
  }

  export interface MemoryCacheStoreOpts {
    /**
     * @default Infinity
     */
    maxEntries?: number
    /**
     * @default Infinity
     */
    maxEntrySize?: number
  }

  export class MemoryCacheStore implements CacheStore {
    constructor (opts?: MemoryCacheStoreOpts)

    get entryCount (): number
    get maxEntries (): number
    get maxEntrySize (): number

    get (key: Dispatcher.RequestOptions): CacheStoreValue | undefined
    put (key: Dispatcher.RequestOptions, opts: CacheStoreValue): void
    deleteByOrigin (origin: string): void
  }
}
