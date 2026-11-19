/**
 * A simple pool for managing Web Workers.
 *
 * @three_import import { WorkerPool } from 'three/addons/utils/WorkerPool.js';
 */
export class WorkerPool {

	/**
	 * Constructs a new Worker pool.
	 *
	 * @param {number} [pool=4] - The size of the pool.
	 */
	constructor( pool = 4 ) {

		/**
		 * The size of the pool.
		 *
		 * @type {number}
		 * @default 4
		 */
		this.pool = pool;

		/**
		 * A message queue.
		 *
		 * @type {Array<Object>}
		 */
		this.queue = [];

		/**
		 * An array of Workers.
		 *
		 * @type {Array<Worker>}
		 */
		this.workers = [];

		/**
		 * An array with resolve functions for messages.
		 *
		 * @type {Array<Function>}
		 */
		this.workersResolve = [];
		this.workersReject = [];

		/**
		 * The current worker status.
		 *
		 * @type {number}
		 */
		this.workerStatus = 0;

		/**
		 * A factory function for creating workers.
		 *
		 * @type {?Function}
		 */
		this.workerCreator = null;

	}

	_initWorker( workerId ) {

		if ( ! this.workers[ workerId ] ) {

			const worker = this.workerCreator();
			worker.addEventListener( 'message', ( message ) => {

				if ( this.workers[ workerId ] === worker ) this._onMessage( workerId, message );

			} );
			worker.addEventListener( 'error', ( event ) => {

				if ( this.workers[ workerId ] === worker ) {

					this._failWorker( workerId, event.error ?? new Error( event.message || 'KTX2 worker failed' ) );

				}

			} );
			this.workers[ workerId ] = worker;

		}

	}

	_getIdleWorker() {

		for ( let i = 0; i < this.pool; i ++ )
			if ( ! ( this.workerStatus & ( 1 << i ) ) ) return i;

		return - 1;

	}

	_onMessage( workerId, msg ) {

		const resolve = this.workersResolve[ workerId ];
		this.workersResolve[ workerId ] = null;
		this.workersReject[ workerId ] = null;
		resolve && resolve( msg );

		if ( this.queue.length ) {

			this._send( workerId, this.queue.shift() );

		} else {

			this.workerStatus &= ~( 1 << workerId );

		}

	}

	// HGame: settle promises when a worker cannot receive or process its job.
	_failWorker( workerId, error ) {

		this.workers[ workerId ]?.terminate();
		this.workers[ workerId ] = null;
		this.workersReject[ workerId ]?.( error );
		this.workersResolve[ workerId ] = null;
		this.workersReject[ workerId ] = null;
		this.workerStatus &= ~( 1 << workerId );
		for ( const job of this.queue.splice( 0 ) ) job.reject( error );

	}

	_send( workerId, { resolve, reject, msg, transfer } ) {

		this.workersResolve[ workerId ] = resolve;
		this.workersReject[ workerId ] = reject;
		this.workerStatus |= 1 << workerId;
		try {

			this._initWorker( workerId );
			this.workers[ workerId ].postMessage( msg, transfer );

		} catch ( error ) {

			this._failWorker( workerId, error );

		}

	}

	/**
	 * Sets a function that is responsible for creating Workers.
	 *
	 * @param {Function} workerCreator - The worker creator function.
	 */
	setWorkerCreator( workerCreator ) {

		this.workerCreator = workerCreator;

	}

	/**
	 * Sets the Worker limit
	 *
	 * @param {number} pool - The size of the pool.
	 */
	setWorkerLimit( pool ) {

		this.pool = pool;

	}

	/**
	 * Post a message to an idle Worker. If no Worker is available,
	 * the message is pushed into a message queue for later processing.
	 *
	 * @param {Object} msg - The message.
	 * @param {Array<ArrayBuffer>} transfer - An array with array buffers for data transfer.
	 * @return {Promise} A Promise that resolves when the message has been processed.
	 */
	postMessage( msg, transfer ) {

		return new Promise( ( resolve, reject ) => {

			const workerId = this._getIdleWorker();
			const job = { resolve, reject, msg, transfer };

			if ( workerId !== - 1 ) {

				this._send( workerId, job );

			} else {

				this.queue.push( job );

			}

		} );

	}

	/**
	 * Terminates all Workers of this pool. Call this  method whenever this
	 * Worker pool is no longer used in your app.
	 */
	dispose() {

		const error = new Error( 'KTX2 worker pool disposed' );
		this.workers.forEach( ( worker ) => worker?.terminate() );
		this.workersReject.forEach( ( reject ) => reject?.( error ) );
		for ( const job of this.queue ) job.reject( error );
		this.workersResolve.length = 0;
		this.workersReject.length = 0;
		this.workers.length = 0;
		this.queue.length = 0;
		this.workerStatus = 0;

	}

}
