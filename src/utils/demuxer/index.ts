import { AudioMeta, VideoMeta, MediaTrackData } from '../demuxer/MSEFlvDemuxer'
import MSEFlvDemuxer from '../demuxer/MSEFlvDemuxer'
import MediaInfo from './mediaInfo'

interface DemuxerConfig {
  hasAudio?: boolean
  hasVideo?: boolean
  ignoreNaluTypes?: number[]
}

export type MediaType = 'audio' | 'video'

export interface StreamData {
  data: Uint8Array
  first: boolean
  currentUrl: string
  isPre: boolean
}

export class DemuxedSourceData {
  type?: MediaType
  timeStamp?: number // timeStamp === pts
  dts?: number
  streamId?: number
  chunk?: Uint8Array
  chunkLength?: number
  firstPts?: number
  isKeyFrame?: boolean
  originalTimeStamp?: number
  cts?: number // pts = dts + cts
  frameType?: 'I' | 'P' | 'B'
}

export interface DemuxerEventMap {
  error: (...args: any[])=> void
  mediaInfo: (evt: MediaInfo) => void
  metaData: <T extends MediaType = MediaType>(type: T, data: T extends 'audio' ? AudioMeta : VideoMeta) => void
  scriptData: (evt: any) => void
  mediaData: (type: MediaType, data: DemuxedSourceData[]) => void
  trackData: <T extends MediaType>(type: T, data: MediaTrackData<T>) => void
}

type DemuxerEventDist = {
  // [K in keyof DemuxerEventMap]: {callback: (...args: Parameters<DemuxerEventMap[K]>) => ReturnType<DemuxerEventMap[K]>; once: boolean}[]
  [K in keyof DemuxerEventMap]: {callback: DemuxerEventMap[K]; once: boolean}[]
}

class FlvDemuxer {
  _demuxer?: MSEFlvDemuxer
  firstChunk: boolean = true
  totalBytes: number = 0
  consumedChunk: Uint8Array = new Uint8Array(0)
  sampleRate: number = 0
  channelCount: number = 0
  ignoreNaluTypes: number[] = []
  inited = false

  _littleEndian = (function () {
    let buf = new ArrayBuffer(2)
    new DataView(buf).setInt16(0, 256, true) // little-endian write
    return new Int16Array(buf)[0] === 256 // platform-spec read, if equal then LE
  })()
  /**
   * 解析chunk
   * @param data
   */
  parseChunk(data: Uint8Array) {
    this.pushChunk(data)
  }

  initConfig(config: DemuxerConfig, probeDataU8: Uint8Array) {
    if (config.hasAudio !== undefined && this._demuxer) {
        this._demuxer.overridedHasAudio = config.hasAudio
    }
    if (config.hasVideo !== undefined && this._demuxer) {
        this._demuxer.overridedHasVideo = config.hasVideo
    }
    if (config.ignoreNaluTypes !== undefined) {
      this.ignoreNaluTypes = config.ignoreNaluTypes
    }
    let probeData = MSEFlvDemuxer.probe(probeDataU8.buffer)
    this._demuxer = new MSEFlvDemuxer(probeData, this.ignoreNaluTypes)
    
    this._demuxer.timestampBase = 0
    this._demuxer.onError = this._onDemuxException.bind(this)
    this._demuxer.onMediaInfo = this._onMediaInfo.bind(this)
    this._demuxer.onMetaDataArrived = this._onMetaDataArrived.bind(this) as unknown as typeof this._demuxer.onMetaDataArrived
    this._demuxer.onScriptDataArrived = this._onScriptDataArrived.bind(this)
    this.bindDataSource(this._demuxer)
    this.totalBytes = 0
    this.consumedChunk = new Uint8Array(0)
    this.inited = true
    this.pushChunk(probeDataU8)
  }

