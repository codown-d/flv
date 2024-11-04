import AMF, { PraseValueDataType } from './amfParser'
import SpsParser from './spsParser'
import MediaInfo from './mediaInfo'
import { IllegalStateException } from './exception'
import { MediaType } from '.'

export interface AudioMeta {
  type: string
  id?: number
  timescale?: number
  duration?: number
  audioSampleRate?: number
  config?: number[]
  channelCount?: number
  codec?: string
  originalCodec?: string
  refSampleDuration?: number
  extra_data?: Uint8Array
}

export interface VideoMeta {
  type: string // 'video' | 'audio'
  id: number
  timescale: number
  duration: number
  codecWidth: number
  codecHeight: number
  presentWidth: number
  presentHeight: number
  profile: string
  level: string
  bitDepth: number
  chromaFormat: number
  sarRatio: {
    width: number
    height: number
  }
  frameRate: {
    fixed: boolean
    fps: number
    fps_den: number
    fps_num: number
  }
  codec: string
  decoderType: string
  spspps: Uint8Array
  avcc: Uint8Array
  refSampleDuration: number
  extra_data: Uint8Array
}

interface Unit {
  type: number
  data: Uint8Array
}

interface VideoData {
  units: Unit[]
  length: number
  isKeyframe: boolean
  dts: number
  cts: number
  pts: number
  frameType: string
  fileposition: number
}

interface AudioData {
  pts?: number
  dts?: number
  length?: number
  unit: Uint8Array
}

export interface MediaTrackData<T extends MediaType> {
  type: string
  id: number
  sequenceNumber: number
  samples: (T extends 'video' ? VideoData : AudioData)[]
  length: number
}

type AACAudioDataType<T extends 0 | 1 = 0 | 1> = {
  packetType: T
  data: T extends 0 ? ReturnType<MSEFlvDemuxer['_parseAACAudioSpecificConfig']> : Uint8Array
}

function ReadBig32(array: Uint8Array, index: number) {
  return (array[index] << 24) | (array[index + 1] << 16) | (array[index + 2] << 8) | array[index + 3]
}

const DemuxErrors = {
  OK: 'OK',
  FORMAT_ERROR: 'FormatError',
  FORMAT_UNSUPPORTED: 'FormatUnsupported',
  CODEC_UNSUPPORTED: 'CodecUnsupported',
}

export interface ProbeData {
  match: boolean,
  consumed?: number,
  dataOffset?: number,
  hasAudioTrack?: boolean,
  hasVideoTrack?: boolean,
}

