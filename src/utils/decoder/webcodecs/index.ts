import VideoDecoderWorker from "./videoDecoder?worker";
import videoDecoder, {
  VideoWorkerDecoder as VideoDecoder,
  PostMessageEventMap,
} from "./videoDecoder";
import { DemuxedSourceData, MediaType } from "../../demuxer";
import { AudioMeta, VideoMeta } from "../../demuxer/MSEFlvDemuxer";
enum MediaSelectType {
  NULL = 0,
  AUDIO = 1,
  VIDEO = 2,
  ALL = 3,
}
export default class Decoder {
  useWorker?: boolean;

  videoDecoder?: VideoDecoder; // 视频解码器实例
  audioDecoder?: any; // 可能需要的音频解码器实例，视具体实现而定
  constructor() {}
  async init(useWorker = true, decodeType = MediaSelectType.ALL) {
    this.useWorker = useWorker;
    if (useWorker) {
      if (decodeType & MediaSelectType.VIDEO) {
        // code
        this.videoDecoder = new VideoDecoder(); // 实例化视频解码器
        console.log("videoDecoder", this.videoDecoder)
        // 设置工作线程消息处理
        // this.videoDecoder.onMessage = (event) => {
        //   const { type, value } = event.data;
        //   this.onMessage(type, value); // 处理来自工作线程的解码数据
        // };
  
        // 发送配置到工作线程
        const config = {
          codec: 'avc1.64001E', // 示例 H.264 编码
          offscreen: new OffscreenCanvas(640, 480), // 创建 OffscreenCanvas
          spspps: new Uint8Array(), // 替换为实际的 SPS/PPS 数据
        };
        this.videoDecoder.onMessage('configure', config); // 配置工作线程
      }
    }
  }
  decode(type: MediaType, data: DemuxedSourceData[]) {
    switch (type) {
      case "video":
        {
          // code
          if (this.videoDecoder) {
            this.videoDecoder.postMessage('decode', data); // 使用工作线程解码视频数据
          }
          break;
        }
        break;
    }
  }
  setMeta(type: any, data: any): void {
    switch (type) {
      case "video":
        {
          // code
          if (this.videoDecoder) {
            const offscreenCanvas = new OffscreenCanvas(640, 480); // 创建 OffscreenCanvas
            const spspps = new Uint8Array(data.spspps); // 确保 SPS/PPS 数据的有效性
            this.videoDecoder.postMessage('configure',{
              // 配置视频解码器
              codec: data.codec,
              codedWidth: data.codecWidth,
              codedHeight: data.codecHeight,
              // description: data.spspps, // 假设这是 SPS/PPS 数据
              description: spspps, // 使用有效的 SPS/PPS 数据
              offscreen: offscreenCanvas // 传递 OffscreenCanvas
            });
          }
          break;
        }
    }
  }
  onMessage(type: any, value: any): void {
    // code
    switch (type) {
      case "data": {
        // 处理从工作线程返回的解码数据
        const { img, timestamp } = value;
        // TODO: 将解码后的图像绘制到画布或进行其他处理
        break;
      }
      // 处理其他消息类型...
    }
  }
  stop() {
    // code
    // 停止工作线程和解码器
    if (this.videoDecoder) {
      // this.videoDecoder.terminate(); // 停止工作线程
    }
    // 如果有音频解码器，也需要停止
    if (this.audioDecoder) {
      // this.audioDecoder.stop(); // 停止音频解码器
    }
  }
}