  pushChunk(data: Uint8Array) {
    if (!this._demuxer) {
        return
    }
    let startBytes = this.totalBytes - this.consumedChunk.length
    let temp = new Uint8Array(this.consumedChunk.length + data.length)
    temp.set(this.consumedChunk, 0)
    temp.set(data, this.consumedChunk.length)
    this._demuxer.clearTracks()
    let consumed = this._demuxer.parseChunks(temp.buffer, startBytes)
    this.consumedChunk = new Uint8Array(0)
    if (consumed < temp.length) {
      this.consumedChunk = temp.slice(consumed, temp.length)
    }
    this.totalBytes += data.length
  }

  bindDataSource(producer: MSEFlvDemuxer) {
    producer.onDataAvailable = this.demuxed.bind(this)
    producer.onTrackMetadata = this._onTrackMetadataReceived.bind(this)
    return this
  }

  addADTSHeader(sampleRate: number, channelCount: number, packet: Uint8Array) {
    var adtsHeader = new Uint8Array(7 + packet.length)

    var profile = 1 // AAC LC
    var frequencyIndex = this.getFrequencyIndex(sampleRate)
    var channelConfig = channelCount

    var frameLength = packet.length + 7 // Add the ADTS header length
    var adtsHeaderLength = frameLength

    adtsHeader[0] = 0xff // syncword
    adtsHeader[1] = 0xf1 // MPEG-2 AAC LC
    adtsHeader[2] = ((profile << 6) & 0xc0) | ((frequencyIndex << 2) & 0x3c) | ((channelConfig >> 2) & 0x01)
    adtsHeader[3] = ((channelConfig << 6) & 0xc0) | ((adtsHeaderLength >> 11) & 0x03)
    adtsHeader[4] = (adtsHeaderLength >> 3) & 0xff
    adtsHeader[5] = ((adtsHeaderLength << 5) & 0xe0) | 0x1f
    adtsHeader[6] = 0xfc
    adtsHeader.set(packet, 7)

    return adtsHeader
  }