export default class MSEFlvDemuxer {
  TAG: String = 'MSEFlvDemuxer'
  moduleName = 'MSEFlvDemuxer'
  _onMediaInfo = (_evt: MediaInfo) => {}
  _onMetaDataArrived = (_evt: PraseValueDataType) => {}
  _onScriptDataArrived = (_evt: Record<string, PraseValueDataType>) => {}
  _onTrackMetadata(_type: 'audio', _evt: AudioMeta): void
  _onTrackMetadata(_type: 'video', _evt: VideoMeta): void
  _onTrackMetadata(_type: 'audio' | 'video', _evt: AudioMeta | VideoMeta){}
  _onDataAvailable = (_audioTrack?: MediaTrackData<'audio'>, _videoTrack?: MediaTrackData<'video'>) => {}
  _dataOffset: number
  _firstParse = true
  _dispatch = false
  _hasAudio: boolean
  _hasVideo: boolean
  _hasAudioFlagOverrided: boolean = false
  _hasVideoFlagOverrided: boolean = false
  _audioInitialMetadataDispatched: boolean = false
  _videoInitialMetadataDispatched: boolean = false
  _mediaInfo: MediaInfo
  _metadata: Record<string, PraseValueDataType> = {}
  _audioMetadata?: AudioMeta
  _videoMetadata?: VideoMeta
  _naluLengthSize = 4
  _timestampBase = 0 // int32, in milliseconds
  _timescale = 1000
  _duration = 0 // int32, in milliseconds
  _durationOverrided = false
  _referenceFrameRate = {
    fixed: true,
    fps: 23.976,
    fps_num: 23976,
    fps_den: 1000,
  }
  _flvSoundRateTable = [5500, 11025, 22050, 44100, 48000]
  _mpegSamplingRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]
  _mpegAudioV10SampleRateTable = [44100, 48000, 32000, 0]
  _mpegAudioV20SampleRateTable = [22050, 24000, 16000, 0]
  _mpegAudioV25SampleRateTable = [11025, 12000, 8000, 0]
  _mpegAudioL1BitRateTable = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, -1]
  _mpegAudioL2BitRateTable = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, -1]
  _mpegAudioL3BitRateTable = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1]
  _videoTrack?: MediaTrackData<'video'> = { type: 'video', id: 1, sequenceNumber: 0, samples: [], length: 0 }
  _audioTrack?: MediaTrackData<'audio'> = { type: 'audio', id: 2, sequenceNumber: 0, samples: [], length: 0 }
  _littleEndian: boolean
  lastIDROrPFramePts = 0
  lastIDROrBframeDts = 0
  groupBFrameMaxPts = 0
  groupBFrameMaxDts = 0
  videoDuration = 0
  bframeCount = 0
  ignoreNaluTypes: number[] = []

  constructor(probeData: ProbeData, ignoreNaluTypes?: number[]) {
    this._dataOffset = probeData.dataOffset || 0
    this._hasAudio = probeData.hasAudioTrack || false
    this._hasVideo = probeData.hasVideoTrack || false

    this._mediaInfo = new MediaInfo()
    this._mediaInfo.hasAudio = this._hasAudio
    this._mediaInfo.hasVideo = this._hasVideo
    this._littleEndian = (function () {
      let buf = new ArrayBuffer(2)
      new DataView(buf).setInt16(0, 256, true) // little-endian write
      return new Int16Array(buf)[0] === 256 // platform-spec read, if equal then LE
    })()
    this.ignoreNaluTypes = ignoreNaluTypes || []
  }

  _onError(..._args: string[]) {}

  destroy() {
    this._mediaInfo = new MediaInfo()
    this._metadata = {}
    this._audioMetadata = undefined
    this._videoMetadata = undefined
    this._videoTrack = undefined
    this._audioTrack = undefined
    this._onMediaInfo = () => {}
    this._onMetaDataArrived = () => {}
    this._onScriptDataArrived = () => {}
    this._onTrackMetadata = () => {}
    this._onDataAvailable = () => {}
    this._onError = (..._args) => {}
  }

  static probe(buffer: ArrayBuffer): ProbeData {
    let data = new Uint8Array(buffer)
    let mismatch: ProbeData = { match: false }

    if (data[0] !== 0x46 || data[1] !== 0x4c || data[2] !== 0x56 || data[3] !== 0x01) {
      return mismatch
    }

    let hasAudio = (data[4] & 4) >>> 2 !== 0
    let hasVideo = (data[4] & 1) !== 0

    let offset = ReadBig32(data, 5)

    if (offset < 9) {
      return mismatch
    }

    return {
      match: true,
      consumed: offset,
      dataOffset: offset,
      hasAudioTrack: hasAudio,
      hasVideoTrack: hasVideo,
    }
  }

  get onTrackMetadata() {
    return this._onTrackMetadata
  }

  set onTrackMetadata(callback) {
    this._onTrackMetadata = callback
  }

  // prototype: function(mediaInfo: MediaInfo): void
  get onMediaInfo() {
    return this._onMediaInfo
  }

  set onMediaInfo(callback) {
    this._onMediaInfo = callback
  }

  get onMetaDataArrived() {
    return this._onMetaDataArrived
  }

  set onMetaDataArrived(callback) {
    this._onMetaDataArrived = callback
  }

  get onScriptDataArrived() {
    return this._onScriptDataArrived
  }

  set onScriptDataArrived(callback) {
    this._onScriptDataArrived = callback
  }

  get onError() {
    return this._onError
  }

  set onError(callback) {
    this._onError = callback
  }

  get onDataAvailable() {
    return this._onDataAvailable
  }

  set onDataAvailable(callback) {
    this._onDataAvailable = callback
  }

  // timestamp base for output samples, must be in milliseconds
  get timestampBase() {
    return this._timestampBase
  }

  set timestampBase(base) {
    this._timestampBase = base
  }

  get overridedDuration() {
    return this._duration
  }

  // Force-override media duration. Must be in milliseconds, int32
  set overridedDuration(duration) {
    this._durationOverrided = true
    this._duration = duration
    this._mediaInfo.duration = duration
  }

  // Force-override audio track present flag, boolean
  set overridedHasAudio(hasAudio: boolean) {
    this._hasAudioFlagOverrided = true
    this._hasAudio = hasAudio
    this._mediaInfo.hasAudio = hasAudio
  }

  // Force-override video track present flag, boolean
  set overridedHasVideo(hasVideo: boolean) {
    this._hasVideoFlagOverrided = true
    this._hasVideo = hasVideo
    this._mediaInfo.hasVideo = hasVideo
  }

  resetMediaInfo() {
    this._mediaInfo = new MediaInfo()
  }

  _isInitialMetadataDispatched() {
    if (this._hasAudioFlagOverrided || this._hasVideoFlagOverrided) {
      return this._audioInitialMetadataDispatched || this._videoInitialMetadataDispatched
    }
    if (this._hasAudio && this._hasVideo) {
      // both audio & video
      return this._audioInitialMetadataDispatched && this._videoInitialMetadataDispatched
    }
    if (this._hasAudio && !this._hasVideo) {
      // audio only
      return this._audioInitialMetadataDispatched
    }
    if (!this._hasAudio && this._hasVideo) {
      // video only
      return this._videoInitialMetadataDispatched
    }
    return false
  }

  clearTracks() {
    this._videoTrack = { type: 'video', id: 1, sequenceNumber: 0, samples: [], length: 0 }
    this._audioTrack = { type: 'audio', id: 2, sequenceNumber: 0, samples: [], length: 0 }
  }

  parseChunks(chunk: ArrayBuffer, byteStart: number) {
    if (!this.onError || !this._onMediaInfo || !this._onTrackMetadata || !this._onDataAvailable) {
      throw new IllegalStateException(
        'Flv: onError & onMediaInfo & onTrackMetadata & onDataAvailable callback must be specified'
      )
    }

    let offset = 0
    let le = this._littleEndian

    if (byteStart === 0) {
      // buffer with FLV header
      if (chunk.byteLength > 13) {
        let probeData = MSEFlvDemuxer.probe(chunk)
        if (probeData.dataOffset !== undefined)
        offset = probeData.dataOffset
      } else {
        return 0
      }
    }

    if (this._firstParse) {
      // handle PreviousTagSize0 before Tag1
      this._firstParse = false
      if (byteStart + offset !== this._dataOffset) {
        console.debug('MSEFlvDemuxer', `First time parsing but chunk byteStart invalid!`)
      }

      let v = new DataView(chunk, offset)
      let prevTagSize0 = v.getUint32(0, !le)
      if (prevTagSize0 !== 0) {
        console.debug('MSEFlvDemuxer', `PrevTagSize0 !== 0 !!!`)
      }
      offset += 4
    }

    while (offset < chunk.byteLength) {
      this._dispatch = true

      let v = new DataView(chunk, offset)

      if (offset + 11 + 4 > chunk.byteLength) {
        // data not enough for parsing an flv tag
        break
      }

      let tagType = v.getUint8(0)
      let dataSize = v.getUint32(0, !le) & 0x00ffffff

      if (offset + 11 + dataSize + 4 > chunk.byteLength) {
        // data not enough for parsing actual data body
        break
      }

      if (tagType !== 8 && tagType !== 9 && tagType !== 18) {
        console.debug('MSEFlvDemuxer', `Unsupported tag type ${tagType}, skipped`)
        // consume the whole tag (skip it)
        offset += 11 + dataSize + 4
        continue
      }

      let ts2 = v.getUint8(4)
      let ts1 = v.getUint8(5)
      let ts0 = v.getUint8(6)
      let ts3 = v.getUint8(7)

      let timestamp = ts0 | (ts1 << 8) | (ts2 << 16) | (ts3 << 24)

      let streamId = v.getUint32(7, !le) & 0x00ffffff
      if (streamId !== 0) {
        console.debug('MSEFlvDemuxer', `Meet tag which has StreamID != 0!`)
      }

      let dataOffset = offset + 11

      switch (tagType) {
        case 8: // Audio
          this._parseAudioData(chunk, dataOffset, dataSize, timestamp)
          break
        case 9: // Video
          this._parseVideoData(chunk, dataOffset, dataSize, timestamp, byteStart + offset)
          break
        case 18: // ScriptDataObject
          this._parseScriptData(chunk, dataOffset, dataSize)
          break
      }

      let prevTagSize = v.getUint32(11 + dataSize, !le)
      if (prevTagSize !== 11 + dataSize) {
        console.debug('MSEFlvDemuxer', `Invalid PrevTagSize ${prevTagSize}`)
      }

      offset += 11 + dataSize + 4 // tagBody + dataSize + prevTagSize
    }

    // dispatch parsed frames to consumer (typically, the remuxer)
    if (this._isInitialMetadataDispatched()) {
      if (this._dispatch && (this._audioTrack?.length || this._videoTrack?.length)) {
        this._onDataAvailable(this._audioTrack, this._videoTrack)
      }
    }

    return offset // consumed bytes, just equals latest offset index
  }

  _parseScriptData(arrayBuffer: ArrayBuffer, dataOffset: number, dataSize: number) {
    console.debug('MSEFlvDemuxer', 'Enter ScriptData')
    let scriptData = AMF.parseScriptData(arrayBuffer, dataOffset, dataSize)
    if (scriptData.hasOwnProperty('onMetaData')) {
      const metaData = Reflect.get(scriptData, 'onMetaData')
      if (metaData == null || typeof metaData !== 'object') {
        console.debug('MSEFlvDemuxer', `Invalid onMetaData structure!`)
        return
      }
      if (this._metadata) {
        console.debug('MSEFlvDemuxer', `Found another onMetaData tag!`)
      }
      this._metadata = scriptData
      let onMetaData = metaData

      if (this._onMetaDataArrived) {
        this._onMetaDataArrived(Object.assign({}, onMetaData))
      }

      if (!this._hasAudioFlagOverrided) {
        this._hasAudio = false
      }
      if ('hasAudio' in onMetaData && typeof onMetaData.hasAudio === 'boolean') {
        // hasAudio
        if (!this._hasAudioFlagOverrided) {
          this._hasAudio = onMetaData.hasAudio
          this._mediaInfo.hasAudio = this._hasAudio
        }
      }
      if ('hasVideo' in onMetaData && typeof onMetaData.hasVideo === 'boolean') {
        // hasVideo
        if (!this._hasVideoFlagOverrided) {
          this._hasVideo = onMetaData.hasVideo
          this._mediaInfo.hasVideo = this._hasVideo
        }
      }
      if ('audiodatarate' in onMetaData && typeof onMetaData.audiodatarate === 'number') {
        // audiodatarate
        this._mediaInfo.audioDataRate = onMetaData.audiodatarate
      }
      if ('videodatarate' in onMetaData && typeof onMetaData.videodatarate === 'number') {
        // videodatarate
        this._mediaInfo.videoDataRate = onMetaData.videodatarate
      }
      if ('width' in onMetaData && typeof onMetaData.width === 'number') {
        // width
        this._mediaInfo.width = onMetaData.width
      }
      if ('height' in onMetaData && typeof onMetaData.height === 'number') {
        // height
        this._mediaInfo.height = onMetaData.height
      }
      if ('duration' in onMetaData && typeof onMetaData.duration === 'number') {
        // duration
        if (!this._durationOverrided) {
          let duration = Math.floor(onMetaData.duration * this._timescale)
          this._duration = duration
          this._mediaInfo.duration = duration
        }
      } else {
        this._mediaInfo.duration = 0
      }
      if ('framerate' in onMetaData && typeof onMetaData.framerate === 'number') {
        // framerate
        let fps_num = Math.floor(onMetaData.framerate * 1000)
        if (fps_num > 0) {
          let fps = fps_num / 1000
          this._referenceFrameRate.fixed = true
          this._referenceFrameRate.fps = fps
          this._referenceFrameRate.fps_num = fps_num
          this._referenceFrameRate.fps_den = 1000
          this._mediaInfo.fps = fps
        }
      }
      if ('keyframes' in onMetaData && typeof onMetaData.keyframes === 'object') {
        // keyframes
        this._mediaInfo.hasKeyframesIndex = true
        let keyframes = onMetaData.keyframes
        this._mediaInfo.keyframesIndex = this._parseKeyframesIndex(keyframes as Parameters<typeof this._parseKeyframesIndex>[0])
        onMetaData.keyframes = null // keyframes has been extracted, remove it
      } else {
        this._mediaInfo.hasKeyframesIndex = false
      }
      this._dispatch = false
      this._mediaInfo.metadata = onMetaData as Record<string, number | string | boolean>
      console.debug('MSEFlvDemuxer', `Parsed onMetaData`)
      if (this._mediaInfo.isComplete()) {
        this._onMediaInfo(this._mediaInfo)
      }
    }

    if (Object.keys(scriptData).length > 0) {
      if (this._onScriptDataArrived) {
        this._onScriptDataArrived(Object.assign({}, scriptData))
      }
    }
  }

  _parseKeyframesIndex(keyframes: {times: number[];filepositions: number[]}) {
    let times = []
    let filepositions = []

    // ignore first keyframe which is actually AVC Sequence Header (AVCDecoderConfigurationRecord)
    for (let i = 1; i < keyframes.times.length; i++) {
      let time = this._timestampBase + Math.floor(keyframes.times[i] * 1000)
      times.push(time)
      filepositions.push(keyframes.filepositions[i])
    }

    return {
      times: times,
      filepositions: filepositions,
    }
  }

  _parseAudioData(arrayBuffer: ArrayBuffer, dataOffset: number, dataSize: number, tagTimestamp: number) {
    if (dataSize <= 1) {
      console.debug('MSEFlvDemuxer', `Flv: Invalid audio packet, missing SoundData payload!`)
      return
    }

    if (this._hasAudioFlagOverrided && this._hasAudio === false) {
      // If hasAudio: false indicated explicitly in MediaDataSource,
      // Ignore all the audio packets
      return
    }

    let v = new DataView(arrayBuffer, dataOffset, dataSize)
    let soundSpec = v.getUint8(0)

    let soundFormat = soundSpec >>> 4
    if (soundFormat !== 2 && soundFormat !== 10) {
      // MP3 or AAC
      this.onError?.(DemuxErrors.CODEC_UNSUPPORTED, 'Flv: Unsupported audio codec idx: ' + soundFormat)
      return
    }

    let soundRate = 0
    let soundRateIndex = (soundSpec & 12) >>> 2
    if (soundRateIndex >= 0 && soundRateIndex <= 4) {
      soundRate = this._flvSoundRateTable[soundRateIndex]
    } else {
      this.onError(DemuxErrors.FORMAT_ERROR, 'Flv: Invalid audio sample rate idx: ' + soundRateIndex)
      return
    }
    let soundType = soundSpec & 1

    let meta = this._audioMetadata
    let track: MediaTrackData<'audio'> = this._audioTrack!

    if (!meta) {
      if (!this._hasAudio && !this._hasAudioFlagOverrided) {
        this._hasAudio = true
        this._mediaInfo.hasAudio = true
      }

      // initial metadata
      meta = this._audioMetadata = { type: 'audio' }
      meta.type = 'audio'
      meta.id = track.id
      meta.timescale = this._timescale
      meta.duration = this._duration
      meta.audioSampleRate = soundRate
      meta.channelCount = soundType === 0 ? 1 : 2
    }

    if (soundFormat === 10) {
      // AAC
      let aacData = this._parseAACAudioData(arrayBuffer, dataOffset + 1, dataSize - 1)
      if (aacData == undefined) {
        return
      }

      if (aacData.packetType === 0 && aacData.data && 'config' in aacData.data) {
        // AAC sequence header (AudioSpecificConfig)
        if (meta.config) {
          console.debug('MSEFlvDemuxer', `Found another AudioSpecificConfig!`)
        }
        let misc = aacData.data
        meta.audioSampleRate = misc.samplingRate
        meta.channelCount = misc.channelCount
        meta.codec = misc.codec
        meta.originalCodec = misc.originalCodec
        meta.config = misc.config
        meta.extra_data = misc.extra_data
        // The decode result of an aac sample is 1024 PCM samples
        if (meta.audioSampleRate && meta.timescale)
          meta.refSampleDuration = (1024 / meta.audioSampleRate) * meta.timescale
        console.debug('MSEFlvDemuxer', `Parsed AudioSpecificConfig`)
        if (this._isInitialMetadataDispatched()) {
          // Non-initial metadata, force dispatch (or flush) parsed frames to remuxer
          if (this._dispatch && (this._audioTrack?.length || this._videoTrack?.length)) {
            this._onDataAvailable(this._audioTrack, this._videoTrack)
          }
        } else {
          this._audioInitialMetadataDispatched = true
        }
        // then notify new metadata
        this._dispatch = false
        this._onTrackMetadata('audio', meta)

        let mi = this._mediaInfo
        mi.audioCodec = meta.originalCodec
        mi.audioSampleRate = meta.audioSampleRate
        mi.audioChannelCount = meta.channelCount
        if (mi.hasVideo) {
          if (mi.videoCodec != null) {
            mi.mimeType = 'video/x-flv; codecs="' + mi.videoCodec + ',' + mi.audioCodec + '"'
          }
        } else {
          mi.mimeType = 'video/x-flv; codecs="' + mi.audioCodec + '"'
        }
        if (mi.isComplete()) {
          this._onMediaInfo(mi)
        }
      } else if (aacData.packetType === 1) {
        // AAC raw frame data
        let dts = this._timestampBase + tagTimestamp
        let aacSample: AudioData = { unit: aacData.data, length: aacData.data.byteLength, dts: dts, pts: dts }
        track.samples.push(aacSample)
        track.length += aacData.data.length
      } else {
        console.debug('MSEFlvDemuxer', `Flv: Unsupported AAC data type ${aacData.packetType}`)
      }
    } else if (soundFormat === 2) {
      // MP3
      if (!meta.codec) {
        // We need metadata for mp3 audio track, extract info from frame header
        let misc = this._parseMP3AudioData(arrayBuffer, dataOffset + 1, dataSize - 1, true)
        if (misc == undefined || misc instanceof Uint8Array) {
          return
        }
        meta.audioSampleRate = misc.samplingRate
        meta.channelCount = misc.channelCount
        meta.codec = misc.codec
        meta.originalCodec = misc.originalCodec
        if (meta.audioSampleRate && meta.timescale)
          meta.refSampleDuration = (1152 / meta.audioSampleRate) * meta.timescale
        console.debug('MSEFlvDemuxer', `Parsed MPEG Audio Frame Header`)
        this._audioInitialMetadataDispatched = true
        this._onTrackMetadata('audio', meta)

        let mi = this._mediaInfo
        mi.audioCodec = meta.codec
        mi.audioSampleRate = meta.audioSampleRate
        mi.audioChannelCount = meta.channelCount
        mi.audioDataRate = misc.bitRate
        if (mi.hasVideo) {
          if (mi.videoCodec != null) {
            mi.mimeType = 'video/x-flv; codecs="' + mi.videoCodec + ',' + mi.audioCodec + '"'
          }
        } else {
          mi.mimeType = 'video/x-flv; codecs="' + mi.audioCodec + '"'
        }
        if (mi.isComplete()) {
          this._onMediaInfo(mi)
        }
      }

      // This packet is always a valid audio packet, extract it
      let data = this._parseMP3AudioData(arrayBuffer, dataOffset + 1, dataSize - 1, false)
      if (data == undefined || !(data instanceof Uint8Array)) {
        return
      }
      let dts = this._timestampBase + tagTimestamp
      let mp3Sample = { unit: data, length: data.byteLength, dts: dts, pts: dts }
      track.samples.push(mp3Sample)
      track.length += data.length
    }
  }
  
  _parseAACAudioData(arrayBuffer: ArrayBuffer, dataOffset: number, dataSize: number): undefined | AACAudioDataType<0> | AACAudioDataType<1> {
    if (dataSize <= 1) {
      console.warn('MSEFlvDemuxer', `Flv: Invalid AAC packet, missing AACPacketType or/and Data!`)
      return
    }
    let array = new Uint8Array(arrayBuffer, dataOffset, dataSize)

    if (array[0] === 0) {
      return {
        packetType: 0,
        data: this._parseAACAudioSpecificConfig(arrayBuffer, dataOffset + 1, dataSize - 1)
      }
    } else if (array[0] === 1) {
      return {
        packetType: 1,
        data: array.subarray(1)
      }
    }
  }

  _parseAACAudioSpecificConfig(arrayBuffer: ArrayBuffer, dataOffset: number, dataSize: number) {
    let array = new Uint8Array(arrayBuffer, dataOffset, dataSize)
    let config: number[] | null = null
    let audioObjectType = 0
    let originalAudioObjectType = 0
    let samplingIndex = 0
    let extensionSamplingIndex = null

    // 5 bits
    audioObjectType = originalAudioObjectType = array[0] >>> 3
    // 4 bits
    samplingIndex = ((array[0] & 0x07) << 1) | (array[1] >>> 7)
    if (samplingIndex < 0 || samplingIndex >= this._mpegSamplingRates.length) {
      this.onError(DemuxErrors.FORMAT_ERROR, 'Flv: AAC invalid sampling frequency index!')
      return
    }

    let samplingFrequence = this._mpegSamplingRates[samplingIndex]

    // 4 bits
    let channelConfig = (array[1] & 0x78) >>> 3
    if (channelConfig < 0 || channelConfig >= 8) {
      this.onError(DemuxErrors.FORMAT_ERROR, 'Flv: AAC invalid channel configuration')
      return
    }

    if (audioObjectType === 5) {
      // HE-AAC?
      // 4 bits
      extensionSamplingIndex = ((array[1] & 0x07) << 1) | (array[2] >>> 7)
    }

    // workarounds for various browsers
    let userAgent = self.navigator.userAgent.toLowerCase()

    if (userAgent.indexOf('firefox') !== -1) {
      // firefox: use SBR (HE-AAC) if freq less than 24kHz
      if (samplingIndex >= 6) {
        audioObjectType = 5
        config = new Array(4)
        extensionSamplingIndex = samplingIndex - 3
      } else {
        // use LC-AAC
        audioObjectType = 2
        config = new Array(2)
        extensionSamplingIndex = samplingIndex
      }
    } else if (userAgent.indexOf('android') !== -1) {
      // android: always use LC-AAC
      audioObjectType = 2
      config = new Array(2)
      extensionSamplingIndex = samplingIndex
    } else {
      // for other browsers, e.g. chrome...
      // Always use HE-AAC to make it easier to switch aac codec profile
      audioObjectType = 5
      extensionSamplingIndex = samplingIndex
      config = new Array(4)

      if (samplingIndex >= 6) {
        extensionSamplingIndex = samplingIndex - 3
      } else if (channelConfig === 1) {
        // Mono channel
        audioObjectType = 2
        config = new Array(2)
        extensionSamplingIndex = samplingIndex
      }
    }

    config[0] = audioObjectType << 3
    config[0] |= (samplingIndex & 0x0f) >>> 1
    config[1] = (samplingIndex & 0x0f) << 7
    config[1] |= (channelConfig & 0x0f) << 3
    if (audioObjectType === 5) {
      config[1] |= (extensionSamplingIndex & 0x0f) >>> 1
      config[2] = (extensionSamplingIndex & 0x01) << 7
      // extended audio object type: force to 2 (LC-AAC)
      config[2] |= 2 << 2
      config[3] = 0
    }

    return {
      config: config,
      samplingRate: samplingFrequence,
      channelCount: channelConfig,
      codec: 'mp4a.40.' + audioObjectType,
      originalCodec: 'mp4a.40.' + originalAudioObjectType,
      extra_data: array,
    }
  }

  _parseMP3AudioData(arrayBuffer: ArrayBuffer, dataOffset: number, dataSize: number, requestHeader: boolean) {
    if (dataSize < 4) {
      console.debug('MSEFlvDemuxer', `Flv: Invalid MP3 packet, header missing!`)
      return
    }

    let array = new Uint8Array(arrayBuffer, dataOffset, dataSize)
    let result = null

    if (requestHeader) {
      if (array[0] !== 0xff) {
        return
      }
      let ver = (array[1] >>> 3) & 0x03
      let layer = (array[1] & 0x06) >> 1

      let bitrate_index = (array[2] & 0xf0) >>> 4
      let sampling_freq_index = (array[2] & 0x0c) >>> 2

      let channel_mode = (array[3] >>> 6) & 0x03
      let channel_count = channel_mode !== 3 ? 2 : 1

      let sample_rate = 0
      let bit_rate = 0

      let codec = 'mp3'

      switch (ver) {
        case 0: // MPEG 2.5
          sample_rate = this._mpegAudioV25SampleRateTable[sampling_freq_index]
          break
        case 2: // MPEG 2
          sample_rate = this._mpegAudioV20SampleRateTable[sampling_freq_index]
          break
        case 3: // MPEG 1
          sample_rate = this._mpegAudioV10SampleRateTable[sampling_freq_index]
          break
      }
      switch (layer) {
        case 1: // Layer 3
          if (bitrate_index < this._mpegAudioL3BitRateTable.length) {
            bit_rate = this._mpegAudioL3BitRateTable[bitrate_index]
          }
          break
        case 2: // Layer 2
          if (bitrate_index < this._mpegAudioL2BitRateTable.length) {
            bit_rate = this._mpegAudioL2BitRateTable[bitrate_index]
          }
          break
        case 3: // Layer 1
          if (bitrate_index < this._mpegAudioL1BitRateTable.length) {
            bit_rate = this._mpegAudioL1BitRateTable[bitrate_index]
          }
          break
      }
      result = {
        bitRate: bit_rate,
        samplingRate: sample_rate,
        channelCount: channel_count,
        codec: codec,
        originalCodec: codec,
      }
    } else {
      result = array
    }

    return result
  }

  _parseVideoData(arrayBuffer: ArrayBuffer, dataOffset: number, dataSize: number, tagTimestamp: number, tagPosition: number) {
    if (dataSize <= 1) {
      console.debug('MSEFlvDemuxer', `Flv: Invalid video packet, missing VideoData payload!`)
      return
    }

    if (this._hasVideoFlagOverrided && !this._hasVideo) {
      return
    }

    let spec = new Uint8Array(arrayBuffer, dataOffset, dataSize)[0]

    let frameType = (spec & 240) >>> 4
    let codecId = spec & 15

    if (codecId !== 7) {
      this.onError(DemuxErrors.CODEC_UNSUPPORTED, `Flv: Unsupported codec in video frame: ${codecId}`)
      return
    }

    this._parseAVCVideoPacket(arrayBuffer, dataOffset + 1, dataSize - 1, tagTimestamp, tagPosition, frameType)
  }

  _parseAVCVideoPacket(
    arrayBuffer: ArrayBuffer,
    dataOffset: number,
    dataSize: number,
    tagTimestamp: number,
    tagPosition: number,
    frameType: number
  ) {
    if (dataSize < 4) {
      console.debug('MSEFlvDemuxer', `Flv: Invalid AVC packet, missing AVCPacketType or/and CompositionTime`)
      return
    }

    let le = this._littleEndian
    let v = new DataView(arrayBuffer, dataOffset, dataSize)

    let packetType = v.getUint8(0)
    let cts_unsigned = v.getUint32(0, !le) & 0x00ffffff
    let cts = (cts_unsigned << 8) >> 8 // convert to 24-bit signed int

    if (packetType === 0) {
      // AVCDecoderConfigurationRecord
      this._parseAVCDecoderConfigurationRecord(arrayBuffer, dataOffset + 4, dataSize - 4)
    } else if (packetType === 1) {
      // One or more Nalus
      this._parseAVCVideoData(arrayBuffer, dataOffset + 4, dataSize - 4, tagTimestamp, tagPosition, frameType, cts)
    } else if (packetType === 2) {
      // empty, AVC end of sequence
    } else {
      this.onError(DemuxErrors.FORMAT_ERROR, `Flv: Invalid video packet type ${packetType}`)
      return
    }
  }

  _parseAVCDecoderConfigurationRecord(arrayBuffer: ArrayBuffer, dataOffset: number, dataSize: number) {
    if (dataSize < 7) {
      console.debug('MSEFlvDemuxer', `IFlv: Invalid AVCDecoderConfigurationRecord, lack of data!`)
      return
    }

    let meta = this._videoMetadata
    let track = this._videoTrack!
    let le = this._littleEndian
    let v = new DataView(arrayBuffer, dataOffset, dataSize)

    if (!meta) {
      if (!this._hasVideo && !this._hasVideoFlagOverrided) {
        this._hasVideo = true
        this._mediaInfo.hasVideo = true
      }

      meta = this._videoMetadata = {
        type: '',
        id: 0,
        timescale: 0,
        duration: 0,
        codecWidth: 0,
        codecHeight: 0,
        presentWidth: 0,
        presentHeight: 0,
        profile: '',
        level: '',
        bitDepth: 0,
        chromaFormat: 0,
        sarRatio: {
          width: 0,
          height: 0,
        },
        frameRate: {
          fixed: false,
          fps: 0,
          fps_den: 0,
          fps_num: 0,
        },
        codec: '',
        decoderType: '',
        spspps: new Uint8Array(0),
        avcc: new Uint8Array(0),
        refSampleDuration: 0,
        extra_data: new Uint8Array(arrayBuffer, dataOffset, dataSize),
      }
      meta.type = 'video'
      meta.id = track.id
      meta.timescale = this._timescale
      meta.duration = this._duration
    } else {
      if (typeof meta.avcc !== 'undefined') {
        console.debug('MSEFlvDemuxer', `Found another AVCDecoderConfigurationRecord!`)
      }
    }

    let version = v.getUint8(0) // configurationVersion
    let avcProfile = v.getUint8(1) // avcProfileIndication
    if (version !== 1 || avcProfile === 0) {
      this.onError(DemuxErrors.FORMAT_ERROR, 'Flv: Invalid AVCDecoderConfigurationRecord')
      return
    }

    this._naluLengthSize = (v.getUint8(4) & 3) + 1 // lengthSizeMinusOne
    if (this._naluLengthSize !== 3 && this._naluLengthSize !== 4) {
      // holy shit!!!
      this.onError(DemuxErrors.FORMAT_ERROR, `Flv: Strange NaluLengthSizeMinusOne: ${this._naluLengthSize - 1}`)
      return
    }

    let spsCount = v.getUint8(5) & 31 // numOfSequenceParameterSets
    if (spsCount === 0) {
      this.onError(DemuxErrors.FORMAT_ERROR, 'Flv: Invalid AVCDecoderConfigurationRecord: No SPS')
      return
    } else if (spsCount > 1) {
      console.debug('MSEFlvDemuxer', `Flv: Strange AVCDecoderConfigurationRecord: SPS Count = ${spsCount}`)
    }

    let offset = 6
    let startCode = new Uint8Array(4)
    startCode[0] = 0
    startCode[1] = 0
    startCode[2] = 0
    startCode[3] = 1

    let spspps = new Uint8Array(0)
    for (let i = 0; i < spsCount; i++) {
      let len = v.getUint16(offset, !le) // sequenceParameterSetLength
      offset += 2

      if (len === 0) {
        continue
      }

      // Notice: Nalu without startcode header (00 00 00 01)
      let sps = new Uint8Array(arrayBuffer, dataOffset + offset, len)
      let tmp = new Uint8Array(spspps.length + sps.length + startCode.length)
      tmp.set(spspps)
      tmp.set(startCode, spspps.length)
      tmp.set(sps, spspps.length + startCode.length)
      spspps = new Uint8Array(0)
      spspps = tmp
      tmp = new Uint8Array(0)
      offset += len

      let config = SpsParser.parseSPS(sps)
      if (i !== 0) {
        // ignore other sps's config
        continue
      }

      meta.codecWidth = config.codec_size.width
      meta.codecHeight = config.codec_size.height
      meta.presentWidth = config.present_size.width
      meta.presentHeight = config.present_size.height

      meta.profile = config.profile_string
      meta.level = config.level_string
      meta.bitDepth = config.bit_depth
      meta.chromaFormat = config.chroma_format
      meta.sarRatio = config.sar_ratio
      meta.frameRate = config.frame_rate

      if (!config.frame_rate.fixed || config.frame_rate.fps_num === 0 || config.frame_rate.fps_den === 0) {
        meta.frameRate = this._referenceFrameRate
      }

      let fps_den = meta.frameRate.fps_den
      let fps_num = meta.frameRate.fps_num
      meta.refSampleDuration = meta.timescale * (fps_den / fps_num)

      let codecArray = sps.subarray(1, 4)
      let codecString = 'avc1.'
      for (let j = 0; j < 3; j++) {
        let h = codecArray[j].toString(16)
        if (h.length < 2) {
          h = '0' + h
        }
        codecString += h
      }
      meta.codec = codecString
      meta.decoderType = 'h264'

      let mi = this._mediaInfo
      mi.width = meta.codecWidth
      mi.height = meta.codecHeight
      mi.fps = meta.frameRate.fps
      mi.profile = meta.profile
      mi.level = meta.level
      mi.refFrames = config.ref_frames
      mi.chromaFormat = config.chroma_format_string
      mi.sarNum = meta.sarRatio.width
      mi.sarDen = meta.sarRatio.height
      mi.videoCodec = codecString

      if (mi.hasAudio) {
        if (mi.audioCodec != null) {
          mi.mimeType = 'video/x-flv; codecs="' + mi.videoCodec + ',' + mi.audioCodec + '"'
        }
      } else {
        mi.mimeType = 'video/x-flv; codecs="' + mi.videoCodec + '"'
      }
      if (mi.isComplete()) {
        this._onMediaInfo(mi)
      }
    }

    let ppsCount = v.getUint8(offset) // numOfPictureParameterSets
    if (ppsCount === 0) {
      this.onError(DemuxErrors.FORMAT_ERROR, 'Flv: Invalid AVCDecoderConfigurationRecord: No PPS')
      return
    } else if (ppsCount > 1) {
      console.debug('MSEFlvDemuxer', `Flv: Strange AVCDecoderConfigurationRecord: PPS Count = ${ppsCount}`)
    }

    offset++

    for (let i = 0; i < ppsCount; i++) {
      let len = v.getUint16(offset, !le) // pictureParameterSetLength
      offset += 2

      if (len === 0) {
        continue
      }
      let pps = new Uint8Array(arrayBuffer, dataOffset + offset, len)

      let tmp = new Uint8Array(spspps.length + pps.length + startCode.length)
      tmp.set(spspps)
      tmp.set(startCode, spspps.length)
      tmp.set(pps, spspps.length + startCode.length)
      spspps = new Uint8Array(0)
      spspps = tmp
      tmp = new Uint8Array(0)

      // pps is useless for extracting video information
      offset += len
    }

    meta.spspps = spspps
    meta.avcc = new Uint8Array(dataSize)
    meta.avcc.set(new Uint8Array(arrayBuffer, dataOffset, dataSize), 0)
    console.debug('MSEFlvDemuxer', `Parsed AVCDecoderConfigurationRecord`)

    if (this._isInitialMetadataDispatched()) {
      // flush parsed frames
      if (this._dispatch && (this._audioTrack?.length || this._videoTrack?.length)) {
        this._onDataAvailable(this._audioTrack, this._videoTrack)
      }
    } else {
      this._videoInitialMetadataDispatched = true
    }
    // notify new metadata
    this._dispatch = false
    this._onTrackMetadata('video', meta)
  }

  _parseAVCVideoData(
    arrayBuffer: ArrayBuffer,
    dataOffset: number,
    dataSize: number,
    tagTimestamp: number,
    tagPosition: number,
    frameType: number,
    cts: number
  ) {
    let le = this._littleEndian
    let v = new DataView(arrayBuffer, dataOffset, dataSize)

    let units = [],
      length = 0

    let offset = 0
    const lengthSize = this._naluLengthSize
    let dts = this._timestampBase + tagTimestamp
    let keyframe = frameType === 1 // from FLV Frame Type constants

    let _frameType: string = ''

    while (offset < dataSize) {
      if (offset + 4 >= dataSize) {
        console.debug(
          'MSEFlvDemuxer',
          `Malformed Nalu near timestamp ${dts}, offset = ${offset}, dataSize = ${dataSize}`
        )
        break // data not enough for next Nalu
      }
      let naluSize = v.getUint32(offset, !le) // Big-Endian read
      if (lengthSize === 3) {
        naluSize >>>= 8
      }
      if (naluSize > dataSize - lengthSize) {
        console.debug('MSEFlvDemuxer', `Malformed Nalus near timestamp ${dts}, NaluSize > DataSize!`)
        return
      }

      let unitType = v.getUint8(offset + lengthSize) & 0x1f

      if (unitType === 5) {
        // IDR
        keyframe = true
        this.lastIDROrBframeDts = dts
        this.lastIDROrPFramePts = dts + cts
      }
      if (0 == this.videoDuration && 0 != this.lastIDROrBframeDts && dts != this.lastIDROrBframeDts) {
        this.videoDuration = dts - this.lastIDROrBframeDts
      }
      if (unitType == 5) {
        _frameType = 'I'
      } else if (unitType == 1) {
        if (
            Math.abs(dts - this.videoDuration - this.lastIDROrBframeDts) < 2 &&
          cts != 0 &&
          !(
            Math.abs(dts + cts - this.videoDuration - this.lastIDROrPFramePts) < 2
          )
        ) {
          // B帧的数量
          this.bframeCount = (cts + dts - this.lastIDROrPFramePts) / this.videoDuration - 1
          if (this.bframeCount < 0.1) {
            this.bframeCount = 0
          }
          _frameType = 'P'
          this.lastIDROrPFramePts = cts + dts
        } else {
          if (cts > 0) {
            if (this.bframeCount > 0) {
              this.bframeCount -= 1
              if (this.bframeCount < 0.1) {
                this.bframeCount = 0
              }
            }
            _frameType = 'B'
            if (this.bframeCount <= 0) {
              this.lastIDROrBframeDts = dts
              this.bframeCount = 0
            }
          } else {
            _frameType = 'P'
          }
        }
      }

      let data = new Uint8Array(arrayBuffer, dataOffset + offset, lengthSize + naluSize)
      let naluType = data[lengthSize] & 0xff
      if (0x06 == naluType) {
        let payloadType = data[lengthSize+1]
        if (0x05 == payloadType && 29 == naluSize) {
          let seiUUID = new TextDecoder().decode(data.subarray(lengthSize+2, lengthSize+2 + 16));
          if (seiUUID == 'BeiJingTimeMsec\0') {
            let data_len_u8a = data.subarray(lengthSize+18, lengthSize+18 + 2)
            let data_len = (data_len_u8a[1] << 8) + data_len_u8a[0]
            let time_u8a = data.subarray(lengthSize+20, lengthSize+20 + data_len)
            let time = 0
            for (let i = 0; i < data_len; ++i) {
              let num = (BigInt(time_u8a[i]) << BigInt(i*8))
              time += Number(num)
            }
            console.log("time delay:", Date.now() - time)
          }
        }
      }
      // Nalu 9: 标识一个访问单元的边界，不去除的话，hls和chrome wcs方案无法正常播放
      if (!this.ignoreNaluTypes.includes(naluType)) {
        let unit: Unit = { type: unitType, data: data }
        units.push(unit)
        length += data.byteLength
      }

      offset += lengthSize + naluSize
    }
    if (units.length && this._videoTrack) {
      let track = this._videoTrack
      let avcSample: VideoData = {
        units: units,
        length: length,
        isKeyframe: keyframe,
        dts: dts,
        cts: cts,
        frameType: _frameType,
        pts: dts + cts,
        fileposition: 0,
      }
      
      if (keyframe) {
        avcSample.fileposition = tagPosition
      }
      track.samples.push(avcSample)
      track.length += length
    }
  }
}
