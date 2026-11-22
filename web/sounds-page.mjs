import {ambienceLibrary} from './ambience.mjs';
import {soundButton,sampleOutput,mountSoundSamples} from './sound-samples.mjs';

const host = document.querySelector('#place-sounds');
host.innerHTML = '<div class="ambience-chips">' + ambienceLibrary.map(({id}) => soundButton({id,gain:.65})).join('') + '</div>' + sampleOutput;
const samples = mountSoundSamples(host, () => {});
addEventListener('pagehide', samples.stop);
