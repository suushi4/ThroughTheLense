// Avatars: one of eight built-in pictures, or «буква на цвете» by default.
// The ids mirror avatarPresets in backend/internal/httpapi/profile.go.
import {icon} from './icons.mjs';
import {escapeHTML as h} from './ui.mjs';

export const avatarPresets = [
  {id:'lens', icon:'aperture', color:'#3f5a3c', label:'Объектив'},
  {id:'note', icon:'music', color:'#7a4b2a', label:'Нота'},
  {id:'frame', icon:'image', color:'#2f4e5e', label:'Кадр'},
  {id:'wave', icon:'wave', color:'#5b4a6b', label:'Волна'},
  {id:'clock', icon:'clock', color:'#6b5a2a', label:'Часы'},
  {id:'calendar', icon:'calendar', color:'#8a3f3a', label:'Календарь'},
  {id:'stack', icon:'stack', color:'#3e4f46', label:'Стопка снимков'},
  {id:'folder', icon:'folder', color:'#56603a', label:'Папка'},
];
const letterColors = ['#3f5a3c', '#7a4b2a', '#2f4e5e', '#5b4a6b', '#8a3f3a', '#56603a'];

export const displayName = user => (user?.name || '').trim();

// avatarHTML draws the user's avatar; size is the circle in pixels.
export function avatarHTML(user, size = 28) {
  const preset = avatarPresets.find(item => item.id === user?.avatar);
  const style = `--avatar-size:${size}px;--avatar-bg:`;
  if (preset) return `<span class="avatar" aria-hidden="true" style="${style}${preset.color}">${icon(preset.icon, Math.round(size * 0.55))}</span>`;
  const source = displayName(user) || user?.email || '?';
  const letter = (source.trim()[0] || '?').toUpperCase();
  let hash = 0;
  for (const char of String(user?.id || source)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return `<span class="avatar" aria-hidden="true" data-letter="${h(letter)}" style="${style}${letterColors[hash % letterColors.length]}"></span>`;
}
