import './styles.css';
import { Game } from './game/Game.js';

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

if (webglAvailable()) {
  window.__game = new Game();
} else {
  const lede = document.querySelector('#screen-title .lede');
  lede.textContent = 'Este navegador não conseguiu iniciar o WebGL, que o jogo precisa para desenhar a coroa solar. Ative a aceleração de hardware ou abra em outro navegador.';
  document.getElementById('btn-start').disabled = true;
}
