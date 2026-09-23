# Mergulho Solar

Jogo 3D em WebGL (three.js): você pilota uma sonda pela coroa do Sol, desvia de
arcos, filamentos e plasmoides, coleta criocélulas para resfriar o escudo
térmico e tenta chegar mais perto da estrela do que a Parker Solar Probe
(9,86 R☉ em dezembro de 2024).

## Rodar

```bash
npm install
npm run dev            # servidor de desenvolvimento (Vite)
npm run build          # build de produção em dist/
npm run build:single   # um único HTML autocontido em dist-single/
```

Controles: mouse (posição absoluta), arrastar o dedo (relativo) ou WASD/setas.
`Esc` ou `P` pausa.

## Como funciona

O túnel é reto no espaço da simulação. Um *bend* compartilhado desloca tudo o
que está à frente da sonda por `curvatura × z²`, aplicado nos shaders (túnel,
partículas) e em JS (obstáculos). Na tela isso vira um corredor sinuoso, mas as
colisões continuam triviais: a sonda está em `z = 0`, onde o deslocamento é
zero. Cada obstáculo é testado uma única vez, no instante em que cruza o plano
da sonda, com uma função de distância 2D própria do tipo (arco de toro,
segmento, esfera).

```
src/
  config.js              escala do mundo, ritmo, calor, R☉ e referências da Parker
  main.js                entrada: checa WebGL e inicia o jogo
  core/
    bend.js              curvatura compartilhada (uniform + GLSL + JS)
    Input.js             mouse absoluto, toque relativo, teclado
    Audio.js             trilha e efeitos sintetizados com Web Audio (sem arquivos)
    math.js              damp, sorteio ponderado, distância a segmento
  world/
    Tunnel.js            corredor em GLSL: ruído simplex, linhas de campo, laços
    Streaks.js           vento solar em GPU (sem upload por quadro)
    SunCore.js           fotosfera com granulação e escurecimento de limbo
  game/
    Game.js              estados, loop, câmera, pontuação, resolução dinâmica
    Field.js             geração de ondas, obstáculos, criocélulas, colisão
    Probe.js             sonda inspirada na Parker (escudo hexagonal, painéis)
  fx/
    PostFX.js            bloom HDR, aberração cromática, tremor de calor, grão
    Sparks.js            partículas em pool (exaustão, rasantes, explosão)
    plasmaMaterial.js    shader de plasma com deslocamento por ruído
    noise.glsl.js        simplex 3D, fbm e rampa de cor de corpo negro
  ui/HUD.js              telemetria no DOM, só reescreve o que mudou
```

A resolução se ajusta sozinha (entre 0,5× e 2× o pixel ratio) para manter
cerca de 60 fps em qualquer GPU.

## Publicar no GitHub Pages

O workflow `.github/workflows/deploy.yml` publica `dist/` a cada push na
`main`. Ative uma vez em **Settings → Pages → Source: GitHub Actions**.
