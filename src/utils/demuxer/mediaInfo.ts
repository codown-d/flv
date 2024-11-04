class MediaInfo {
  mimeType?: string
  duration?: number
  hasAudio?: boolean
  hasVideo?: boolean
  audioCodec?: string
  videoCodec?: string
  audioDataRate?: number
  videoDataRate?: number
  audioSampleRate?: number
  audioChannelCount?: number
  width?: number
  height?: number
  fps?: number
  profile?: string
  level?: string
  refFrames?: number
  chromaFormat?: string
  sarNum?: number
  sarDen?: number
  metadata?: Record<string, string | number | boolean>
  segments?: MediaInfo[]
  segmentCount?: number
  hasKeyframesIndex?: boolean
  keyframesIndex?: { times: number[], filepositions: number[] }

  isComplete(): boolean {
    let audioInfoComplete = (this.hasAudio === false) ||
      (this.hasAudio === true &&
        this.audioCodec != null &&
        this.audioSampleRate != null &&
        this.audioChannelCount != null)

    let videoInfoComplete = (this.hasVideo === false) ||
      (this.hasVideo === true &&
        this.videoCodec != null &&
        this.width != null &&
        this.height != null &&
        this.fps != null &&
        this.profile != null &&
        this.level != null &&
        this.refFrames != null &&
        this.chromaFormat != null &&
        this.sarNum != null &&
        this.sarDen != null)

    // keyframesIndex may not be present
    return this.mimeType != null &&
      this.duration != null &&
      this.metadata != null &&
      this.hasKeyframesIndex != null &&
      audioInfoComplete &&
      videoInfoComplete
  }

  isSeekable(): boolean {
    return this.hasKeyframesIndex === true
  }

  getNearestKeyframe(milliseconds: number): { index: number, milliseconds: number, fileposition: number } | null {
    if (this.keyframesIndex == null) {
      return null
    }

    let table = this.keyframesIndex
    let keyframeIdx = this._search(table.times, milliseconds)

    return {
      index: keyframeIdx,
      milliseconds: table.times[keyframeIdx],
      fileposition: table.filepositions[keyframeIdx],
    }
  }

  private _search(list: number[], value: number): number {
    let idx = 0

    let last = list.length - 1
    let mid = 0
    let lbound = 0
    let ubound = last

    if (value < list[0]) {
      idx = 0
      lbound = ubound + 1  // skip search
    }

    while (lbound <= ubound) {
      mid = lbound + Math.floor((ubound - lbound) / 2)
      if (mid === last || (value >= list[mid] && value < list[mid + 1])) {
        idx = mid
        break
      } else if (list[mid] < value) {
        lbound = mid + 1
      } else {
        ubound = mid - 1
      }
    }

    return idx
  }
}

export default MediaInfo