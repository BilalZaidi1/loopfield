import Svg, { Circle, ClipPath, Defs, Ellipse, G, Path, Rect } from 'react-native-svg';
import { avatarShapes, type AvatarSpec } from './spec';

/** The cartoon portrait drawn with vector shapes; `round` clips it to a circle (square for the saved image). */
export function CartoonAvatar({ spec, size, round = true, label }: { spec: AvatarSpec; size: number; round?: boolean; label?: string }) {
  const shapes = avatarShapes(spec);
  const id = `avatar-clip-${size}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" accessibilityLabel={label} accessible={Boolean(label)}>
      {round ? (
        <Defs>
          <ClipPath id={id}>
            <Circle cx={60} cy={60} r={60} />
          </ClipPath>
        </Defs>
      ) : null}
      <G clipPath={round ? `url(#${id})` : undefined}>
        {shapes.map((sh, i) => {
          switch (sh.tag) {
            case 'rect':
              return <Rect key={i} x={sh.x} y={sh.y} width={sh.width} height={sh.height} rx={sh.rx} fill={sh.fill} opacity={sh.opacity} />;
            case 'circle':
              return <Circle key={i} cx={sh.cx} cy={sh.cy} r={sh.r} fill={sh.fill} opacity={sh.opacity} stroke={sh.stroke} strokeWidth={sh.strokeWidth} />;
            case 'ellipse':
              return <Ellipse key={i} cx={sh.cx} cy={sh.cy} rx={sh.rx} ry={sh.ry} fill={sh.fill} opacity={sh.opacity} />;
            case 'path':
              return <Path key={i} d={sh.d} fill={sh.fill} opacity={sh.opacity} stroke={sh.stroke} strokeWidth={sh.strokeWidth} strokeLinecap={sh.strokeLinecap} />;
          }
        })}
      </G>
    </Svg>
  );
}
