// @ts-check
/// <reference lib="webworker"/>

import { DemuxedSourceData } from "../../demuxer"
import { isInWorker } from "../../tool"

export interface OnMessageEventMap {
  data: DemuxedSourceData[]
  configure: VideoDecoderConfig & {offscreen: OffscreenCanvas;spspps: Uint8Array}
}

export interface PostMessageEventMap {
  data: {
    img: ImageBitmap,
    timestamp: number
  }
}
type WorkerGlobal = typeof globalThis

export class VideoWorkerDecoder {
  decoder?: VideoDecoder
  spspps?: Uint8Array
  context?: Window & WorkerGlobal
  offscreen?: OffscreenCanvas
  offscreenCtx?: OffscreenCanvasRenderingContext2D
  constructor(context?: Window & WorkerGlobal) {
    // code
  }
  onMessage(type: any, value: any): void {
    // code
  }
  postMessage(type: any, value: any): void {
    // code
  }
}

export default new VideoWorkerDecoder(isInWorker() ? self : undefined)