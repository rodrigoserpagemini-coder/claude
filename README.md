# Mergulho Solar

Jogo 3D em WebGL (three.js): você pilota uma sonda pelas quatro camadas da
atmosfera do Sol (vento solar, coroa externa, coroa interna e cromosfera),
desvia de arcos, filamentos, plasmoides e espículas, coleta criocélulas para
resfriar o escudo térmico e tenta chegar mais perto da estrela do que a Parker
Solar Probe (9,86 R☉ em dezembro de 2024).

## Funções

- **Duas câmeras**: 3ª pessoa ou cabine em primeira pessoa (`C`). A cabine tem
  moldura com LEDs, painel com três telas ao vivo (radar, telemetria e
  sistemas com histórico de temperatura), vidro que carboniza com o calor e
  trinca a cada impacto, retícula com marcador de trajetória e alarmes.
- **Mapa do mergulho**: quatro regiões com visual e perigos próprios, mapa
  lateral com a posição atual, a marca da Parker e o seu recorde.
- **Radar** dos próximos 170 u, que fica vermelho quando algo está na sua linha.
- **Impulso** (`Espaço`): 45% mais rápido e pontos em dobro, gasta energia e
  aquece o escudo.
- **Escudo magnético** (`E`): gasta 60% de energia e desvia impactos por 3,5 s.
- **Ejeção de massa coronal**: tempestades periódicas de plasmoides.
- **Diário de bordo** com as 5 melhores descidas (salvo no navegador).
- Luz solar em múltiplos da Terra, raios de luz do Sol, zoom no impulso,
  bloom HDR, FXAA e resolução dinâmica.

## Rodar

```bash
npm install
npm run dev            # servidor de desenvolvimento (Vite)
npm run build          # build de produção em dist/
npm run build:single   # um único HTML autocontido em dist-single/
```

Controles: mouse (posição absoluta), arrastar o dedo (relativo) ou WASD/setas.
`Espaço`/`Shift` impulso, `E` escudo, `C` câmera, `Esc` ou `P` pausa. No
celular, impulso e escudo têm botões na tela.

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
  config.js              escala, ritmo, calor, energia, regiões (mapa) e dados da Parker
  main.js                entrada: checa WebGL e inicia o jogo
  core/
    bend.js              curvatura compartilhada (uniform + GLSL + JS)
    Input.js             mouse absoluto, toque relativo, teclado
    Audio.js             trilha e efeitos sintetizados com Web Audio (sem arquivos)
    math.js              damp, sorteio ponderado, distância a segmento
  world/
    Tunnel.js            corredor em GLSL com um padrão por região + véus de plasma
    Streaks.js           vento solar em GPU (sem upload por quadro)
    SunCore.js           fotosfera com granulação e escurecimento de limbo
  game/
    Game.js              estados, loop, câmeras, habilidades, tempestades, diário
    Cockpit.js           cabine em 1ª pessoa, telas em canvas, vidro com trincas
    Field.js             ondas por região, obstáculos, coletáveis, colisão
    Probe.js             sonda inspirada na Parker (escudo hexagonal, painéis)
  fx/
    PostFX.js            bloom, raios de sol, zoom, aberração, calor, alarme, FXAA
    Sparks.js            partículas em pool (exaustão, rasantes, explosão)
    plasmaMaterial.js    shader de plasma com deslocamento por ruído + halo
    noise.glsl.js        simplex 3D, fbm e rampa de cor de corpo negro
  ui/HUD.js              telemetria, mapa do mergulho e alertas no DOM
  ui/Radar.js            radar em canvas 2D, usado no HUD e na cabine
```

A resolução se ajusta sozinha (entre 0,5× e 2× o pixel ratio) para manter
cerca de 60 fps em qualquer GPU.

## Publicar no GitHub Pages

O workflow `.github/workflows/deploy.yml` publica `dist/` a cada push na
`main` ou no branch de trabalho, em
https://rodrigoserpagemini-coder.github.io/claude/.
