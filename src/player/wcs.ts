import BasePlayer, { BasePlayerConfig } from "./base";
import Demuxer, { DemuxedSourceData, MediaType } from '../utils/demuxer'
import Decoder from '../utils/decoder/webcodecs'
import Render from '../utils/render'
import { AudioMeta, VideoMeta } from '../utils/demuxer/MSEFlvDemuxer'

interface WcsPlayerConfig {
  renderId: string
}
export default class WebCodecsPlayer extends BasePlayer {
  demuxer?: Demuxer // 解析器
  decoder?: Decoder // 解码器
  render?: Render // 渲染器
  metaData: { // 头数据
    audio?: AudioMeta
    video?: VideoMeta
  } = {}
  demuxDataCache: Record<MediaType, DemuxedSourceData[]> = {
    audio: [],
    video: []
  }
  referenceTime = { // 参考系时间
    demux: {
      dts: 0,
      time: 0
    }
  }
  config?: WcsPlayerConfig
  init(config: WcsPlayerConfig & Partial<BasePlayerConfig>) {
    const {buffer, ..._config} = config
    this.config = _config
    if (buffer !== undefined) {
      this.buffer = buffer
    }
    this.demuxer = new Demuxer()
    this.demuxer.addEventListener('metaData', this.onDemuxMetaData.bind(this))
    this.demuxer.addEventListener('mediaData', this.onDemuxMediaData.bind(this))
    this.decoder = new Decoder()
    this.decoder.init()
    this.render = new Render()
  }

  start(url: string) {
    this.streamer.isValid(url).then(({status}) => {
      if (status === 'successed') {
        this.streamer.start(url, this.onStreamData.bind(this), this.onStreamError.bind(this))
      }
    })
  }

  stop() {
    this.streamer.stop()
    this.render?.stop()
  }

  onStreamData(data: Uint8Array) {
    if (this.demuxer) {
      if (this.demuxer.inited) {
        this.demuxer.parseChunk(data)
      } else {
        this.demuxer.initConfig({
          hasAudio: false,
          hasVideo: true,
          ignoreNaluTypes: [6, 9]
        }, data)
      }
    }
  }

  onStreamError(error: Error) {
    console.debug('onStreamError', error)
  }

  onDemuxMetaData<T extends MediaType>(type: T, data: T extends 'audio' ? AudioMeta : VideoMeta ): void {
    if (type === 'video' && 'codecWidth' in data) {
      if (!this.metaData.video) {
        // 获取到视频宽高信息去初始化渲染器
        this.decoder?.setMeta('video', data)
        const canvas = document.createElement('canvas')
        canvas.width = data.codecWidth
        canvas.height = data.codecHeight
        canvas.style.width = '500px'
        const configRenderContainerEl = document.getElementById(this.config!.renderId)
        if (configRenderContainerEl) {
          configRenderContainerEl.appendChild(canvas)
        } else {
          document.body.appendChild(canvas)
        }
        this.render?.config({
          canvas,
          getShouldRenderImg: this.getShouldRenderImg.bind(this)
        })
        this.render?.start()
      }
      this.metaData.video = data
    }
  }
  onDemuxMediaData(type: MediaType, data: DemuxedSourceData[]) {
    if (type === 'video') {
      this.recordDemuxTime(data.last()!.dts!)
      this.decoder?.decode('video', data)
    }
  }
  recordDemuxTime(dts: number) {
    const nowTs = performance.now()
    const delta = dts - nowTs
    const currentDelta = this.referenceTime.demux.dts - this.referenceTime.demux.time
    if (!this.referenceTime.demux.time || delta > currentDelta) {
      this.referenceTime.demux.dts = dts
      this.referenceTime.demux.time = nowTs
    }
  }
  getShouldRenderImg() {
    // code
    return new ImageBitmap()
    //
  }
}