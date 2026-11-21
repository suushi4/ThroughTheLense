import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestFromText, sanitizeAmbience, ambienceLibrary, localSuggestion} from './web/ambience.mjs';

test('words of the entry suggest the place', () => {
  const cases = {
    'Шёл дождь, мы стояли под зонтом у остановки.': ['rain', 'street-traffic'],
    'Утром в парке пели птицы.': ['park-birds'],
    'Сели за столик в кафе, пили какао.': ['cafe'],
    'Сильный ветер на набережной.': ['wind'],
    'Вечер дома, тишина, плед и книга.': ['indoor-quiet'],
    'Слушали, как тает снег и бежит ручей.': ['stream'],
  };
  for (const [text, want] of Object.entries(cases)) assert.deepEqual(suggestFromText(text).sort(), [...want].sort(), text);
});

test('look-alike words do not trigger sounds', () => {
  for (const text of ['Мороз и солнце.', 'Лестница в подъезде.', 'Речь директора.', 'Садиться было некуда.', 'Барабан стучал.', 'Домашнее задание.'])
    assert.deepEqual(suggestFromText(text), [], text);
});

test('at most three suggestions, most mentioned first', () => {
  const ids = suggestFromText('Дождь, дождь и снова дождь. Улица, кафе, парк, ветер.');
  assert.equal(ids.length, 3);
  assert.equal(ids[0], 'rain');
});

test('sanitizeAmbience drops unknown ids and clamps gain', () => {
  assert.deepEqual(sanitizeAmbience(undefined), []);
  assert.deepEqual(sanitizeAmbience('rain'), []);
  assert.deepEqual(sanitizeAmbience([{id: 'rain', gain: 2}, {id: 'rain'}, {id: 'nope'}, {id: 'cafe', gain: -1}, {id: 'wind', gain: 0.333}]),
    [{id: 'rain', gain: 1}, {id: 'cafe', gain: 0}, {id: 'wind', gain: 0.33}]);
  assert.deepEqual(sanitizeAmbience([{id: 'wind'}]), [{id: 'wind', gain: 0.5}]);
  assert.equal(sanitizeAmbience(ambienceLibrary.map(x => ({id: x.id}))).length, 4);
});

test('local fallback works with text only', async () => {
  assert.deepEqual(await localSuggestion('Пили кофе у окна.', null), ['cafe']);
  assert.deepEqual(await localSuggestion('', null), []);
});
