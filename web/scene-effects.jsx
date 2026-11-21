import {Component, useEffect, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {useFrame, useThree} from '@react-three/fiber';
import {ShaderGradient, ShaderGradientCanvas} from '@shadergradient/react';
import LiquidGlass from 'liquid-glass-react';

const fixedPointer = {x: 0, y: 0};
const glassStyle = {position: 'absolute', inset: '50% auto auto 50%', width: '100%', height: '100%', pointerEvents: 'none'};

class FilmFallback extends Component {
  state = {failed: false};

  static getDerivedStateFromError() { return {failed: true}; }

  componentDidCatch() { this.props.onFallback(); }

  render() { return this.state.failed ? null : this.props.children; }
}

function LightTiming({active, setReady}) {
  const setFrameloop = useThree(state => state.setFrameloop);
  const frames = useRef(0);

  useEffect(() => {
    frames.current = 0;
    setFrameloop(active ? 'always' : 'demand');
    if (!active) return;
    const stop = setTimeout(() => setFrameloop('demand'), 950);
    return () => clearTimeout(stop);
  }, [active, setFrameloop]);

  useFrame(() => {
    if (active && ++frames.current === 2) setReady(true);
  });

  return null;
}

export function mountSceneLight(container) {
  const root = createRoot(container);
  const setReady = ready => container.toggleAttribute('data-ready', ready);
  let shown;

  return {
    show(active) {
      if (shown === active) return;
      shown = active;
      if (!active) setReady(false);
      root.render(
        <FilmFallback onFallback={() => setReady(false)}>
          <ShaderGradientCanvas pixelDensity={0.55} lazyLoad={false} pointerEvents="none">
            <ShaderGradient type="plane" animate={active ? 'on' : 'off'} grain="off" lightType="3d"
              color1="#a86751" color2="#413559" color3="#556a9a" uSpeed={0.38} />
            <LightTiming active={active} setReady={setReady} />
          </ShaderGradientCanvas>
          <div className="scene-glass">
            <LiquidGlass style={glassStyle} padding="0" cornerRadius={24} elasticity={0}
              displacementScale={18} aberrationIntensity={0.6} blurAmount={0.1}
              globalMousePos={fixedPointer} mouseOffset={fixedPointer}>
              <span />
            </LiquidGlass>
          </div>
        </FilmFallback>
      );
    },
    dispose() { root.unmount(); }
  };
}
