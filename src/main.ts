
import Player from '/src/player/index.ts'

const $input = document.getElementById('input')
$input.value = '/output.flv' // 可用的H.264_flv流, eg: https://******.flv
const $btn = document.getElementById('btn')
const $btn2 = document.getElementById('btn2')
const player = new Player.wcs()
player.init({
  renderId: 'player',
  buffer: 1000
})
$btn.onclick = () => {
  player.start($input.value)
}
$btn2.onclick = () => {
  player.stop()
}