  getFrequencyIndex(sampleRate: number) {
    var frequencies = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]
    for (var i = 0; i < frequencies.length; i++) {
      if (sampleRate === frequencies[i]) {
        return i
      }
    }
    throw new Error('Unsupported sample rate')
  }

  demuxed(audioTrack?: MediaTrackData<'audio'>, videoTrack?: MediaTrackData<'video'>) {
    // logger.debug(this.moduleName, `Receive demuxed event: ${JSON.stringify(audioTrack.samples)}, ${JSON.stringify(videoTrack.samples)} `)

    if (audioTrack && audioTrack.samples.length > 0) {
      if (this.hasEventListener('trackData')) {
        this._onTrackDataArrived({type: 'audio', data: audioTrack})
      }
      if (this.hasEventListener('mediaData')) {
        let audioArray: Array<DemuxedSourceData> = []
        audioTrack.samples.forEach((sample) => {
          let sourceData: DemuxedSourceData = new DemuxedSourceData()
          sourceData.chunk = this.addADTSHeader(this.sampleRate, this.channelCount, sample.unit)
          sourceData.chunkLength = sample.unit.length
          sourceData.isKeyFrame = true
          sourceData.streamId = audioTrack.id
          sourceData.timeStamp = sample.pts
          sourceData.dts = sample.dts
          sourceData.type = 'audio'
          audioArray.push(sourceData)
        })
        this._onMediaDataArrived({type: 'audio', data: audioArray})
      }
      
    }
    if (videoTrack && videoTrack.samples.length > 0) {
      if (this.hasEventListener('trackData')) {
        this._onTrackDataArrived({type: 'video', data: videoTrack})
      }
      if (this.hasEventListener('mediaData')) {
        let videoArray: Array<DemuxedSourceData> = []
        videoTrack.samples.forEach((sample) => {
          let sourceData: DemuxedSourceData = new DemuxedSourceData()
          let nalu = new Uint8Array(0)
          sample.units.forEach((unit) => {
            unit.data[0] = 0
            unit.data[1] = 0
            unit.data[2] = 0
            unit.data[3] = 1
            let tmp = new Uint8Array(nalu.length + unit.data.length)
            tmp.set(nalu)
            tmp.set(unit.data, nalu.length)
            nalu = tmp
            tmp = new Uint8Array(0)
          })
          sourceData.chunk = nalu
          sourceData.chunkLength = nalu.length
          sourceData.isKeyFrame = sample.isKeyframe
          sourceData.streamId = videoTrack.id
          sourceData.timeStamp = sample.pts
          sourceData.dts = sample.dts
          sourceData.type = 'video'
          videoArray.push(sourceData)
        })
        this._onMediaDataArrived({type: 'video', data: videoArray})
      }
    }
  }

  _onTrackMetadataReceived(type: 'audio', data: AudioMeta): void
  _onTrackMetadataReceived(type: 'video', data: VideoMeta): void
  _onTrackMetadataReceived(type: any, data: any) {
    if (type === 'audio') {
      if (data.audioSampleRate) {
        this.sampleRate = data.audioSampleRate
      }
      if (data.channelCount) {
        this.channelCount = data.channelCount
      }
      this._onMetaDataArrived({type: 'audio', data})
    } else if ('video' === type) {
      this._onMetaDataArrived({type: 'video', data})
    }
  }

  _onDemuxException(type: any, info: any) {
    this.emitEventListener('error', type, info)
  }

  _onMediaInfo(mediaInfo: MediaInfo) {
    this.emitEventListener('mediaInfo', mediaInfo)
  }

  _onMetaDataArrived<T extends MediaType = MediaType>(event: {type: T, data: T extends 'audio' ? AudioMeta : VideoMeta}) {
    this.emitEventListener('metaData', event.type, event.data)
  }

  _onScriptDataArrived(data: any) {
    this.emitEventListener('scriptData', data)
  }

  _onMediaDataArrived(event: {type: MediaType, data: DemuxedSourceData[]}) {
    this.emitEventListener('mediaData', event.type, event.data)
  }

  _onTrackDataArrived<T extends MediaType = MediaType>(event: {type: T, data: MediaTrackData<T>}) {
    this.emitEventListener('trackData', event.type, event.data)
  }

  stop(time: number) {
    // this._demuxer?.destroy()
    this.consumedChunk = new Uint8Array(0)
    this.totalBytes = 0
  }
  private _eventListenerDist: Partial<DemuxerEventDist> = {}
  addEventListener<T extends keyof DemuxerEventMap>(type: T, callback: DemuxerEventMap[T], option: {once: boolean} = {once: false}) {
    if(!this._eventListenerDist[type]) {
      this._eventListenerDist[type] = []
    }
    const item = {callback, once: option.once}
    this._eventListenerDist[type].push(item)
    return () => {
      const index = this._eventListenerDist[type]?.indexOf(item) ?? -1
      if (index > -1) {
        this._eventListenerDist[type]!.splice(index, 1)
      }
    }
  }

  hasEventListener<T extends keyof DemuxerEventMap>(type: T) {
    return !!this._eventListenerDist[type]?.length
  }

  emitEventListener<T extends keyof DemuxerEventMap>(type: T, ...payload: Parameters<DemuxerEventMap[T]>) {
    if (this._eventListenerDist[type]?.length) {
      const onceIndexs: number[] = []
      for (let i = 0; i < this._eventListenerDist[type].length; i++) {
        const item = this._eventListenerDist[type][i]
        if (item.once) {
          onceIndexs.unshift(i)
        }
        // item.callback.apply(null, payload)
        // item.callback(...payload)
        (item.callback as unknown as (...args: Parameters<DemuxerEventMap[T]>) => ReturnType<DemuxerEventMap[T]>)(...payload)
      }
    }
  }

  removeEventListener<T extends keyof DemuxerEventMap>(type: T, callback: DemuxerEventMap[T]) {
    if (this._eventListenerDist[type]?.length) {
      for (let i = this._eventListenerDist[type].length - 1; i > -1; i--) {
        const item = this._eventListenerDist[type][i]
        if (item.callback === callback) {
          this._eventListenerDist[type].splice(i, 1)
        }
      }
    }
  }
}

export default FlvDemuxer
