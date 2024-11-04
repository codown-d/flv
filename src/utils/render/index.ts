export interface RenderConfig {
  canvas: HTMLCanvasElement
  getShouldRenderImg: () => ImageBitmap|undefined
}

export default class Render {
  _rafTaskDoing = false
  canvas?: HTMLCanvasElement
  ctx?: ImageBitmapRenderingContext
  _rafTimer?: number
  getShouldRenderImg?: RenderConfig['getShouldRenderImg']
  rafTask() {
    if (this._rafTimer !== undefined) {
      cancelAnimationFrame(this._rafTimer)
      this._rafTimer = undefined
    }
    this._rafTimer = requestAnimationFrame(() => {
      this._rafTimer = undefined
      if (this._rafTaskDoing) {
        this.render()
        this.rafTask()
      }
    })
  }
  start(){
    this._rafTaskDoing = true
    this.rafTask()
  }
  stop() {
    if (this._rafTimer !== undefined) {
      cancelAnimationFrame(this._rafTimer)
      this._rafTimer = undefined
    }
    this._rafTaskDoing = false
  }
  config(config: RenderConfig) {
    this.canvas = config.canvas
    this.ctx = this.canvas.getContext('bitmaprenderer')!
    this.getShouldRenderImg = config.getShouldRenderImg
  }
  render() {
    if (this.getShouldRenderImg) {
      const img = this.getShouldRenderImg()
      if (img && this.ctx) {
        this.ctx.transferFromImageBitmap(img)
      }
    }
  }
}