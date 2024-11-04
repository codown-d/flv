import VideoDecoderWorker from './videoDecoder?worker'
import videoDecoder, { VideoWorkerDecoder as VideoDecoder, PostMessageEventMap } from './videoDecoder'
import { DemuxedSourceData, MediaType } from '../../demuxer';
import { AudioMeta, VideoMeta } from '../../demuxer/MSEFlvDemuxer';
enum MediaSelectType {
  NULL = 0,
  AUDIO = 1,
  VIDEO = 2,
  ALL = 3
}
export default class Decoder {
  useWorker?: boolean
  constructor() {
  }
  async init(useWorker = true, decodeType = MediaSelectType.ALL) {
    this.useWorker = useWorker
    if (useWorker) {
      if (decodeType & MediaSelectType.VIDEO) {
        // code
      }
    }
  }
  decode(type: MediaType, data: DemuxedSourceData[]) {
    switch(type) {
      case 'video':
        {
          // code
        }
        break
    }
  }
  setMeta(type: any, data: any): void {
    switch(type) {
      case 'video':
        {
          // code
        }
        break
    }
  }
  onMessage(type: any, value: any): void {
    // code
  }
  stop() {
    // code
  }
}