// Animated Pokemon background — floating sprites from PokeAPI
const SPRITE_BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/";

const POKEMON_IDS = [
  25,  // Pikachu
  1,   // Bulbasaur
  4,   // Charmander
  7,   // Squirtle
  6,   // Charizard
  9,   // Blastoise
  3,   // Venusaur
  39,  // Jigglypuff
  52,  // Meowth
  54,  // Psyduck
  94,  // Gengar
  116, // Horsea
  129, // Magikarp
  131, // Lapras
  133, // Eevee
  143, // Snorlax
  147, // Dratini
  150, // Mewtwo
  152, // Chikorita
  155, // Cyndaquil
  158, // Totodile
  175, // Togepi
  196, // Espeon
  197, // Umbreon
  249, // Lugia
  250, // Ho-Oh
  255, // Torchic
  258, // Mudkip
  300, // Skitty
  384, // Rayquaza
  393, // Piplup
  448, // Lucario
  470, // Leafeon
  471, // Glaceon
  489, // Phione
  495, // Snivy
  498, // Tepig
  501, // Oshawott
  700, // Sylveon
  718, // Zygarde
];

const SPRITE_COUNT = 18;

class FloatingSprite {
  constructor(canvas, img) {
    this.canvas = canvas;
    this.img = img;
    this.init(true);
  }

  init(scatter = false) {
    const c = this.canvas;
    this.size = 48 + Math.random() * 72;
    this.x = Math.random() * c.width;
    this.y = scatter ? Math.random() * c.height : c.height + this.size;
    this.vx = (Math.random() - 0.5) * 0.4;
    this.vy = -(0.25 + Math.random() * 0.45); // float upward
    this.opacity = 0.07 + Math.random() * 0.09;
    this.angle = Math.random() * Math.PI * 2;
    this.spin = (Math.random() - 0.5) * 0.008;
    this.wobble = Math.random() * Math.PI * 2;
    this.wobbleSpeed = 0.01 + Math.random() * 0.015;
    this.wobbleAmp = 0.3 + Math.random() * 0.5;
  }

  update() {
    this.wobble += this.wobbleSpeed;
    this.x += this.vx + Math.sin(this.wobble) * this.wobbleAmp;
    this.y += this.vy;
    this.angle += this.spin;

    // Wrap horizontally
    if (this.x < -this.size) this.x = this.canvas.width + this.size;
    if (this.x > this.canvas.width + this.size) this.x = -this.size;

    // Reset when off top
    if (this.y < -this.size) this.init(false);
  }

  draw(ctx) {
    if (!this.img.complete || this.img.naturalWidth === 0) return;
    ctx.save();
    ctx.globalAlpha = this.opacity;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.drawImage(this.img, -this.size / 2, -this.size / 2, this.size, this.size);
    ctx.restore();
  }
}

function initBackground() {
  const canvas = document.getElementById("bg-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  // Pick random subset of Pokemon and load their sprites
  const shuffled = [...POKEMON_IDS].sort(() => Math.random() - 0.5);
  const chosen = shuffled.slice(0, SPRITE_COUNT);

  const sprites = [];
  let loaded = 0;

  chosen.forEach(id => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = `${SPRITE_BASE}${id}.png`;
    img.onload = () => {
      loaded++;
      // Spread multiple copies of each sprite across the canvas
      const copies = Math.ceil(SPRITE_COUNT / chosen.length) + 1;
      for (let i = 0; i < copies; i++) {
        sprites.push(new FloatingSprite(canvas, img));
      }
    };
    img.onerror = () => { loaded++; }; // skip missing sprites gracefully
  });

  // Sparkle particles
  const particles = Array.from({ length: 60 }, () => ({
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
    r: 0.5 + Math.random() * 1.5,
    vy: -(0.1 + Math.random() * 0.3),
    opacity: Math.random(),
    fade: 0.003 + Math.random() * 0.005,
  }));

  function drawParticles() {
    particles.forEach(p => {
      p.y += p.vy;
      p.opacity -= p.fade;
      if (p.opacity <= 0 || p.y < 0) {
        p.x = Math.random() * canvas.width;
        p.y = canvas.height;
        p.opacity = 0.4 + Math.random() * 0.6;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(247, 201, 72, ${p.opacity * 0.5})`;
      ctx.fill();
    });
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawParticles();
    sprites.forEach(s => { s.update(); s.draw(ctx); });
    requestAnimationFrame(animate);
  }

  animate();
}

document.addEventListener("DOMContentLoaded", initBackground);
