// Validate GLSL syntax of player/npc/post shaders using a real GLSL ES parser.
import { parse } from '@shaderfrog/glsl-parser';
import { readFileSync } from 'fs';

function extract(file, names) {
  const src = readFileSync(file, 'utf8');
  const out = {};
  for (const n of names) {
    const re = new RegExp(`(?:const|export const) ${n} = /\\* glsl \\*/ \`([\\s\\S]*?)\`;`);
    const m = src.match(re);
    if (!m) throw new Error(`${n} not found in ${file}`);
    out[n] = m[1];
  }
  return out;
}

const prelude = `
precision highp float;
uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;
uniform mat3 normalMatrix; uniform vec3 cameraPosition;
attribute vec3 position; attribute vec3 normal; attribute vec2 uv;
`;

let fail = 0;
function check(label, src) {
  try {
    parse(prelude + src, { quiet: true });
    console.log('OK  ', label);
  } catch (e) {
    fail++;
    console.error('FAIL', label, '\n', e.message?.slice(0, 400));
  }
}

const p = extract('src/entities/player.ts', ['VERT', 'FRAG']);
const n = extract('src/entities/npc.ts', ['NPC_VERT', 'NPC_FRAG']);
const post = extract('src/render/pipeline.ts', ['POST_VERT', 'POST_FRAG']);

// в шейдерах three.js cameraPos доступен как built-in; парсеру объявим алиас
const alias = '#define cameraPos cameraPosition\n';
check('player VERT', alias + p.VERT.replace(/precision highp float;/, ''));
check('player FRAG', p.FRAG.replace(/precision highp float;/, ''));
check('npc VERT', alias + n.NPC_VERT.replace(/precision highp float;/, ''));
check('npc FRAG', n.NPC_FRAG.replace(/precision highp float;/, ''));
check('post VERT', post.POST_VERT.replace(/precision highp float;/, ''));
check('post FRAG', post.POST_FRAG.replace(/precision highp float;/, ''));
process.exit(fail ? 1 : 0);
