export const isInWorker = () => {
  return typeof importScripts === 'function'
}
const ua = navigator.userAgent
export const isSafari = /^((?!chrome|android).)*safari/i.test(ua) || /Mobile/.test(ua)