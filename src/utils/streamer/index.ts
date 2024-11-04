export default class Streamer {
  url = ''
  _validAbortController?: AbortController
  _abortController?: AbortController
  async isValid(url: string, timeout = 1000) {
    if (this._validAbortController && !this._validAbortController.signal.aborted) {
      this._validAbortController.abort('repeat')
    }
    this._validAbortController = new AbortController()
    return new Promise<{status: string; reason: string}>(resolve => {
      let timer: null | NodeJS.Timeout = setTimeout(() => {
        timer = null
        resolve({
          status: 'timeout',
          reason: ''
        })
      }, timeout)
      fetch(url, {
        method: 'HEAD',
        signal: this._validAbortController!.signal
      }).then(res => {
        if (res.status === 200) {
          resolve({
            status: 'successed',
            reason: ''
          }) 
        } else {
          resolve({
            status: 'failed',
            reason: `${res.status}`
          })
        }
      }).catch((err: Error) => {
        if (err.name === 'AbortError') {
          resolve({
            status: 'cancel',
            reason: err.message
          })
        } else {
          resolve({
            status: 'error',
            reason: err.message
          })
        }
      }).finally(() => {
        if (timer !== null) {
          clearTimeout(timer)
          timer = null
        }
      })
    })
  }
  start(url: string, callback: (data: Uint8Array) => void, onerror: (err: Error) => void) {
    if (this._abortController && !this._abortController.signal.aborted) {
      this._abortController.abort()
    }
    this._abortController = new AbortController()
    const signal = this._abortController.signal
    const getError = (name: string, message: string) => {
      if (signal === this._abortController?.signal) {
        this._abortController = undefined
      }
      const error = new Error(message)
      error.name = name
      return error
    }
    fetch(url, {signal: this._abortController.signal}).then(res => {
      const reader = res.body?.getReader()
      const readNext = () => {
        reader?.read().then(({done, value}) => {
          if (done) {
            onerror(getError('StreamEnd', 'stream done'))
          } else {
            callback(value)
            readNext()
          }
        }).catch(err => {
          onerror(err)
        })
      }
      readNext()
      if (!reader) {
        onerror(getError('StreamError', 'fetch body is not reader'))
      }
    }).catch((err: Error) => {
      if (err.name === 'AbortError') {
        onerror(getError('StreamAbort', err.message))
      } else {
        onerror(getError('StreamError', err.message))
      }
    })
  }
  stop() {
    if (this._abortController && !this._abortController.signal.aborted) {
      try {
        this._abortController.abort()
      } catch (err) {
        console.log(err)
      }
      this._abortController = undefined
    }
  }
}