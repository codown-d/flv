// @ts-check
/// <reference lib="webworker"/>

import { DemuxedSourceData } from "../../demuxer";
import { isInWorker } from "../../tool";

export interface OnMessageEventMap {
  data: DemuxedSourceData[];
  configure: VideoDecoderConfig & {
    offscreen: OffscreenCanvas;
    spspps: Uint8Array;
  };
}

export interface PostMessageEventMap {
  data: {
    img: ImageBitmap;
    timestamp: number;
  };
}
type WorkerGlobal = typeof globalThis;

export class VideoWorkerDecoder {
  decoder?: VideoDecoder;
  spspps?: Uint8Array;
  context?: Window & WorkerGlobal;
  offscreen?: OffscreenCanvas;
  offscreenCtx?: OffscreenCanvasRenderingContext2D;
  constructor(context?: Window & WorkerGlobal) {
    // code
    this.context = context;
    if (this.context) {
      this.offscreen = new OffscreenCanvas(640, 480); // 创建 OffscreenCanvas
      this.offscreenCtx = this.offscreen.getContext("2d"); // 获取绘图上下文
    }
  }
  onMessage(type: any, value: any): void {
    // code
    console.log("onMessage", type, value)
    switch (type) {
      case "configure": {
        this.spspps = value.spspps; // 保存 SPS/PPS 数据
        this.decoder = new VideoDecoder({
          output: (imageBitmap) => {
            // 发送解码后的图像位图
            this.postMessage("data", {
              img: imageBitmap,
              timestamp: performance.now(),
            });
          },
          error: (e) => {
            console.error("Decoder error:", e);
          },
        });
        // 配置解码器
        this.decoder.configure({
          codec: "avc1.64001E", // H.264 编码
          codedWidth: 640,
          codedHeight: 480,
          description: this.spspps, // 设置 SPS/PPS 数据
          // 如果有其他需要的配置项，可以在这里添加
        });
        break;
      }
      case "decode": {
        // 解码收到的数据
        if (this.decoder) {
          this.decoder.decode(value);
        }
        break;
      }
      case "flush": {
        // 刷新解码器，处理剩余数据
        if (this.decoder) {
          this.decoder.flush();
        }
        break;
      }
    }
  }
  postMessage(type: any, value: any): void {
    // code
    if (this.context) {
      this.context.postMessage({ type, value });
    } else {
      console.warn("No context available for postMessage.");
    }
  }
}

export default new VideoWorkerDecoder(isInWorker() ? self : undefined);
